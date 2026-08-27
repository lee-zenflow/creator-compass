import { describe, expect, test } from "vitest";

import type { CurrentActor } from "@/features/identity/current-actor";
import {
  archiveReport,
  appendReportVersion,
  createReportVersion,
  getReport,
  listReports,
  restoreReport,
  type AppendReportVersionInput,
  type ReportRecord,
  type ReportRepository,
  type ReportVersionRecord,
} from "./report-service";

test("exposes the planned createReportVersion domain contract", () => {
  expect(createReportVersion).toBe(appendReportVersion);
});

const owner: CurrentActor = { kind: "user", userId: "10000000-0000-4000-8000-000000000001", role: "user" };
const other: CurrentActor = { kind: "user", userId: "20000000-0000-4000-8000-000000000002", role: "user" };

function actorKey(actor: CurrentActor) {
  return actor.kind === "user" ? `user:${actor.userId}` : `guest:${actor.guestSessionId}`;
}

class MemoryReportRepository implements ReportRepository {
  roots: ReportRecord[] = [];
  versions: ReportVersionRecord[] = [];
  inserts = 0;
  private sequence = 0;

  async transaction<T>(work: (repository: ReportRepository) => Promise<T>): Promise<T> {
    return work(this);
  }

  async lockRoot() {}

  async updateRootStatus(actor: CurrentActor, reportId: string, status: ReportRecord["status"]) {
    const root = await this.getRoot(actor, reportId);
    if (!root) return null;
    root.status = status;
    root.updatedAt = new Date("2026-08-09T12:00:00Z");
    return structuredClone(root);
  }

  async listRoots(actor: CurrentActor, type?: ReportRecord["type"]) {
    return this.roots.filter(
      (root) => actorKey(root.owner) === actorKey(actor) && (!type || root.type === type),
    );
  }

  async getRoot(actor: CurrentActor, reportId: string) {
    return this.roots.find(
      (root) => root.id === reportId && actorKey(root.owner) === actorKey(actor),
    ) ?? null;
  }

  async listVersions(actor: CurrentActor, root: ReportRecord) {
    return this.versions.filter(
      (version) => version.reportId === root.id && actorKey(version.owner) === actorKey(actor),
    );
  }

  async createRoot(actor: CurrentActor, input: Omit<ReportRecord, "id" | "owner" | "createdAt" | "updatedAt">) {
    const root: ReportRecord = {
      ...input,
      id: `70000000-0000-4000-8000-${String(++this.sequence).padStart(12, "0")}`,
      owner: actor,
      createdAt: new Date("2026-08-08T12:00:00Z"),
      updatedAt: new Date("2026-08-08T12:00:00Z"),
    };
    this.roots.push(root);
    return root;
  }

  async nextVersion(actor: CurrentActor, root: ReportRecord) {
    return (await this.listVersions(actor, root)).length + 1;
  }

  async insertVersion(
    actor: CurrentActor,
    root: ReportRecord,
    version: number,
    input: AppendReportVersionInput,
  ) {
    this.inserts += 1;
    const record: ReportVersionRecord = {
      id: `version-${this.inserts}`,
      reportId: root.id,
      owner: actor,
      type: input.type,
      version,
      status: input.version.status,
      createdAt: new Date("2026-08-08T12:00:00Z"),
    };
    this.versions.push(structuredClone(record));
    return record;
  }
}

const firstCreation: AppendReportVersionInput = {
  type: "creation",
  root: { title: "首篇视频方案", summary: "从定位到可执行脚本", status: "ready" },
  version: {
    creationProjectId: "30000000-0000-4000-8000-000000000003",
    title: "三步完成第一条视频",
    outline: ["开头", "过程", "结尾"],
    body: "脚本正文",
    mediaSuggestions: [],
    platformSuggestions: [],
    citations: [],
    status: "ready",
    generation: {
      mode: "ai",
      model: "deepseek-v4-flash",
      promptVersionId: "40000000-0000-4000-8000-000000000004",
      retrievalRecordId: "50000000-0000-4000-8000-000000000005",
      aiRunId: "60000000-0000-4000-8000-000000000006",
      schemaVersion: 1,
    },
  },
};

