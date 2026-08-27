type MetricSparklineProps = {
  label: string;
  points: number[];
};

export function MetricSparkline({ label, points }: MetricSparklineProps) {
  const max = Math.max(...points, 1);
  const denominator = Math.max(points.length - 1, 1);
  const path = points
    .map(
      (value, index) =>
        `${(index / denominator) * 100},${32 - (value / max) * 28}`,
    )
    .join(" ");

  return (
    <svg
      className="metric-sparkline"
      viewBox="0 0 100 36"
      role="img"
      aria-label={`${label}：${points.join("、")}`}
    >
      <polyline
        points={path}
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
