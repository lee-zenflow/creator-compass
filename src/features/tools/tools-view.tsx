import Link from "next/link";

import { ModuleIcon } from "@/components/ui/module-icon";
import type { ModuleIconName } from "@/features/navigation/module-icons";

type ToolEntry = {
  id: ModuleIconName;
  title: string;
  description: string;
  href: string;
};

export const TOOL_ENTRIES: readonly ToolEntry[] = [
  { id: "positioning", title: "IP 定位", description: "对话梳理方向", href: "/positioning" },
  { id: "creation", title: "事前创作", description: "生成方案与任务", href: "/creation/new" },
  { id: "review", title: "数据复盘", description: "确认数据并复盘", href: "/reviews/new" },
  { id: "materials", title: "素材库", description: "保存与复用素材", href: "/materials" },
  { id: "reports", title: "报告记录", description: "查看历史版本", href: "/reports" },
];

export function ToolsView() {
  return (
    <div className="flow-content compact-page">
      {TOOL_ENTRIES.map((entry) => (
        <Link
          className="tool-row compact-card"
          data-module={entry.id}
          data-testid="tool-entry"
          href={entry.href}
          key={entry.id}
        >
          <ModuleIcon
            label={`${entry.title}图标`}
            name={entry.id}
          />
          <span className="tool-row__copy">
            <strong>{entry.title}</strong>
            <small>{entry.description}</small>
          </span>
          <b aria-hidden="true">›</b>
        </Link>
      ))}
    </div>
  );
}
