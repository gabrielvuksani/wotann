import { describe, it, expect } from "vitest";
import {
  NotificationManager,
  createNotification,
  DEFAULT_PREFERENCES,
} from "../../src/desktop/notification-manager.js";

// ── Factory Tests ──────────────────────────────────────

describe("createNotification", () => {
  it("should create a notification with defaults", () => {
    const notif = createNotification("task-complete", "Done", "Task finished");
    expect(notif.id).toMatch(/^notif_/);
    expect(notif.type).toBe("task-complete");
    expect(notif.title).toBe("Done");
    expect(notif.body).toBe("Task finished");
    expect(notif.read).toBe(false);
    expect(notif.timestamp).toBeTruthy();
  });

  it("should include an actionUrl when provided", () => {
    const notif = createNotification("error", "Error", "Something broke", "/view/error");
    expect(notif.actionUrl).toBe("/view/error");
  });

  it("should generate unique IDs", () => {
    const a = createNotification("error", "A", "a");
    const b = createNotification("error", "B", "b");
    expect(a.id).not.toBe(b.id);
  });
});

// ── Default Preferences Tests ──────────────────────────

describe("DEFAULT_PREFERENCES", () => {
  it("should have notifications enabled by default", () => {
    expect(DEFAULT_PREFERENCES.enabled).toBe(true);
    expect(DEFAULT_PREFERENCES.doNotDisturb).toBe(false);
    expect(DEFAULT_PREFERENCES.soundEnabled).toBe(true);
    expect(DEFAULT_PREFERENCES.badgeEnabled).toBe(true);
  });

  it("should enable all notification types by default", () => {
    expect(DEFAULT_PREFERENCES.typeSettings["task-complete"]).toBe(true);
    expect(DEFAULT_PREFERENCES.typeSettings["error"]).toBe(true);
    expect(DEFAULT_PREFERENCES.typeSettings["channel-message"]).toBe(true);
    expect(DEFAULT_PREFERENCES.typeSettings["budget-alert"]).toBe(true);
    expect(DEFAULT_PREFERENCES.typeSettings["companion-paired"]).toBe(true);
  });
});

// ── NotificationManager Tests ──────────────────────────

describe("NotificationManager", () => {
  it("should push a notification", () => {
    const mgr = new NotificationManager();
    const notif = mgr.push("task-complete", "Done", "Task finished");

    expect(notif).not.toBeNull();
    expect(notif?.type).toBe("task-complete");
    expect(mgr.getAll()).toHaveLength(1);
  });

  it("should return notifications newest first", () => {
    const mgr = new NotificationManager();
    mgr.push("task-complete", "First", "1");
    mgr.push("task-complete", "Second", "2");
    mgr.push("task-complete", "Third", "3");

    const all = mgr.getAll();
    expect(all[0]?.title).toBe("Third");
    expect(all[2]?.title).toBe("First");
  });

  it("should mark a notification as read", () => {
    const mgr = new NotificationManager();
    const notif = mgr.push("task-complete", "Done", "body");
    expect(notif).not.toBeNull();

    expect(mgr.markRead(notif!.id)).toBe(true);
    expect(mgr.getUnread()).toHaveLength(0);
  });

  it("should return false when marking non-existent as read", () => {
    const mgr = new NotificationManager();
    expect(mgr.markRead("nope")).toBe(false);
  });

  it("should mark all as read", () => {
    const mgr = new NotificationManager();
    mgr.push("task-complete", "A", "1");
    mgr.push("error", "B", "2");
    mgr.push("channel-message", "C", "3");

    mgr.markAllRead();
    expect(mgr.getUnread()).toHaveLength(0);
    expect(mgr.getBadgeCount()).toBe(0);
  });

  it("should dismiss a notification", () => {
    const mgr = new NotificationManager();
    const notif = mgr.push("error", "Oops", "body");
    expect(notif).not.toBeNull();

    expect(mgr.dismiss(notif!.id)).toBe(true);
    expect(mgr.getAll()).toHaveLength(0);
  });

  it("should return false when dismissing non-existent", () => {
    const mgr = new NotificationManager();
    expect(mgr.dismiss("nope")).toBe(false);
  });

  it("should dismiss all notifications", () => {
    const mgr = new NotificationManager();
    mgr.push("task-complete", "A", "1");
    mgr.push("error", "B", "2");
    mgr.dismissAll();
    expect(mgr.getAll()).toHaveLength(0);
  });

  it("should track badge count", () => {
    const mgr = new NotificationManager();
    mgr.push("task-complete", "A", "1");
    mgr.push("error", "B", "2");
    expect(mgr.getBadgeCount()).toBe(2);

    const notif = mgr.getAll()[0];
    mgr.markRead(notif!.id);
    expect(mgr.getBadgeCount()).toBe(1);
  });

  it("should return 0 badge count when badges disabled", () => {
    const mgr = new NotificationManager({ badgeEnabled: false });
    mgr.push("task-complete", "A", "1");
    expect(mgr.getBadgeCount()).toBe(0);
  });

  it("should get notification stats", () => {
    const mgr = new NotificationManager();
    mgr.push("task-complete", "A", "1");
    mgr.push("error", "B", "2");
    mgr.push("error", "C", "3");

    const stats = mgr.getStats();
    expect(stats.total).toBe(3);
    expect(stats.unread).toBe(3);
    expect(stats.byType["task-complete"]).toBe(1);
    expect(stats.byType["error"]).toBe(2);
  });

  // ── DND Tests ────────────────────────────────────────

  it("should suppress notifications in DND mode", () => {
    const mgr = new NotificationManager();
    mgr.setDoNotDisturb(true);

    const notif = mgr.push("task-complete", "Done", "body");
    expect(notif).toBeNull();
    expect(mgr.getAll()).toHaveLength(0);
  });

  it("should resume delivery after DND off", () => {
    const mgr = new NotificationManager();
    mgr.setDoNotDisturb(true);
    mgr.setDoNotDisturb(false);

    const notif = mgr.push("task-complete", "Done", "body");
    expect(notif).not.toBeNull();
  });

  // ── Type Filter Tests ────────────────────────────────

  it("should suppress disabled notification types", () => {
    const mgr = new NotificationManager();
    mgr.setTypeEnabled("budget-alert", false);

    const notif = mgr.push("budget-alert", "Alert", "body");
    expect(notif).toBeNull();
  });

  it("should still deliver enabled types", () => {
    const mgr = new NotificationManager();
    mgr.setTypeEnabled("budget-alert", false);

    const notif = mgr.push("task-complete", "Done", "body");
    expect(notif).not.toBeNull();
  });

  it("should suppress all when master switch is off", () => {
    const mgr = new NotificationManager({ enabled: false });
    const notif = mgr.push("task-complete", "Done", "body");
    expect(notif).toBeNull();
  });

  // ── Preferences Tests ────────────────────────────────

  it("should return current preferences", () => {
    const mgr = new NotificationManager();
    const prefs = mgr.getPreferences();
    expect(prefs.enabled).toBe(true);
    expect(prefs.doNotDisturb).toBe(false);
  });

  it("should accept partial preferences on construction", () => {
    const mgr = new NotificationManager({ soundEnabled: false });
    const prefs = mgr.getPreferences();
    expect(prefs.soundEnabled).toBe(false);
    expect(prefs.enabled).toBe(true); // defaults preserved
  });
});
