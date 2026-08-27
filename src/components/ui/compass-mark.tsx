type CompassMarkSize = "small" | "medium";

type DecorativeCompassMarkProps = {
  decorative: true;
  label?: never;
  size?: CompassMarkSize;
};

type AccessibleCompassMarkProps = {
  decorative?: false;
  label: string;
  size?: CompassMarkSize;
};

export type CompassMarkProps =
  | DecorativeCompassMarkProps
  | AccessibleCompassMarkProps;

export function CompassMark({
  decorative,
  label,
  size = "medium",
}: CompassMarkProps) {
  const accessibilityProps = decorative
    ? ({ "aria-hidden": true } as const)
    : ({ role: "img", "aria-label": label } as const);

  return (
    <span className="compass-mark" data-size={size} {...accessibilityProps}>
      <span aria-hidden="true" className="compass-mark__ring" />
      <span aria-hidden="true" className="compass-mark__needle" />
    </span>
  );
}
