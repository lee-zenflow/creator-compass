"use client";

import {
  BadgeCheck,
  BookOpenText,
  Braces,
  LayoutDashboard,
  Scale,
  Search,
  TriangleAlert,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import type { ReactNode } from "react";

export const ADMIN_NAV = [
  { label: "知识概览", href: "/admin", icon: LayoutDashboard },
  { label: "知识来源", href: "/admin/knowledge", icon: BookOpenText },
  { label: "审核队列", href: "/admin/knowledge?view=review", icon: BadgeCheck },
  { label: "检索试验", href: "/admin/retrieval", icon: Search },
  { label: "平台规则", href: "/admin/rules", icon: Scale },
  { label: "提示词", href: "/admin/prompts", icon: Braces },
  { label: "AI 异常", href: "/admin/ai-runs", icon: TriangleAlert },
] as const;

export function AdminShell({ title, children }: { title: string; children: ReactNode }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const reviewView = pathname === "/admin/knowledge" && searchParams.get("view") === "review";

  return (
    <div className="admin-shell">
      <aside className="admin-sidebar">
        <Link className="admin-brand" href="/admin" aria-label="Creator Compass 运营后台">
          <span className="admin-brand__mark">C</span>
          <span><strong>Creator Compass</strong><small>内容决策运营台</small></span>
        </Link>
        <nav className="admin-nav" aria-label="后台导航">
          {ADMIN_NAV.map(({ label, href, icon: Icon }) => {
            const url = new URL(href, "https://creator.local");
            const isReview = url.searchParams.get("view") === "review";
            const active = isReview
              ? reviewView
              : url.pathname === "/admin/knowledge"
                ? pathname === url.pathname && !reviewView
                : pathname === url.pathname;
            return (
              <Link aria-current={active ? "page" : undefined} className="admin-nav__item" href={href} key={label}>
                <Icon aria-hidden="true" size={18} strokeWidth={1.8} />
                <span>{label}</span>
              </Link>
            );
          })}
        </nav>
        <div className="admin-sidebar__note">
          <span className="admin-status-dot" />
          <span><strong>生产门槛已启用</strong><small>来源与切片均审核后才可检索</small></span>
        </div>
      </aside>
      <div className="admin-workspace">
        <header className="admin-topbar">
          <div><small>运营控制台</small><h1>{title}</h1></div>
          <Link className="admin-return" href="/workspace">返回用户端</Link>
        </header>
        <main className="admin-main">{children}</main>
      </div>
    </div>
  );
}
