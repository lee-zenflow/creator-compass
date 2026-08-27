"use client";

import { useMemo, useState } from "react";

import { recognizeScreenshot } from "@/lib/ocr/ocr-worker";
import { extractMetricsFromText, validateMinimumReviewFields } from "./extract-metrics";
import type { OcrMetricDraft } from "./review-schemas";

const missingLabels = { platform: "平台", title: "内容标题", publishedAt: "发布时间", views: "播放/阅读量", interactionMetric: "至少一项互动指标" } as const;

export function OcrConfirmation({ onConfirm, confirmAction, accounts = [] }: {
  onConfirm?: (draft: OcrMetricDraft) => void;
  confirmAction?: (formData: FormData) => void | Promise<void>;
  accounts?: Array<{ id: string; platform: OcrMetricDraft["platform"]; accountLabel: string | null; isActive: boolean }>;
}) {
  const initialAccount = accounts.find((account) => account.isActive) ?? accounts[0];
  const [accountId, setAccountId] = useState(initialAccount?.id ?? "");
  const [platform, setPlatform] = useState<OcrMetricDraft["platform"]>(initialAccount?.platform ?? "douyin");
  const [draft, setDraft] = useState<Partial<OcrMetricDraft>>({ platform });
  const [recognizedText, setRecognizedText] = useState("");
  const [progress, setProgress] = useState(0);
  const [confidence, setConfidence] = useState<number | null>(null);
  const [working, setWorking] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [saveOriginal, setSaveOriginal] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState(false);
  const missing = useMemo(() => validateMinimumReviewFields({ ...draft, platform }), [draft, platform]);

  async function selectFile(file: File | undefined) {
    if (!file) return;
    setSelectedFile(file); setSaveOriginal(false); setUploadError(false);
    setWorking(true); setProgress(0); setConfidence(null);
    try {
      const result = await recognizeScreenshot(file, setProgress);
      setRecognizedText(result.text); setConfidence(result.confidence);
      setDraft((current) => ({ ...current, ...extractMetricsFromText(result.text, platform), platform }));
    } finally { setWorking(false); }
  }

  async function submitWithOptionalUpload(formData: FormData) {
    if (saveOriginal && selectedFile) {
      setUploading(true); setUploadError(false);
      try {
        const upload = new FormData();
        upload.set("file", selectedFile);
        const response = await fetch("/api/storage/private", { method: "POST", body: upload });
        if (!response.ok) throw new Error("UPLOAD_FAILED");
        const result = await response.json() as { objectKey?: string };
        if (!result.objectKey) throw new Error("UPLOAD_FAILED");
        formData.set("privateObjectKey", result.objectKey);
        formData.set("screenshotConsentAt", new Date().toISOString());
      } catch {
        setUploadError(true); return;
      } finally { setUploading(false); }
    }
    await confirmAction?.(formData);
  }

  function field(key: keyof OcrMetricDraft, label: string, type = "number") {
    return <label>{label}<input name={key} type={type} value={draft[key] ?? ""} onChange={(event) => setDraft((current) => ({ ...current, [key]: type === "number" ? (event.target.value ? Number(event.target.value) : undefined) : event.target.value }))} /></label>;
  }

  const body = <>
    <input name="sourceMode" type="hidden" value={recognizedText ? "ocr" : "manual"} />
    <p className="compact-message">截图只在当前浏览器识别，默认不会上传原图。</p>
    <label className="ocr-upload compact-card">选择后台数据截图<input accept="image/png,image/jpeg,image/webp" type="file" onChange={(event) => void selectFile(event.target.files?.[0])} /></label>
    {working ? <div className="ocr-progress"><span style={{ width: `${Math.round(progress * 100)}%` }} /></div> : null}
    {confidence !== null ? <small>OCR 置信度 {Math.round(confidence)}%，请逐项确认</small> : null}
    {selectedFile ? <label className="compact-check"><input checked={saveOriginal} onChange={(event) => setSaveOriginal(event.target.checked)} type="checkbox" />保存原始截图到私有空间</label> : null}
    {saveOriginal ? <small>仅在你确认后上传，可随账号删除；下载链接 5 分钟后失效。</small> : null}
    {uploadError ? <p className="compact-message" data-error="true">原图保存失败，未生成复盘。可取消保存原图后重试。</p> : null}
    {accounts.length ? <label>账号标签<select name="platformAccountId" value={accountId} onChange={(event) => { const next = accounts.find((account) => account.id === event.target.value); if (!next) return; setAccountId(next.id); setPlatform(next.platform); setDraft((current) => ({ ...current, platform: next.platform })); }}>{accounts.map((account) => <option key={account.id} value={account.id}>{account.accountLabel ?? account.platform}</option>)}</select><input name="platform" type="hidden" value={platform} /></label> : <label>平台<select name="platform" value={platform} onChange={(event) => { const value = event.target.value as OcrMetricDraft["platform"]; setPlatform(value); setDraft((current) => ({ ...current, platform: value })); }}><option value="douyin">抖音</option><option value="xiaohongshu">小红书</option><option value="bilibili">B站</option><option value="wechat">公众号</option><option value="other">其他</option></select></label>}
    {field("title", "内容标题", "text")}{field("publishedAt", "发布时间", "text")}{field("views", "播放/阅读量")}
    <div className="compact-form__row">{field("likes", "点赞")}{field("comments", "评论")}</div>
    <div className="compact-form__row">{field("favorites", "收藏")}{field("shares", "分享")}</div>
    {field("followersGained", "涨粉")}
    <details><summary>查看 OCR 原文</summary><textarea rows={5} value={recognizedText} onChange={(event) => setRecognizedText(event.target.value)} /></details>
    {missing.length ? <p className="compact-message" data-error="true">还需确认：{missing.map((item) => missingLabels[item]).join("、")}</p> : null}
    <button className="compact-button" disabled={missing.length > 0 || uploading} type={confirmAction ? "submit" : "button"} onClick={() => onConfirm?.(draft as OcrMetricDraft)}>{uploading ? "正在保存原图…" : "确认并生成复盘"}</button>
  </>;
  return confirmAction
    ? <form action={submitWithOptionalUpload} className="ocr-flow compact-page">{body}</form>
    : <div className="ocr-flow compact-page">{body}</div>;
}
