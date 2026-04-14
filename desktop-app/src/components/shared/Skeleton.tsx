/**
 * Skeleton loader -- animated placeholder for loading states.
 * Use instead of spinners for content that has a known layout.
 */

interface SkeletonProps {
  readonly width?: string;
  readonly height?: string;
  readonly rounded?: "sm" | "md" | "lg" | "full";
  readonly className?: string;
}

export function Skeleton({
  width = "100%",
  height = "16px",
  rounded = "md",
  className = "",
}: SkeletonProps) {
  const radiusClass = {
    sm: "rounded-sm",
    md: "rounded-md",
    lg: "rounded-lg",
    full: "rounded-full",
  }[rounded];

  return (
    <div
      className={`shimmer-bg ${radiusClass} ${className}`}
      style={{ width, height }}
      role="status"
      aria-label="Loading"
    >
      <span className="sr-only">Loading...</span>
    </div>
  );
}

/** Skeleton for a message bubble */
export function MessageSkeleton() {
  return (
    <div className="flex animate-fadeIn" style={{ gap: "12px", padding: "12px var(--space-md)" }} role="status" aria-label="Loading message">
      <Skeleton width="32px" height="32px" rounded="full" />
      <div className="flex-1" style={{ display: "flex", flexDirection: "column", gap: "var(--space-sm)" }}>
        <Skeleton width="40%" height="12px" />
        <Skeleton width="80%" height="14px" />
        <Skeleton width="60%" height="14px" />
      </div>
    </div>
  );
}

/** Skeleton for an agent card */
export function AgentCardSkeleton() {
  return (
    <div
      style={{
        borderRadius: "var(--radius-lg)",
        padding: "var(--space-md)",
        background: "var(--surface-2)",
        border: "1px solid var(--border-subtle)",
        display: "flex",
        flexDirection: "column",
        gap: "12px",
      }}
      role="status"
      aria-label="Loading worker"
    >
      <div className="flex items-center justify-between">
        <Skeleton width="120px" height="14px" />
        <Skeleton width="60px" height="20px" rounded="full" />
      </div>
      <Skeleton width="100%" height="6px" rounded="full" />
      <div className="flex justify-between">
        <Skeleton width="80px" height="10px" />
        <Skeleton width="50px" height="10px" />
      </div>
    </div>
  );
}

/** Skeleton for a cost card */
export function CostCardSkeleton() {
  return (
    <div
      style={{
        borderRadius: "var(--radius-lg)",
        padding: "12px",
        background: "var(--surface-2)",
        border: "1px solid var(--border-subtle)",
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-sm)",
      }}
      role="status"
      aria-label="Loading cost"
    >
      <Skeleton width="60px" height="10px" />
      <Skeleton width="80px" height="24px" />
    </div>
  );
}

