import Link from "next/link";

import { ModuleIcon } from "@/components/ui/module-icon";
import type { ModuleIconName } from "@/features/navigation/module-icons";

import type { NextAction, NextActionStage } from "./next-action-service";

const stageIcon: Record<NextActionStage, ModuleIconName> = {
  profile: "profile",
  positioning: "positioning",
  creation: "creation",
  task: "tasks",
  review: "review",
};

export function CurrentStepRow({ action }: { action: NextAction }) {
  return (
    <section
      aria-label={`当前步骤：${action.title}`}
      className="current-step-row instrument-action"
      data-stage={action.stage}
      data-testid="current-step"
    >
      <span
        aria-hidden="true"
        className="instrument-action__coordinate"
        translate="no"
      >
        NEXT ACTION
      </span>
      <ModuleIcon
        label={action.title}
        name={stageIcon[action.stage]}
      />
      <span className="current-step-row__copy">
        <small>当前步骤</small>
        <strong>{action.title}</strong>
        <span>{action.detail}</span>
      </span>
      <Link
        className="compact-button current-step-row__action"
        data-variant="primary"
        href={action.href}
      >
        {action.actionLabel}
      </Link>
    </section>
  );
}
