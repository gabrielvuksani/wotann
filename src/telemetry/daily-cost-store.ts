/**
 * DailyCostStore — per-day cost aggregation with durable JSON persistence.
 *
 * Fixes the incorrect weeklyCost = totalCost * 7 bug by storing actual
 * per-day totals. Every cost event is added to today's bucket; getWeekly()
 * and getMonthly() sum the last 7 and last 30 days respectively.
 *
 * Entries older than 90 days are auto-pruned on every write.
 */

import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { writeFileAtomicSyncBestEffort } from "../utils/atomic-io.js";

export interface DailyCostEntry {
  readonly date: string; // YYYY-MM-DD in local time
  readonly costUsd: number;
}

const RETENTION_DAYS = 90;

function formatDate(d: Date): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function daysBetween(a: Date, b: Date): number {
  const ms = Math.abs(a.getTime() - b.getTime());
  return Math.floor(ms / (1000 * 60 * 60 * 24));
}

export class DailyCostStore {
  private entries: DailyCostEntry[] = [];
  private readonly storagePath?: string;

  constructor(storagePath?: string) {
    this.storagePath = storagePath;
    this.load();
  }

  /**
   * Add a cost event to today's bucket. Persists immediately.
   */
  addCost(amount: number): void {
    if (!Number.isFinite(amount) || amount <= 0) return;

    const today = formatDate(new Date());
    const idx = this.entries.findIndex((e) => e.date === today);

    if (idx >= 0) {
      const existing = this.entries[idx];
      if (existing) {
        this.entries = [
          ...this.entries.slice(0, idx),
          { date: today, costUsd: existing.costUsd + amount },
          ...this.entries.slice(idx + 1),
        ];
      }
    } else {
      this.entries = [...this.entries, { date: today, costUsd: amount }];
    }

    this.pruneOld();
    this.save();
  }

  /**
   * Sum of cost for the last 7 days (including today).
   */
  getWeekly(): number {
    return this.sumLastDays(7);
  }

  /**
   * Sum of cost for the last 30 days (including today).
   */
  getMonthly(): number {
    return this.sumLastDays(30);
  }

  /**
   * Cost for today only.
   */
  getToday(): number {
    const today = formatDate(new Date());
    const entry = this.entries.find((e) => e.date === today);
    return entry?.costUsd ?? 0;
  }

  /**
   * All stored daily entries (read-only snapshot).
   */
  getAll(): readonly DailyCostEntry[] {
    return [...this.entries];
  }

  private sumLastDays(n: number): number {
    const now = new Date();
    return this.entries.reduce((sum, entry) => {
      const entryDate = new Date(entry.date);
      const diff = daysBetween(now, entryDate);
      return diff < n ? sum + entry.costUsd : sum;
    }, 0);
  }

  private pruneOld(): void {
    const now = new Date();
    this.entries = this.entries.filter((e) => {
      const entryDate = new Date(e.date);
      return daysBetween(now, entryDate) <= RETENTION_DAYS;
    });
  }

  private load(): void {
    if (!this.storagePath || !existsSync(this.storagePath)) return;
    try {
      const raw = readFileSync(this.storagePath, "utf-8");
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) {
        this.entries = parsed
          .filter((e): e is DailyCostEntry => {
            if (!e || typeof e !== "object") return false;
            const o = e as Record<string, unknown>;
            return typeof o["date"] === "string" && typeof o["costUsd"] === "number";
          })
          .map((e) => ({ date: e.date, costUsd: e.costUsd }));
      }
    } catch {
      // Corrupt file — reset to empty
      this.entries = [];
    }
  }

  private save(): void {
    if (!this.storagePath) return;
    try {
      mkdirSync(dirname(this.storagePath), { recursive: true });
      // SECURITY (B6): atomic write + advisory lock prevents corruption when
      // multiple daemon processes or cost-tracker instances hit the store at
      // once. The file is tiny and written often, so the race window is real.
      writeFileAtomicSyncBestEffort(
        this.storagePath,
        JSON.stringify(this.entries, null, 2),
        { encoding: "utf-8", mode: 0o600 },
      );
    } catch {
      // Best-effort persistence only
    }
  }
}
