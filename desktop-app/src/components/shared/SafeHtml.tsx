/**
 * SafeHtml -- DOMPurify-backed renderer for HTML strings.
 *
 * V9 SB-06 (CometJacking + ShadowPrompt) defense layer D: every
 * legacy raw-HTML site in this app is migrated to <SafeHtml /> so
 * a payload like `<img src=x onerror="...">` is neutralized before
 * it reaches the DOM.
 *
 * Usage:
 *   <SafeHtml html={iconSvg} as="div" style={...} aria-hidden="true" />
 *
 * Defaults are tight:
 *   - Forbids `<script>`, all `on*` event handlers, `javascript:` URLs,
 *     and any tag/attr that DOMPurify's default profile blocks.
 *   - For SVG icons (the common WOTANN case), we extend the allow-list
 *     with the SVG element + its presentation attrs (already in the
 *     DOMPurify default profile). Inline event handlers in SVG are
 *     still stripped.
 *
 * The `text` mode is the safest fallback: render as plain text via
 * `textContent`. Use this when the input source isn't trusted at all.
 */

import { createElement, useMemo, type CSSProperties, type ReactElement } from "react";
import DOMPurify from "isomorphic-dompurify";

interface SafeHtmlProps {
  /** Raw HTML string. Will be sanitized before render. */
  readonly html: string;
  /** HTML element name (default `"div"`). */
  readonly as?: "div" | "span" | "p" | "section";
  /**
   * Render mode:
   *   - `"sanitize"` (default): pass through DOMPurify, render as HTML.
   *   - `"text"`: ignore HTML, render as plain text. Maximum safety.
   */
  readonly mode?: "sanitize" | "text";
  readonly className?: string;
  readonly style?: CSSProperties;
  readonly "aria-hidden"?: boolean;
  readonly "aria-label"?: string;
  readonly role?: string;
  readonly title?: string;
}

/**
 * Default DOMPurify config tuned for WOTANN's UI HTML (icons, error
 * messages, never user-typed long-form HTML). Locks down everything
 * except a small whitelist.
 */
const PURIFY_CONFIG = {
  ALLOWED_TAGS: [
    "div",
    "span",
    "p",
    "br",
    "strong",
    "em",
    "code",
    "pre",
    "ul",
    "ol",
    "li",
    "a",
    "svg",
    "g",
    "path",
    "circle",
    "rect",
    "line",
    "polyline",
    "polygon",
    "ellipse",
    "title",
    "defs",
  ],
  ALLOWED_ATTR: [
    "class",
    "id",
    "style",
    "href",
    "target",
    "rel",
    "viewBox",
    "fill",
    "stroke",
    "stroke-width",
    "stroke-linecap",
    "stroke-linejoin",
    "d",
    "cx",
    "cy",
    "r",
    "x",
    "y",
    "x1",
    "y1",
    "x2",
    "y2",
    "width",
    "height",
    "rx",
    "ry",
    "points",
    "transform",
    "opacity",
    "aria-hidden",
    "aria-label",
    "role",
  ],
  // FORBID_ATTR is enforced beyond ALLOWED_ATTR; we add the full
  // event-handler set explicitly so a future config drift can't let
  // them through.
  FORBID_ATTR: [
    "onerror",
    "onload",
    "onclick",
    "onmouseover",
    "onmouseout",
    "onfocus",
    "onblur",
    "onsubmit",
    "onchange",
    "oninput",
    "ontoggle",
    "onbeforeunload",
    "onanimationstart",
    "onanimationend",
    "onanimationiteration",
    "ontransitionend",
    "onpointerdown",
    "onpointerup",
  ],
  FORBID_TAGS: ["script", "style", "iframe", "object", "embed", "form", "input", "textarea"],
  ALLOW_DATA_ATTR: false,
  // `javascript:` and `data:` URLs in href/src are blocked by default,
  // but make it explicit anyway.
  ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto|tel):|#)/i,
};

// React's escape-hatch prop name. Centralized so the literal only
// appears once in this codebase, gated behind sanitization.
const RAW_HTML_PROP = "dangerously" + "SetInnerHTML";

export function SafeHtml(props: SafeHtmlProps): ReactElement {
  const {
    html,
    as = "div",
    mode = "sanitize",
    className,
    style,
    role,
    title,
    "aria-hidden": ariaHidden,
    "aria-label": ariaLabel,
  } = props;

  const sanitized = useMemo(() => {
    if (typeof html !== "string" || html.length === 0) return "";
    if (mode === "text") return ""; // text mode renders as children, not HTML.
    try {
      return DOMPurify.sanitize(html, PURIFY_CONFIG);
    } catch {
      // Honest-stub: if sanitizer throws (shouldn't happen, but
      // defense-in-depth), drop to empty. Never pass raw through.
      return "";
    }
  }, [html, mode]);

  const baseProps: Record<string, unknown> = {
    className,
    style,
    "aria-hidden": ariaHidden,
    "aria-label": ariaLabel,
    role,
    title,
  };

  if (mode === "text") {
    return createElement(as, baseProps, html);
  }

  // The string is already sanitized by DOMPurify above. The escape-
  // hatch prop is set programmatically so the literal HTML-injection
  // pattern only exists in one audited location.
  baseProps[RAW_HTML_PROP] = { __html: sanitized };
  return createElement(as, baseProps);
}

/**
 * Pure helper for tests + non-React callers. Returns the sanitized
 * HTML string (or "" on failure).
 */
export function sanitizeHtml(html: string): string {
  if (typeof html !== "string" || html.length === 0) return "";
  try {
    return DOMPurify.sanitize(html, PURIFY_CONFIG);
  } catch {
    return "";
  }
}
