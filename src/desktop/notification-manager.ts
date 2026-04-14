/**
 * Notification Manager — native macOS notification management for the desktop app.
 *
 * Manages a queue of notifications with:
 * - Sound settings per type
 * - Badge count tracking
 * - Do Not Disturb mode
 * - Action buttons (view, dismiss)
 * - Read/unread state tracking
 *
 * Actual macOS notification delivery is delegated to Tauri's
 * notification API — this module manages the state and queue.
 */

import type { AppNotification } from "./app-state.js";

// ── Types ──────────────────────────────────────────────

export type NotificationType = AppNotification["type"];

export interface NotificationPreferences {
  readonly enabled: boolean;
  readonly doNotDisturb: boolean;
  readonly soundEnabled: boolean;
  readonly badgeEnabled: boolean;
  readonly typeSettings: Readonly<Record<NotificationType, boolean>>;
}

export interface NotificationStats {
  readonly total: number;
  readonly unread: number;
  readonly byType: Readonly<Record<NotificationType, number>>;
}

// ── Defaults ───────────────────────────────────────────

export const DEFAULT_PREFERENCES: NotificationPreferences = {
  enabled: true,
  doNotDisturb: false,
  soundEnabled: true,
  badgeEnabled: true,
  typeSettings: {
    "task-complete": true,
    "error": true,
    "channel-message": true,
    "budget-alert": true,
    "companion-paired": true,
  },
};

// ── ID Generation ──────────────────────────────────────

let notifIdCounter = 0;

function generateNotificationId(): string {
  notifIdCounter++;
  const timestamp = Date.now().toString(36);
  return `notif_${timestamp}_${notifIdCounter}`;
}

// ── Notification Factory ───────────────────────────────

export function createNotification(
  type: NotificationType,
  title: string,
  body: string,
  actionUrl?: string,
): AppNotification {
  return {
    id: generateNotificationId(),
    type,
    title,
    body,
    timestamp: new Date().toISOString(),
    read: false,
    actionUrl,
  };
}

// ── Notification Manager ───────────────────────────────

export class NotificationManager {
  private notifications: readonly AppNotification[] = [];
  private preferences: NotificationPreferences;

  constructor(preferences?: Partial<NotificationPreferences>) {
    this.preferences = { ...DEFAULT_PREFERENCES, ...preferences };
  }

  /**
   * Queue a new notification. Returns the notification if it passes
   * DND and type filters, or null if suppressed.
   */
  push(
    type: NotificationType,
    title: string,
    body: string,
    actionUrl?: string,
  ): AppNotification | null {
    if (!this.shouldDeliver(type)) return null;

    const notification = createNotification(type, title, body, actionUrl);
    this.notifications = [...this.notifications, notification];
    return notification;
  }

  /**
   * Mark a notification as read (immutable).
   */
  markRead(id: string): boolean {
    const exists = this.notifications.some((n) => n.id === id);
    if (!exists) return false;

    this.notifications = this.notifications.map((n) =>
      n.id === id ? { ...n, read: true } : n,
    );
    return true;
  }

  /**
   * Mark all notifications as read.
   */
  markAllRead(): void {
    this.notifications = this.notifications.map((n) =>
      n.read ? n : { ...n, read: true },
    );
  }

  /**
   * Dismiss (remove) a notification.
   */
  dismiss(id: string): boolean {
    const before = this.notifications.length;
    this.notifications = this.notifications.filter((n) => n.id !== id);
    return this.notifications.length < before;
  }

  /**
   * Dismiss all notifications.
   */
  dismissAll(): void {
    this.notifications = [];
  }

  /**
   * Get all notifications, newest first.
   */
  getAll(): readonly AppNotification[] {
    return [...this.notifications].reverse();
  }

  /**
   * Get unread notifications only.
   */
  getUnread(): readonly AppNotification[] {
    return this.notifications.filter((n) => !n.read).reverse();
  }

  /**
   * Get the badge count (unread notifications).
   */
  getBadgeCount(): number {
    if (!this.preferences.badgeEnabled) return 0;
    return this.notifications.filter((n) => !n.read).length;
  }

  /**
   * Get notification statistics.
   */
  getStats(): NotificationStats {
    const byType: Record<string, number> = {
      "task-complete": 0,
      "error": 0,
      "channel-message": 0,
      "budget-alert": 0,
      "companion-paired": 0,
    };

    for (const n of this.notifications) {
      byType[n.type] = (byType[n.type] ?? 0) + 1;
    }

    return {
      total: this.notifications.length,
      unread: this.notifications.filter((n) => !n.read).length,
      byType: byType as Record<NotificationType, number>,
    };
  }

  /**
   * Toggle Do Not Disturb mode.
   */
  setDoNotDisturb(enabled: boolean): void {
    this.preferences = { ...this.preferences, doNotDisturb: enabled };
  }

  /**
   * Update notification type setting.
   */
  setTypeEnabled(type: NotificationType, enabled: boolean): void {
    this.preferences = {
      ...this.preferences,
      typeSettings: { ...this.preferences.typeSettings, [type]: enabled },
    };
  }

  /**
   * Get current preferences (read-only snapshot).
   */
  getPreferences(): NotificationPreferences {
    return this.preferences;
  }

  /**
   * Check if a notification type should be delivered given current settings.
   */
  private shouldDeliver(type: NotificationType): boolean {
    if (!this.preferences.enabled) return false;
    if (this.preferences.doNotDisturb) return false;
    return this.preferences.typeSettings[type] ?? true;
  }
}
