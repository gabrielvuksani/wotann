/**
 * Paperclip button for file/image/URL attachment.
 * Uses Tauri's native file dialog when available, falls back to HTML input.
 *
 * Requires: npm install @tauri-apps/plugin-dialog
 *           + add "dialog" to tauri.conf.json plugins
 * Until the plugin is installed, falls back to the HTML file picker.
 */

interface AttachButtonProps {
  readonly onAttach?: (files: FileList) => void;
  readonly onAttachPaths?: (paths: readonly string[]) => void;
}

async function openNativeDialog(): Promise<readonly string[] | null> {
  try {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const result = await open({
      multiple: true,
      title: "Attach files",
      filters: [
        {
          name: "Code & Docs",
          extensions: [
            "ts", "tsx", "js", "jsx", "py", "rs", "go",
            "md", "txt", "json", "yaml", "yml", "toml",
          ],
        },
        {
          name: "Images",
          extensions: ["png", "jpg", "jpeg", "svg", "gif", "webp"],
        },
      ],
    });
    if (!result) return null;
    // open() returns string | string[] | null depending on `multiple`
    return Array.isArray(result) ? result : [result];
  } catch {
    // Plugin not installed or not running in Tauri — return null to trigger fallback
    return null;
  }
}

export function AttachButton({ onAttach, onAttachPaths }: AttachButtonProps) {
  const handleClick = async () => {
    // Try native Tauri dialog first
    const nativePaths = await openNativeDialog();
    if (nativePaths && nativePaths.length > 0) {
      onAttachPaths?.(nativePaths);
      return;
    }

    // Fallback to HTML file input
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = true;
    input.accept = ".ts,.tsx,.js,.jsx,.py,.rs,.go,.md,.txt,.json,.yaml,.yml,.toml,.png,.jpg,.svg";
    input.onchange = () => {
      if (input.files && input.files.length > 0) {
        onAttach?.(input.files);
      }
    };
    input.click();
  };

  return (
    <button
      onClick={handleClick}
      className="shrink-0 flex items-center justify-center rounded-md transition-colors"
      style={{
        width: 32,
        height: 32,
        minWidth: 32,
        minHeight: 32,
        background: "transparent",
        border: "none",
        color: "var(--color-text-muted)",
        cursor: "pointer",
        transition: "color 150ms ease",
      }}
      onMouseEnter={(e) => { e.currentTarget.style.color = "var(--color-text-secondary)"; }}
      onMouseLeave={(e) => { e.currentTarget.style.color = "var(--color-text-muted)"; }}
      aria-label="Attach file"
      title="Attach file"
    >
      <svg width="16" height="16" viewBox="-1 -1 18 18" fill="none" aria-hidden="true">
        <path
          d="M14 8l-6.5 6.5a4.5 4.5 0 01-6.364-6.364L8 1.272a3 3 0 014.243 4.243L5.38 12.38a1.5 1.5 0 01-2.122-2.122L10 3.5"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
      </svg>
    </button>
  );
}
