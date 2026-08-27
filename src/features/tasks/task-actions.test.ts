import { beforeEach, describe, expect, test, vi } from "vitest";
import type { CurrentActor } from "@/features/identity/current-actor";

const mocks = vi.hoisted(() => ({ batch: vi.fn(), move: vi.fn(), start: vi.fn(), track: vi.fn(), revalidate: vi.fn(), redirect: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
vi.mock("next/headers", () => ({ cookies: vi.fn(async () => ({})), headers: vi.fn(async () => ({})) }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/features/identity/current-actor", () => ({ resolveCurrentActor: vi.fn(async () => actor) }));
vi.mock("@/features/analytics/analytics-service", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/features/analytics/analytics-service")>(), trackProductEvent: mocks.track,
}));
vi.mock("./task-service", () => ({
  batchUpdateTaskStatus: mocks.batch, deleteTask: vi.fn(), moveTask: mocks.move, startTask: mocks.start, updateTask: vi.fn(),
}));

import { batchTaskStatusAction, completeTaskAction, moveTaskAction, restoreTaskAction, startTaskAction } from "./task-actions";

const actor: CurrentActor = { kind: "user", userId: "10000000-0000-4000-8000-000000000001", role: "user" };
const taskId = "20000000-0000-4000-8000-000000000002";
const secondTaskId = "20000000-0000-4000-8000-000000000003";
function taskForm(id = taskId) { const form = new FormData(); form.set("taskId", id); form.set("ownerId", "attacker-owner"); form.set("range", "today"); form.set("status", "pending"); return form; }

describe("fixed task actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.start.mockResolvedValue({ id: taskId, status: "in_progress", sourceVersion: 7 });
    mocks.batch.mockResolvedValue({ changed: [{ id: taskId, status: "completed", sourceVersion: 7 }], unchanged: [] });
    mocks.move.mockResolvedValue([]); mocks.track.mockResolvedValue(undefined);
  });

  test("resolves the actor on the server and ignores a submitted owner", async () => {
    await startTaskAction(taskForm());
    expect(mocks.start).toHaveBeenCalledWith(actor, taskId);
    expect(mocks.revalidate).toHaveBeenCalledWith("/tasks");
    expect(mocks.revalidate).toHaveBeenCalledWith(`/tasks/${taskId}`);
  });

  test("returns a fixed invalid notice for a malformed task id", async () => {
    await startTaskAction(taskForm("not-a-uuid"));
    expect(mocks.start).not.toHaveBeenCalled();
    expect(mocks.redirect).toHaveBeenCalledWith("/tasks?range=today&status=pending&notice=invalid");
  });

  test("completes through the atomic batch command", async () => {
    await completeTaskAction(taskForm());
    expect(mocks.batch).toHaveBeenCalledWith(actor, { taskIds: [taskId], targetStatus: "completed" });
    expect(mocks.track).toHaveBeenCalledTimes(1);
  });

  test("does not emit a duplicate completion event for an idempotent no-op", async () => {
    mocks.batch.mockResolvedValue({ changed: [], unchanged: [{ id: taskId, status: "completed", sourceVersion: 7 }] });
    await completeTaskAction(taskForm());
    expect(mocks.track).not.toHaveBeenCalled();
  });

  test("restores through the fixed pending command and never tracks completion", async () => {
    await restoreTaskAction(taskForm());
    expect(mocks.batch).toHaveBeenCalledWith(actor, { taskIds: [taskId], targetStatus: "pending" });
    expect(mocks.track).not.toHaveBeenCalled();
  });

  test("accepts repeated task ids for a bounded batch command", async () => {
    const form = new FormData(); form.append("taskIds", taskId); form.append("taskIds", secondTaskId); form.set("targetStatus", "completed"); form.set("range", "week"); form.set("status", "in_progress");
    await batchTaskStatusAction(form);
    expect(mocks.batch).toHaveBeenCalledWith(actor, { taskIds: [taskId, secondTaskId], targetStatus: "completed" });
    expect(mocks.revalidate).toHaveBeenCalledWith(`/tasks/${secondTaskId}`);
  });

  test("moves in a fixed direction and maps transition errors to conflict", async () => {
    const form = taskForm(); form.set("direction", "up"); mocks.move.mockRejectedValue(new Error("INVALID_TASK_TRANSITION"));
    await moveTaskAction(form);
    expect(mocks.move).toHaveBeenCalledWith(actor, { taskId, direction: "up" });
    expect(mocks.redirect).toHaveBeenCalledWith("/tasks?range=today&status=pending&notice=conflict");
  });

  test("normalizes untrusted filter values instead of accepting an open redirect", async () => {
    const form = taskForm("bad"); form.set("range", "https://attacker.example"); form.set("status", "anything");
    await startTaskAction(form);
    expect(mocks.redirect).toHaveBeenCalledWith("/tasks?range=all&notice=invalid");
  });
});
