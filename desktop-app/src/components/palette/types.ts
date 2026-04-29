/**
 * Shared types for the Cmd+K command palette.
 */

export type PaletteCategory =
  | "Recent"
  | "Actions"
  | "Models"
  | "Skills"
  | "Memory"
  | "Agents"
  | "Session"
  | "Intelligence"
  | "Autonomous"
  | "Workspace"
  | "Context"
  | "Navigation"
  | "Modes"
  | "Layout"
  | "Tools"
  | "Tools & Workflows"
  | "Operations"
  | "Security & Privacy"
  | "Power"
  | "Settings";

/** A single palette command. */
export interface PaletteCommand {
  readonly id: string;
  readonly title: string;
  readonly subtitle?: string;
  readonly category: PaletteCategory;
  readonly shortcut?: string;
  /** Lucide-like emoji glyph — no external icon deps. */
  readonly icon?: string;
  /** When provided, Tab cycles between the matching provider. */
  readonly providerFilter?: string;
  readonly action: () => void | Promise<void>;
}
