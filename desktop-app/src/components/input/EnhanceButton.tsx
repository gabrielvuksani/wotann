/**
 * Sparkles button for prompt enhancement.
 * Wired to store's enhancePrompt action.
 */

import { useState } from "react";

interface EnhanceButtonProps {
  readonly onClick: () => void;
  readonly disabled?: boolean;
}

export function EnhanceButton({ onClick, disabled }: EnhanceButtonProps) {
  const [isEnhancing, setIsEnhancing] = useState(false);

  const handleClick = async () => {
    setIsEnhancing(true);
    try {
      await onClick();
    } finally {
      setIsEnhancing(false);
    }
  };

  return (
    <button
      onClick={handleClick}
      disabled={disabled || isEnhancing}
      className={`shrink-0 flex items-center justify-center rounded-md transition-all ${
        isEnhancing ? "animate-pulse" : ""
      } disabled:opacity-40 disabled:cursor-not-allowed`}
      style={{
        width: 32,
        height: 32,
        minWidth: 32,
        minHeight: 32,
        background: isEnhancing ? "var(--accent-muted)" : "transparent",
        color: isEnhancing ? "var(--color-primary)" : "var(--color-text-muted)",
        border: "none",
        cursor: disabled ? "not-allowed" : "pointer",
        transition: "color 150ms ease, box-shadow 150ms ease",
      }}
      onMouseEnter={(e) => {
        if (!disabled && !isEnhancing) {
          e.currentTarget.style.color = "var(--color-primary)";
          e.currentTarget.style.boxShadow = "0 0 8px rgba(10, 132, 255, 0.2)";
        }
      }}
      onMouseLeave={(e) => {
        if (!isEnhancing) {
          e.currentTarget.style.color = "var(--color-text-muted)";
          e.currentTarget.style.boxShadow = "none";
        }
      }}
      aria-label={isEnhancing ? "Enhancing prompt..." : "Enhance prompt"}
      title="Enhance prompt"
    >
      <svg
        width="16"
        height="16"
        viewBox="0 0 16 16"
        fill="none"
        className={isEnhancing ? "animate-spin" : ""}
        aria-hidden="true"
      >
        <path
          d="M8 1l1.5 3.5L13 6l-3.5 1.5L8 11l-1.5-3.5L3 6l3.5-1.5z"
          fill="currentColor"
        />
        <path
          d="M12 9l.75 1.75L14.5 11.5l-1.75.75L12 14l-.75-1.75-1.75-.75 1.75-.75z"
          fill="currentColor"
          opacity="0.6"
        />
      </svg>
    </button>
  );
}
