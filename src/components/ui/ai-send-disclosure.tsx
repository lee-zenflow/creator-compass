import { ModuleIcon } from "./module-icon";
import type { SendDisclosure } from "@/features/ai/send-disclosure";

export function AiSendDisclosure({
  disclosure,
  title = "本次将发送给 DeepSeek",
}: {
  disclosure: SendDisclosure;
  title?: string;
}) {
  const itemCount = disclosure.coreFields.length + disclosure.materials.length;
  const sourceChunkCount = disclosure.sources.reduce((sum, source) => sum + source.chunkCount, 0);
  return (
    <details className="compact-disclosure">
      <summary>
        <ModuleIcon name="ai" label="AI 发送说明" />
        <span>
          <strong>{title}</strong>
          <small>{itemCount} 类本地内容{sourceChunkCount ? ` · ${sourceChunkCount} 个知识片段` : " · 暂无匹配知识片段"}</small>
        </span>
      </summary>
      <div className="compact-disclosure__body">
        <p><strong>固定模型</strong><code>{disclosure.model}</code></p>
        <div>
          <strong>业务内容</strong>
          <ul>{disclosure.coreFields.map((field) => <li key={field}>{field}</li>)}</ul>
        </div>
        {disclosure.materials.length ? <div>
          <strong>本地素材</strong>
          <ul>{disclosure.materials.map((material) => <li key={material}>{material}</li>)}</ul>
        </div> : null}
        <div>
          <strong>已审核知识</strong>
          {disclosure.sources.length
            ? <ul>{disclosure.sources.map((source) => <li key={source.id}>{source.label} · {source.chunkCount} 个片段</li>)}</ul>
            : <p>知识片段将在提交时匹配；只会检索已审核、已启用的正式资料。</p>}
        </div>
        <p className="compact-message">不会发送 API Key、原始截图或未审核资料。失败后不会自动再次调用。</p>
      </div>
    </details>
  );
}
