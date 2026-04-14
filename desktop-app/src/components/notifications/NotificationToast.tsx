/**
 * Notification Toast -- ephemeral overlay for real-time events.
 * Slide from right, auto-dismiss. Supports click-to-act.
 */

import { useState, useEffect, useCallback } from "react";

export interface ToastData {
  readonly id: string;
  readonly type: "success" | "error" | "warning" | "info";
  readonly title: string;
  readonly message?: string;
  readonly duration?: number;
  readonly action?: { label: string; onClick: () => void };
}

const TYPE_CONFIG: Record<ToastData["type"], { borderColor: string; bg: string; iconColor: string }> = {
  success: { borderColor: "rgba(16, 185, 129, 0.3)", bg: "var(--color-success-muted)", iconColor: "var(--color-success)" },
  error: { borderColor: "rgba(239, 68, 68, 0.3)", bg: "var(--color-error-muted)", iconColor: "var(--color-error)" },
  warning: { borderColor: "rgba(245, 158, 11, 0.3)", bg: "var(--color-warning-muted)", iconColor: "var(--color-warning)" },
  info: { borderColor: "rgba(96, 165, 250, 0.3)", bg: "var(--color-info-muted)", iconColor: "var(--info)" },
};

const TYPE_ICONS: Record<ToastData["type"], React.ReactNode> = {
  success: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.5" />
      <path d="M5.5 8l2 2 3-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  error: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.5" />
      <path d="M6 6l4 4M10 6l-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  ),
  warning: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <path d="M8 2L1.5 13h13L8 2z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M8 6v3M8 11.5v.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  ),
  info: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.5" />
      <path d="M8 7v4M8 5v.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  ),
};

interface NotificationToastProps {
  readonly toasts: readonly ToastData[];
  readonly onDismiss: (id: string) => void;
}

export function NotificationToast({ toasts, onDismiss }: NotificationToastProps) {
  return (
    <div className="fixed top-4 right-4 z-[100] flex flex-col gap-2 pointer-events-none" aria-live="polite" aria-label="Notifications">
      {toasts.map((toast) => (
        <SingleToast key={toast.id} toast={toast} onDismiss={onDismiss} />
      ))}
    </div>
  );
}

function SingleToast({
  toast,
  onDismiss,
}: {
  readonly toast: ToastData;
  readonly onDismiss: (id: string) => void;
}) {
  const [visible, setVisible] = useState(true);
  const config = TYPE_CONFIG[toast.type];

  const dismiss = useCallback(() => {
    setVisible(false);
    setTimeout(() => onDismiss(toast.id), 150);
  }, [toast.id, onDismiss]);

  useEffect(() => {
    const timer = setTimeout(dismiss, toast.duration ?? 5000);
    return () => clearTimeout(timer);
  }, [dismiss, toast.duration]);

  return (
    <div
      className={`pointer-events-auto max-w-sm w-full rounded-lg border shadow-lg transition-all duration-150 backdrop-blur-sm ${
        visible ? "opacity-100 translate-x-0 animate-toastIn" : "opacity-0 translate-x-4"
      }`}
      style={{ borderColor: config.borderColor, background: config.bg }}
      role="alert"
      aria-live="assertive"
    >
      <div className="flex items-start gap-3 p-3">
        <span className="flex-shrink-0 mt-0.5" style={{ color: config.iconColor }} aria-hidden="true">
          {TYPE_ICONS[toast.type]}
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium" style={{ color: "var(--color-text-primary)" }}>{toast.title}</p>
          {toast.message && (
            <p className="text-xs mt-0.5 line-clamp-2" style={{ color: "var(--color-text-dim)" }}>{toast.message}</p>
          )}
          {toast.action && (
            <button
              onClick={toast.action.onClick}
              className="text-xs mt-1 font-medium transition-colors"
              style={{ color: "var(--color-primary)" }}
            >
              {toast.action.label}
            </button>
          )}
        </div>
        <button
          onClick={dismiss}
          className="transition-colors flex-shrink-0"
          style={{ color: "var(--color-text-muted)" }}
          aria-label="Dismiss notification"
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>
      </div>
    </div>
  );
}
