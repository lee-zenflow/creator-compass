import {
  BarChart3,
  BookOpenText,
  Boxes,
  Compass,
  DatabaseBackup,
  FileText,
  Library,
  ListChecks,
  PenLine,
  RefreshCw,
  Settings,
  Sparkles,
  UserRound,
} from "lucide-react";

export const MODULE_ICONS = {
  workspace: BarChart3,
  tools: Boxes,
  positioning: Compass,
  creation: PenLine,
  review: RefreshCw,
  materials: Library,
  reports: FileText,
  tasks: ListChecks,
  profile: UserRound,
  knowledge: BookOpenText,
  settings: Settings,
  ai: Sparkles,
  backup: DatabaseBackup,
} as const;

export type ModuleIconName = keyof typeof MODULE_ICONS;

export const MODULE_TONES = {
  workspace: "neutral",
  tools: "neutral",
  positioning: "positioning",
  creation: "creation",
  review: "review",
  materials: "creation",
  reports: "neutral",
  tasks: "task",
  profile: "neutral",
  knowledge: "positioning",
  settings: "neutral",
  ai: "positioning",
  backup: "neutral",
} as const satisfies Record<ModuleIconName, "positioning" | "creation" | "review" | "task" | "neutral">;

export type ModuleTone = (typeof MODULE_TONES)[ModuleIconName];

export const REPORT_ICONS = {
  positioning: Compass,
  creation: PenLine,
  review: RefreshCw,
} as const;

export const TASK_SOURCE_ICONS = REPORT_ICONS;
