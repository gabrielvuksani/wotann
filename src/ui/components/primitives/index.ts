/**
 * Primitives barrel — re-export the design-system surface so callers
 * can do `import { Card, Banner, Spinner } from "../primitives";`
 * instead of digging through individual files.
 *
 * Keeping the barrel small and explicit avoids accidental re-export
 * of internals (helper types, default styles) that should stay
 * private to the primitive that owns them.
 */

export { Banner, BannerRule } from "./Banner.js";
export type { BannerProps } from "./Banner.js";

export { Card, Section } from "./Card.js";
export type { CardProps, SectionProps } from "./Card.js";

export { KeyHint, KeyHintBar } from "./KeyHint.js";
export type { KeyBinding, KeyHintBarProps } from "./KeyHint.js";

export { StatusBadge, Pill } from "./StatusBadge.js";
export type { StatusBadgeProps, StatusVariant } from "./StatusBadge.js";

export { ProgressMeter, GradientBar } from "./ProgressMeter.js";
export type { ProgressMeterProps, GradientBarProps } from "./ProgressMeter.js";

export { Spinner } from "./Spinner.js";
export type { SpinnerProps } from "./Spinner.js";

export { Notification } from "./Notification.js";
export type { NotificationProps, NotificationKind } from "./Notification.js";
