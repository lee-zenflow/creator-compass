"use client";

import { FileUp, LoaderCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

export function KnowledgeUploadForm() {
  const router = useRouter();
  const [status, setStatus] = useState<"idle" | "uploading" | "queued" | "error">("idle");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    setStatus("uploading");
    try {
      const response = await fetch("/api/admin/knowledge/uploads", {
        method: "POST",
        body: new FormData(form),
      });
      if (!response.ok) throw new Error("UPLOAD_FAILED");
      setStatus("queued");
      form.reset();
      router.refresh();
    } catch {
      setStatus("error");
    }
  }

  return (
    <form className="admin-form" onSubmit={submit}>
      <div className="admin-form-grid">
        <label>来源名称<input name="name" required maxLength={160} /></label>
        <label>授权说明<input name="licenseNote" required maxLength={1000} placeholder="来源、授权范围或公开使用依据" /></label>
        <label>适用平台<select name="platform" required defaultValue="all"><option value="all">全平台</option><option value="xiaohongshu">小红书</option><option value="douyin">抖音</option><option value="bilibili">B 站</option><option value="wechat">公众号</option></select></label>
        <label>内容类型<select name="contentType" required defaultValue="general"><option value="general">通用方法</option><option value="note">图文笔记</option><option value="video">视频</option><option value="article">长文章</option><option value="copy">短文案</option></select></label>
      </div>
      <label>标签（逗号分隔）<input name="tags" maxLength={400} placeholder="定位、选题、复盘" /></label>
      <label className="admin-file-field">
        <span><FileUp aria-hidden="true" size={18} strokeWidth={1.8} /><strong>知识文件</strong></span>
        <input
          aria-label="知识文件"
          name="file"
          type="file"
          required
          accept=".txt,.pdf,.docx,text/plain,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        />
        <small>单文件不超过 10 MiB，上传后仍需来源与切片双重审核。</small>
      </label>
      <button className="admin-button" disabled={status === "uploading"} type="submit">
        {status === "uploading" ? <LoaderCircle aria-hidden="true" className="admin-spin" size={16} /> : <FileUp aria-hidden="true" size={16} />}
        {status === "uploading" ? "正在上传" : "上传并进入处理队列"}
      </button>
      {status === "queued" ? <p className="admin-inline-message" data-tone="success" role="status">已进入处理队列，可在来源列表查看真实状态。</p> : null}
      {status === "error" ? <p className="admin-inline-message" data-tone="error" role="status">上传未完成，请检查格式、大小和授权说明后重试。</p> : null}
    </form>
  );
}
