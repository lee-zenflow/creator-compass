import { AppShell } from "@/components/app-shell/app-shell";
import { CompactSkeleton } from "@/components/ui/compact-skeleton";

export default function TasksLoading() {
  return <AppShell activeTab="tasks" title="任务中心">
    <div className="flow-content compact-page">
      <CompactSkeleton variant="tasks" />
    </div>
  </AppShell>;
}
