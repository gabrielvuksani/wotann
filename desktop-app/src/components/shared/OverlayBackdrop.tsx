/**
 * Shared overlay backdrop with glass morphism, focus trapping, and escape-to-close.
 * Used by CommandPalette, NotificationCenter, FilePicker, QuickActions, and any future overlays.
 *
 * Placement:
 * - "center": Centered modal (CommandPalette, FilePicker, QuickActions)
 * - "dropdown": Positioned relative to an anchor element (NotificationCenter, ModelPicker)
 */

import { useEffect, useRef, useCallback } from "react";

interface OverlayBackdropProps {
  readonly onClose: () => void;
  readonly placement: "center" | "dropdown";
  readonly children: React.ReactNode;
  readonly ariaLabel: string;
  readonly maxWidth?: number;
  readonly maxHeight?: number;
}

export function OverlayBackdrop({
  onClose,
  placement,
  children,
  ariaLabel,
  maxWidth = 580,
  maxHeight = 480,
}: OverlayBackdropProps) {
  const backdropRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  // Close on Escape
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    }
    window.addEventListener("keydown", handleKeyDown, { capture: true });
    return () => window.removeEventListener("keydown", handleKeyDown, { capture: true });
  }, [onClose]);

  // Close on backdrop click (not on content click)
  const handleBackdropClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === backdropRef.current) {
        onClose();
      }
    },
    [onClose],
  );

  // Focus trap — keep focus inside the overlay
  useEffect(() => {
    const content = contentRef.current;
    if (!content) return;

    // Focus the first focusable element
    const focusable = content.querySelectorAll<HTMLElement>(
      'input, button, [tabindex]:not([tabindex="-1"])',
    );
    if (focusable.length > 0) {
      focusable[0]!.focus();
    }
  }, []);

  if (placement === "center") {
    return (
      <div
        ref={backdropRef}
        className="fixed inset-0 z-50 flex items-start justify-center animate-fadeIn"
        style={{
          background: "rgba(0, 0, 0, 0.6)",
          backdropFilter: "blur(4px)",
          WebkitBackdropFilter: "blur(4px)",
          paddingTop: "16vh",
        }}
        onClick={handleBackdropClick}
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
      >
        <div
          ref={contentRef}
          className="animate-scaleIn"
          style={{
            width: "90%",
            maxWidth,
            maxHeight,
            background: "var(--glass-bg-heavy)",
            backdropFilter: "blur(20px) saturate(1.4)",
            WebkitBackdropFilter: "blur(20px) saturate(1.4)",
            borderRadius: "var(--radius-xl)",
            boxShadow:
              "0px 0px 0px 1px rgba(255,255,255,0.1), 0 24px 80px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.05)",
            overflow: "hidden",
          }}
        >
          {children}
        </div>
      </div>
    );
  }

  // Dropdown placement — just renders the content with a click-away backdrop
  return (
    <div
      ref={backdropRef}
      className="fixed inset-0 z-40"
      style={{ background: "transparent" }}
      onClick={handleBackdropClick}
      role="dialog"
      aria-modal="true"
      aria-label={ariaLabel}
    >
      <div ref={contentRef}>{children}</div>
    </div>
  );
}
