/**
 * DesignHandoffImporter — drop-zone for Claude Design handoff bundles.
 *
 * Phase F7 receiver UI. Accepts .zip files, calls Tauri IPC
 * `design.importBundle`, and shows imported component cards. If the IPC
 * endpoint isn't wired yet, we fall back to a stubbed "pending" state
 * instead of failing silently — honest errors, no silent success.
 */

import { useCallback, useRef, useState } from "react";
import type { DragEvent as ReactDragEvent, ChangeEvent as ReactChangeEvent, JSX as ReactJSX } from "react";
import { invoke } from "@tauri-apps/api/core";
import { color } from "../../design/tokens.generated";

export interface ImportedComponentSummary {
  readonly name: string;
  readonly type: string;
  readonly variants: readonly string[];
  readonly propCount: number;
  readonly previewPath?: string;
}

export interface ImportSummary {
  readonly bundleName: string;
  readonly version: string;
  readonly totalTokens: number;
  readonly componentCount: number;
  readonly outputDir: string;
  readonly components: readonly ImportedComponentSummary[];
  readonly status: "imported" | "pending" | "error";
  readonly message?: string;
}

type ImportStage = "idle" | "reading" | "importing" | "done" | "error";

interface ImportState {
  readonly stage: ImportStage;
  readonly summary?: ImportSummary;
  readonly errorMessage?: string;
  readonly selectedComponent?: string;
}

const INITIAL_STATE: ImportState = { stage: "idle" };

async function callImportBundle(path: string): Promise<ImportSummary> {
  try {
    const raw = await invoke<unknown>("design_import_bundle", { path });
    if (!raw || typeof raw !== "object") {
      throw new Error("design.importBundle: unexpected response shape");
    }
    const obj = raw as Record<string, unknown>;
    const bundleName = typeof obj["bundleName"] === "string" ? obj["bundleName"] : "";
    const version = typeof obj["version"] === "string" ? obj["version"] : "";
    const totalTokens = typeof obj["totalTokens"] === "number" ? obj["totalTokens"] : 0;
    const componentCount =
      typeof obj["componentCount"] === "number" ? obj["componentCount"] : 0;
    const outputDir = typeof obj["outputDir"] === "string" ? obj["outputDir"] : "";
    const componentsRaw = Array.isArray(obj["components"]) ? obj["components"] : [];
    const components: ImportedComponentSummary[] = componentsRaw
      .filter((c): c is Record<string, unknown> => typeof c === "object" && c !== null)
      .map((c) => ({
        name: typeof c["name"] === "string" ? c["name"] : "",
        type: typeof c["type"] === "string" ? c["type"] : "component",
        variants: Array.isArray(c["variants"])
          ? c["variants"].filter((v): v is string => typeof v === "string")
          : [],
        propCount: typeof c["propCount"] === "number" ? c["propCount"] : 0,
        ...(typeof c["previewPath"] === "string" ? { previewPath: c["previewPath"] } : {}),
      }));
    return {
      bundleName,
      version,
      totalTokens,
      componentCount,
      outputDir,
      components,
      status: "imported",
    };
  } catch (err) {
    // IPC not wired yet → surface an honest pending state with a clear
    // message rather than faking a success.
    const msg = err instanceof Error ? err.message : String(err);
    return {
      bundleName: path,
      version: "unknown",
      totalTokens: 0,
      componentCount: 0,
      outputDir: "",
      components: [],
      status: "pending",
      message: `Tauri RPC design.importBundle not yet wired (${msg}). Run the CLI: wotann import-design ${path}`,
    };
  }
}

