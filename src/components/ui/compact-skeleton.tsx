type CompactSkeletonProps = {
  variant: "workspace" | "candidates" | "tasks";
};

export function CompactSkeleton({ variant }: CompactSkeletonProps) {
  if (variant === "workspace") {
    return (
      <div aria-label="正在加载工作台" className="compact-skeleton" role="status">
        <div className="compact-skeleton__metrics">
          {Array.from({ length: 3 }, (_, index) => (
            <i data-testid="skeleton-metric" key={index} />
          ))}
        </div>
        {Array.from({ length: 3 }, (_, index) => (
          <b data-testid="skeleton-row" key={index} />
        ))}
      </div>
    );
  }

  const item = variant === "candidates" ? "candidate" : "task";
  const count = variant === "candidates" ? 3 : 4;
  return (
    <div aria-label="正在加载" className="compact-skeleton" role="status">
      {Array.from({ length: count }, (_, index) => (
        <b data-testid={`skeleton-${item}`} key={index} />
      ))}
    </div>
  );
}
