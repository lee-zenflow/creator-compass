import { render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

import { AiRunWatcher } from "./ai-run-watcher";

describe("AI run watcher", () => {
  beforeEach(() => {
    refresh.mockReset();
  });

  test("refreshes the server page only after a real terminal status", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ ok: true, run: { status: "ready" } }), { status: 200 })));
    render(<AiRunWatcher runId="run-1" />);
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
  });
});
