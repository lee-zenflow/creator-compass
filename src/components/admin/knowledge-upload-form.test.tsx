import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

import { KnowledgeUploadForm } from "./knowledge-upload-form";

describe("KnowledgeUploadForm", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  test("accepts only governed knowledge file formats", () => {
    render(<KnowledgeUploadForm />);
    expect(screen.getByLabelText("知识文件")).toHaveAttribute("accept", ".txt,.pdf,.docx,text/plain,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    expect(screen.getByText("单文件不超过 10 MiB，上传后仍需来源与切片双重审核。")).toBeInTheDocument();
  });

  test("shows the real queue result without exposing an object key", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ sourceId: "source-1", jobId: "job-1" }), { status: 202 }));
    vi.stubGlobal("fetch", fetchMock);
    render(<KnowledgeUploadForm />);
    fireEvent.change(screen.getByLabelText("来源名称"), { target: { value: "规则文档" } });
    fireEvent.change(screen.getByLabelText("授权说明"), { target: { value: "官方公开文档" } });
    fireEvent.change(screen.getByLabelText("知识文件"), { target: { files: [new File(["hello"], "rules.txt", { type: "text/plain" })] } });
    fireEvent.submit(screen.getByRole("button", { name: "上传并进入处理队列" }).closest("form")!);
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("已进入处理队列"));
    expect(screen.getByRole("status")).not.toHaveTextContent("objectKey");
    expect(refresh).toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