describe("immutable typed report versions", () => {
  test("creates one root and appends immutable typed versions", async () => {
    const repository = new MemoryReportRepository();
    const first = await appendReportVersion(owner, firstCreation, repository);
    const second = await appendReportVersion(
      owner,
      {
        ...firstCreation,
        root: { ...firstCreation.root, reportId: first.root.id },
        version: {
          ...firstCreation.version,
          title: "三步完成第一条视频·人工调整",
          generation: { mode: "manual", parentVersion: 1, schemaVersion: 1 },
        },
      },
      repository,
    );

    expect(first.root.id).toBe(second.root.id);
    expect(first.version.version).toBe(1);
    expect(second.version.version).toBe(2);
    expect(repository.roots).toHaveLength(1);
    expect((await getReport(owner, first.root.id, repository)).versions.map((item) => item.version)).toEqual([2, 1]);
  });

  test("filters roots by report type", async () => {
    const repository = new MemoryReportRepository();
    await appendReportVersion(owner, firstCreation, repository);
    expect(await listReports(owner, "creation", repository)).toHaveLength(1);
    expect(await listReports(owner, "review", repository)).toHaveLength(0);
  });

  test("normalizes cross-owner reads and appends to NOT_FOUND", async () => {
    const repository = new MemoryReportRepository();
    const first = await appendReportVersion(owner, firstCreation, repository);

    await expect(getReport(other, first.root.id, repository)).rejects.toThrow("NOT_FOUND");
    await expect(
      appendReportVersion(
        other,
        { ...firstCreation, root: { ...firstCreation.root, reportId: first.root.id } },
        repository,
      ),
    ).rejects.toThrow("NOT_FOUND");
    expect(repository.inserts).toBe(1);
  });

  test("rejects a manual first version before creating a root", async () => {
    const repository = new MemoryReportRepository();
    await expect(
      appendReportVersion(
        owner,
        {
          ...firstCreation,
          version: {
            ...firstCreation.version,
            generation: { mode: "manual", parentVersion: 1, schemaVersion: 1 },
          },
        },
        repository,
      ),
    ).rejects.toThrow("INVALID_PARENT_VERSION");
    expect(repository.roots).toHaveLength(0);
    expect(repository.inserts).toBe(0);
  });

  test("rejects a missing parent version without changing the existing version", async () => {
    const repository = new MemoryReportRepository();
    const first = await appendReportVersion(owner, firstCreation, repository);
    const original = structuredClone(repository.versions[0]);

    await expect(
      appendReportVersion(
        owner,
        {
          ...firstCreation,
          root: { ...firstCreation.root, reportId: first.root.id },
          version: {
            ...firstCreation.version,
            title: "不应保存",
            generation: { mode: "manual", parentVersion: 99, schemaVersion: 1 },
          },
        },
        repository,
      ),
    ).rejects.toThrow("INVALID_PARENT_VERSION");
    expect(repository.versions).toEqual([original]);
    expect(repository.inserts).toBe(1);
  });
});

describe("root-only report lifecycle", () => {
  test("archives only the owned root and preserves immutable versions", async () => {
    const repository = new MemoryReportRepository();
    const first = await appendReportVersion(owner, firstCreation, repository);
    await appendReportVersion(owner, {
      ...firstCreation,
      root: { ...firstCreation.root, reportId: first.root.id },
      version: {
        ...firstCreation.version,
        generation: { mode: "manual", parentVersion: 1, schemaVersion: 1 },
      },
    }, repository);
    const versionsBefore = structuredClone(repository.versions);

    await expect(archiveReport(owner, first.root.id, repository)).resolves.toMatchObject({
      status: "archived",
    });
    expect(repository.versions).toEqual(versionsBefore);
  });

  test("restores the root to the latest typed version status", async () => {
    const repository = new MemoryReportRepository();
    const first = await appendReportVersion(owner, firstCreation, repository);
    repository.versions[0]!.status = "failed";

    await archiveReport(owner, first.root.id, repository);
    await expect(restoreReport(owner, first.root.id, repository)).resolves.toMatchObject({
      status: "failed",
    });
  });

  test("normalizes cross-owner archive and restore to NOT_FOUND", async () => {
    const repository = new MemoryReportRepository();
    const first = await appendReportVersion(owner, firstCreation, repository);

    await expect(archiveReport(other, first.root.id, repository)).rejects.toThrow("NOT_FOUND");
    await expect(restoreReport(other, first.root.id, repository)).rejects.toThrow("NOT_FOUND");
    expect(repository.roots[0]!.status).toBe("ready");
  });
});