export function DesignHandoffImporter(): ReactJSX.Element {
  const [state, setState] = useState<ImportState>(INITIAL_STATE);
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const acceptFile = useCallback(async (file: File): Promise<void> => {
    if (!file.name.toLowerCase().endsWith(".zip")) {
      setState({
        stage: "error",
        errorMessage: `Expected .zip handoff bundle, got "${file.name}"`,
      });
      return;
    }
    setState({ stage: "reading" });
    // In Tauri, File objects from drops expose `.path` via the tauri plugin.
    // We use the browser file name as a fallback label.
    const path =
      "path" in file && typeof (file as unknown as { path?: unknown }).path === "string"
        ? (file as unknown as { path: string }).path
        : file.name;
    setState({ stage: "importing" });
    const summary = await callImportBundle(path);
    if (summary.status === "error") {
      setState({ stage: "error", errorMessage: summary.message ?? "unknown error" });
      return;
    }
    setState({ stage: "done", summary });
  }, []);

  const onDrop = useCallback(
    (e: ReactDragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setIsDragOver(false);
      const file = e.dataTransfer.files[0];
      if (!file) {
        setState({ stage: "error", errorMessage: "No file was dropped" });
        return;
      }
      void acceptFile(file);
    },
    [acceptFile],
  );

  const onFileChange = useCallback(
    (e: ReactChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) void acceptFile(file);
    },
    [acceptFile],
  );

  const openFilePicker = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const reset = useCallback(() => {
    setState(INITIAL_STATE);
  }, []);

  const selectedSummary = state.summary;
  const selectedComponent = state.selectedComponent;
  const selected =
    selectedSummary && selectedComponent
      ? selectedSummary.components.find((c) => c.name === selectedComponent)
      : undefined;

  return (
    <div
      className="design-handoff-importer"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 16,
        padding: "var(--space-md, 16px)",
        height: "100%",
        overflow: "auto",
      }}
    >
      <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <h2 style={{ fontSize: "var(--font-size-md, 16px)", fontWeight: 600, margin: 0 }}>
            Claude Design Handoff
          </h2>
          <p
            style={{
              margin: "4px 0 0 0",
              fontSize: "var(--font-size-xs, 12px)",
              color: `var(--color-text-muted, ${color("muted")})`,
            }}
          >
            Import a .zip bundle from Anthropic Labs (2026-04-17 format) into Workshop.
          </p>
        </div>
        {state.stage === "done" && (
          <button
            type="button"
            onClick={reset}
            style={{
              padding: "6px 12px",
              fontSize: "var(--font-size-xs, 12px)",
              borderRadius: "var(--radius-sm, 6px)",
              border: `1px solid var(--border-subtle, ${color("border")})`,
              background: "transparent",
              cursor: "pointer",
            }}
          >
            Import another
          </button>
        )}
      </header>

      {state.stage !== "done" && (
        <div
          role="button"
          tabIndex={0}
          aria-label="Drop a Claude Design handoff bundle .zip here"
          onDrop={onDrop}
          onDragOver={(e) => {
            e.preventDefault();
            setIsDragOver(true);
          }}
          onDragLeave={() => setIsDragOver(false)}
          onClick={openFilePicker}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              openFilePicker();
            }
          }}
          style={{
            border: `2px dashed ${isDragOver ? `var(--color-primary, ${color("accent")})` : `var(--border-subtle, ${color("border")})`}`,
            borderRadius: "var(--radius-lg, 12px)",
            padding: "48px 24px",
            textAlign: "center",
            cursor: "pointer",
            background: isDragOver
              ? "var(--accent-muted, rgba(10,132,255,0.08))"
              : "var(--surface-1, transparent)",
            transition: "background 150ms, border-color 150ms",
          }}
        >
          <div style={{ fontSize: 32, marginBottom: 8 }}>⇱</div>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>
            {state.stage === "reading" && "Reading bundle..."}
            {state.stage === "importing" && "Importing..."}
            {state.stage === "error" && "Import failed"}
            {state.stage === "idle" && "Drop handoff.zip here"}
          </div>
          <div
            style={{
              fontSize: "var(--font-size-xs, 12px)",
              color: `var(--color-text-muted, ${color("muted")})`,
            }}
          >
            or click to browse
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept=".zip,application/zip"
            onChange={onFileChange}
            style={{ display: "none" }}
            aria-hidden="true"
          />
        </div>
      )}

      {state.stage === "error" && (
        <div
          role="alert"
          style={{
            padding: 12,
            borderRadius: "var(--radius-sm, 6px)",
            border: `1px solid var(--color-danger, ${color("error")})`,
            background: "rgba(231,76,60,0.08)",
            color: `var(--color-danger, ${color("error")})`,
            fontSize: "var(--font-size-xs, 12px)",
          }}
        >
          {state.errorMessage}
        </div>
      )}

      {state.stage === "done" && selectedSummary && (
        <>
          <section
            style={{
              padding: 16,
              borderRadius: "var(--radius-md, 8px)",
              border: `1px solid var(--border-subtle, ${color("border")})`,
              background: "var(--surface-1, transparent)",
            }}
          >
            <div style={{ fontSize: "var(--font-size-xs, 12px)", color: `var(--color-text-muted, ${color("muted")})` }}>
              {selectedSummary.status === "pending"
                ? "Import pending — backend not yet wired"
                : "Import complete"}
            </div>
            <div style={{ marginTop: 4, fontSize: "var(--font-size-md, 16px)", fontWeight: 600 }}>
              {selectedSummary.bundleName}{" "}
              <span
                style={{
                  fontSize: "var(--font-size-xs, 12px)",
                  color: `var(--color-text-muted, ${color("muted")})`,
                  fontWeight: 400,
                }}
              >
                v{selectedSummary.version}
              </span>
            </div>
            {selectedSummary.message && (
              <div
                style={{
                  marginTop: 8,
                  fontSize: "var(--font-size-xs, 12px)",
                  color: `var(--color-warning, ${color("warning")})`,
                }}
              >
                {selectedSummary.message}
              </div>
            )}
            <dl
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(3, 1fr)",
                gap: 16,
                marginTop: 12,
                marginBottom: 0,
              }}
            >
              <div>
                <dt style={{ fontSize: "var(--font-size-2xs, 10px)", color: `var(--color-text-muted, ${color("muted")})` }}>
                  Tokens
                </dt>
                <dd style={{ margin: 0, fontSize: "var(--font-size-md, 16px)", fontWeight: 600 }}>
                  {selectedSummary.totalTokens}
                </dd>
              </div>
              <div>
                <dt style={{ fontSize: "var(--font-size-2xs, 10px)", color: `var(--color-text-muted, ${color("muted")})` }}>
                  Components
                </dt>
                <dd style={{ margin: 0, fontSize: "var(--font-size-md, 16px)", fontWeight: 600 }}>
                  {selectedSummary.componentCount}
                </dd>
              </div>
              <div>
                <dt style={{ fontSize: "var(--font-size-2xs, 10px)", color: `var(--color-text-muted, ${color("muted")})` }}>
                  Location
                </dt>
                <dd
                  style={{
                    margin: 0,
                    fontSize: "var(--font-size-2xs, 10px)",
                    fontFamily: "var(--font-mono, monospace)",
                    wordBreak: "break-all",
                  }}
                >
                  {selectedSummary.outputDir || "(pending)"}
                </dd>
              </div>
            </dl>
          </section>

          {selectedSummary.components.length > 0 && (
            <section>
              <h3
                style={{
                  fontSize: "var(--font-size-sm, 14px)",
                  fontWeight: 600,
                  margin: "0 0 8px 0",
                }}
              >
                Imported components
              </h3>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))",
                  gap: 12,
                }}
              >
                {selectedSummary.components.map((comp) => {
                  const isSelected = selected?.name === comp.name;
                  return (
                    <button
                      key={comp.name}
                      type="button"
                      onClick={() =>
                        setState((prev) => ({ ...prev, selectedComponent: comp.name }))
                      }
                      style={{
                        padding: 12,
                        textAlign: "left",
                        border: `1px solid ${isSelected ? `var(--color-primary, ${color("accent")})` : `var(--border-subtle, ${color("border")})`}`,
                        borderRadius: "var(--radius-md, 8px)",
                        background: isSelected
                          ? "var(--accent-muted, rgba(10,132,255,0.08))"
                          : "var(--surface-1, transparent)",
                        cursor: "pointer",
                      }}
                    >
                      <div style={{ fontWeight: 600, fontSize: "var(--font-size-sm, 14px)" }}>
                        {comp.name}
                      </div>
                      <div
                        style={{
                          fontSize: "var(--font-size-2xs, 10px)",
                          color: `var(--color-text-muted, ${color("muted")})`,
                          marginTop: 4,
                        }}
                      >
                        {comp.type} · {comp.propCount} prop{comp.propCount === 1 ? "" : "s"} ·{" "}
                        {comp.variants.length} variant{comp.variants.length === 1 ? "" : "s"}
                      </div>
                    </button>
                  );
                })}
              </div>
            </section>
          )}

          {selected?.previewPath && (
            <section>
              <h3
                style={{
                  fontSize: "var(--font-size-sm, 14px)",
                  fontWeight: 600,
                  margin: "0 0 8px 0",
                }}
              >
                Preview: {selected.name}
              </h3>
              <iframe
                title={`Preview of ${selected.name}`}
                src={selected.previewPath}
                sandbox="allow-same-origin"
                style={{
                  width: "100%",
                  height: 320,
                  border: `1px solid var(--border-subtle, ${color("border")})`,
                  borderRadius: "var(--radius-md, 8px)",
                  background: "white",
                }}
              />
            </section>
          )}
        </>
      )}
    </div>
  );
}

export default DesignHandoffImporter;
