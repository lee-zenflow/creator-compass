import {
  MODULE_ICONS,
  MODULE_TONES,
  type ModuleIconName,
  type ModuleTone,
} from "@/features/navigation/module-icons";

type ModuleIconProps = {
  name: ModuleIconName;
  label: string;
  tone?: ModuleTone;
};

export function ModuleIcon({ name, label, tone = MODULE_TONES[name] }: ModuleIconProps) {
  const Icon = MODULE_ICONS[name];

  return (
    <span
      className="module-icon"
      data-module={name}
      data-tone={tone}
      aria-label={label}
    >
      <Icon aria-hidden="true" size={18} strokeWidth={1.8} />
    </span>
  );
}
