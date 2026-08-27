import { AppShell } from "@/components/app-shell/app-shell";
import { CompactSkeleton } from "@/components/ui/compact-skeleton";

export default function PositioningReportLoading() {
  return <AppShell backHref="/positioning" bottomNav={false} title="定位方案">
    <div className="flow-content compact-page">
      <CompactSkeleton variant="candidates" />
    </div>
  </AppShell>;
}
