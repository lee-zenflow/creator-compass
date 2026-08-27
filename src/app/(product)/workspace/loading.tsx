import { AppShell } from "@/components/app-shell/app-shell";
import { CompactSkeleton } from "@/components/ui/compact-skeleton";

export default function WorkspaceLoading() {
  return <AppShell activeTab="workspace" title="工作台">
    <div className="flow-content compact-page">
      <CompactSkeleton variant="workspace" />
    </div>
  </AppShell>;
}
