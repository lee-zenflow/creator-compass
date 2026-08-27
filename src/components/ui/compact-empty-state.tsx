import Link from "next/link";

import type { ModuleIconName } from "@/features/navigation/module-icons";

import { ModuleIcon } from "./module-icon";

type CompactEmptyStateProps = {
  icon: ModuleIconName;
  title: string;
  detail: string;
  action?: { href: string; label: string };
};

export function CompactEmptyState({ icon, title, detail, action }: CompactEmptyStateProps) {
  return (
    <section className="compact-empty-state">
      <ModuleIcon label={title} name={icon} />
      <span>
        <strong>{title}</strong>
        <small>{detail}</small>
      </span>
      {action ? <Link href={action.href}>{action.label}</Link> : null}
    </section>
  );
}
