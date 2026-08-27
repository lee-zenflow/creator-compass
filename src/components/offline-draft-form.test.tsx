import "fake-indexeddb/auto";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test, vi } from "vitest";

import { OfflineDraftForm } from "./offline-draft-form";

describe("offline draft form", () => {
  test("restores locally edited fields without submitting private text", async () => {
    const databaseName = `draft-form-${crypto.randomUUID()}`;
    const action = vi.fn(async (form: FormData) => { void form; });
    const first = render(<OfflineDraftForm action={action} baseVersion={0} databaseName={databaseName} draftId="creation:new" entityId="new" entityType="creation"><input name="expectedVersion" type="hidden" value="1" /><label>目标<textarea name="goal" /></label></OfflineDraftForm>);
    await userEvent.type(screen.getByLabelText("目标"), "离线内容");
    await waitFor(() => expect(screen.getByText("草稿已保存在本机")).toBeInTheDocument());
    first.unmount();
    const second = render(<OfflineDraftForm action={action} baseVersion={0} databaseName={databaseName} draftId="creation:new" entityId="new" entityType="creation"><input name="expectedVersion" type="hidden" value="2" /><label>目标<textarea name="goal" /></label></OfflineDraftForm>);
    await waitFor(() => expect(screen.getByLabelText("目标")).toHaveValue("离线内容"));
    expect(second.container.querySelector('input[name="expectedVersion"]')).toHaveValue("2");
    expect(action).not.toHaveBeenCalled();
  });
});
