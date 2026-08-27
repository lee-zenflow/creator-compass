import type { LucideIcon } from "lucide-react";
import Link from "next/link";

import { MODULE_ICONS } from "@/features/navigation/module-icons";

export const PRODUCT_TABS = [
  { id: "workspace", label: "工作台", href: "/workspace" },
  { id: "tools", label: "工具箱", href: "/tools" },
  { id: "tasks", label: "任务", href: "/tasks" },
  { id: "me", label: "我的", href: "/me" },
] as const;

export type ProductTabId = (typeof PRODUCT_TABS)[number]["id"];

const TAB_ICONS = {
  workspace: MODULE_ICONS.workspace,
  tools: MODULE_ICONS.tools,
  tasks: MODULE_ICONS.tasks,
  me: MODULE_ICONS.profile,
} satisfies Record<ProductTabId, LucideIcon>;

export function BottomNav({ active }: { active: ProductTabId }) {
  return (
    <nav className="bottom-nav" aria-label="主导航">
      {PRODUCT_TABS.map((tab) => {
        const Icon = TAB_ICONS[tab.id];
        const isActive = tab.id === active;

        return (
          <Link
            className="bottom-nav__item"
            data-active={isActive || undefined}
            href={tab.href}
            aria-current={isActive ? "page" : undefined}
            key={tab.id}
          >
            <Icon aria-hidden="true" size={18} strokeWidth={1.8} />
            <span>{tab.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
