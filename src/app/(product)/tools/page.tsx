import { AppShell } from "@/components/app-shell/app-shell";
import { ToolsView } from "@/features/tools/tools-view";

export default function ToolsPage() {
  return (
    <AppShell title="工具箱" coordinate="MODULE INDEX · 05" activeTab="tools">
      <ToolsView />
    </AppShell>
  );
}
