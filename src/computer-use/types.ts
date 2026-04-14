/**
 * Computer use types for the 4-layer hybrid strategy.
 */

export type CULayer = "api" | "a11y" | "vision" | "text-mediated";

export interface ScreenElement {
  readonly index: number;
  readonly type: "button" | "link" | "input" | "text" | "image" | "tab" | "menu" | "checkbox" | "select";
  readonly label: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly focused: boolean;
  readonly disabled: boolean;
  readonly value?: string;
}

export interface ActiveWindow {
  readonly name: string;
  readonly app: string;
  readonly pid: number;
  readonly bounds: { x: number; y: number; width: number; height: number };
}

export interface Perception {
  readonly screenshot: Buffer | null;
  readonly a11yTree: unknown | null;
  readonly elements: readonly ScreenElement[];
  readonly activeWindow: ActiveWindow;
  readonly timestamp: number;
}

export type Modifier = "ctrl" | "alt" | "shift" | "cmd" | "super";

/** Model-universal element targeting.
 * Vision models use coordinates. Text-only models use indices or labels. */
export type ElementRef =
  | { readonly by: "coordinate"; readonly x: number; readonly y: number }
  | { readonly by: "index"; readonly index: number }
  | { readonly by: "label"; readonly text: string }
  | { readonly by: "role"; readonly role: string; readonly nth?: number };

export type CUAction =
  // Basic mouse
  | { readonly type: "click"; readonly x?: number; readonly y?: number; readonly elementIndex?: number; readonly button?: "left" | "right" | "middle"; readonly modifiers?: readonly Modifier[] }
  | { readonly type: "double_click"; readonly x?: number; readonly y?: number; readonly elementIndex?: number }
  | { readonly type: "triple_click"; readonly x?: number; readonly y?: number; readonly elementIndex?: number }
  | { readonly type: "mouse_move"; readonly x: number; readonly y: number }
  // Drag
  | { readonly type: "drag"; readonly startX: number; readonly startY: number; readonly endX: number; readonly endY: number }
  | { readonly type: "mouse_down"; readonly x?: number; readonly y?: number; readonly button?: "left" | "right" }
  | { readonly type: "mouse_up"; readonly x?: number; readonly y?: number; readonly button?: "left" | "right" }
  // Scroll
  | { readonly type: "scroll"; readonly direction: "up" | "down" | "left" | "right"; readonly amount?: number }
  // Keyboard
  | { readonly type: "type"; readonly text: string }
  | { readonly type: "key"; readonly combo: string; readonly modifiers?: readonly Modifier[] }
  | { readonly type: "hold_key"; readonly key: string; readonly durationMs: number }
  // App/window management
  | { readonly type: "open"; readonly app: string }
  | { readonly type: "close_window" }
  | { readonly type: "minimize_window" }
  | { readonly type: "maximize_window" }
  | { readonly type: "switch_window"; readonly app?: string; readonly title?: string }
  // Utility
  | { readonly type: "wait"; readonly ms: number }
  | { readonly type: "screenshot" }
  | { readonly type: "zoom"; readonly region: { x: number; y: number; width: number; height: number } }
  | { readonly type: "clipboard_copy" }
  | { readonly type: "clipboard_paste" }
  | { readonly type: "switch_display"; readonly displayIndex: number };

export interface ComputerUseEvent {
  readonly type: "action" | "perception" | "complete" | "error" | "api-route";
  readonly action?: CUAction;
  readonly screenText?: string;
  readonly result?: string;
  readonly error?: string;
}

export interface APIRoute {
  readonly pattern: RegExp;
  readonly handler: string;
  readonly description: string;
}

export interface CUGuardrails {
  readonly blockedDomains: readonly string[];
  readonly maxActionsPerMinute: number;
  readonly requirePermissionFor: readonly string[];
  readonly redactPasswords: boolean;
}
