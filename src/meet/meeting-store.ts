/**
 * Meeting Store -- SQLite persistence for meetings and transcripts.
 * Uses the same better-sqlite3 pattern as the memory store.
 */

import Database from "better-sqlite3";
import type { TranscriptSegment, MeetingState } from "./meeting-pipeline.js";

export class MeetingStore {
  private readonly db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.migrate();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS meetings (
        id TEXT PRIMARY KEY,
        status TEXT NOT NULL DEFAULT 'ended',
        platform TEXT NOT NULL DEFAULT 'unknown',
        started_at TEXT,
        ended_at TEXT,
        duration_ms INTEGER DEFAULT 0,
        participants TEXT DEFAULT '[]',
        summary TEXT,
        created_at TEXT DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS transcript_segments (
        id TEXT PRIMARY KEY,
        meeting_id TEXT NOT NULL REFERENCES meetings(id),
        speaker TEXT NOT NULL,
        text TEXT NOT NULL,
        start_ms INTEGER NOT NULL,
        end_ms INTEGER NOT NULL,
        confidence REAL DEFAULT 1.0,
        timestamp TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS action_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        meeting_id TEXT NOT NULL REFERENCES meetings(id),
        content TEXT NOT NULL,
        assignee TEXT,
        due_date TEXT,
        completed INTEGER DEFAULT 0,
        created_at TEXT DEFAULT (datetime('now'))
      );

      CREATE VIRTUAL TABLE IF NOT EXISTS transcript_fts USING fts5(
        text,
        speaker,
        content='transcript_segments',
        content_rowid='rowid'
      );

      CREATE TRIGGER IF NOT EXISTS transcript_fts_insert AFTER INSERT ON transcript_segments BEGIN
        INSERT INTO transcript_fts(rowid, text, speaker) VALUES (new.rowid, new.text, new.speaker);
      END;
    `);
  }

  saveMeeting(meeting: MeetingState): void {
    this.db.prepare(`
      INSERT OR REPLACE INTO meetings (id, status, platform, started_at, ended_at, duration_ms, participants)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      meeting.id,
      meeting.status,
      meeting.platform,
      meeting.startedAt,
      meeting.endedAt,
      meeting.durationMs,
      JSON.stringify(meeting.participants),
    );
  }

  saveSegment(meetingId: string, segment: TranscriptSegment): void {
    this.db.prepare(`
      INSERT OR REPLACE INTO transcript_segments (id, meeting_id, speaker, text, start_ms, end_ms, confidence, timestamp)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(segment.id, meetingId, segment.speaker, segment.text, segment.startMs, segment.endMs, segment.confidence, segment.timestamp);
  }

  saveSummary(meetingId: string, summary: string): void {
    this.db.prepare("UPDATE meetings SET summary = ? WHERE id = ?").run(summary, meetingId);
  }

  saveActionItem(meetingId: string, content: string, assignee?: string, dueDate?: string): void {
    this.db.prepare(`
      INSERT INTO action_items (meeting_id, content, assignee, due_date) VALUES (?, ?, ?, ?)
    `).run(meetingId, content, assignee ?? null, dueDate ?? null);
  }

  searchTranscripts(query: string, limit: number = 20): readonly { meetingId: string; text: string; speaker: string; timestamp: string }[] {
    return this.db.prepare(`
      SELECT ts.meeting_id as meetingId, ts.text, ts.speaker, ts.timestamp
      FROM transcript_fts fts
      JOIN transcript_segments ts ON fts.rowid = ts.rowid
      WHERE transcript_fts MATCH ?
      ORDER BY ts.timestamp DESC
      LIMIT ?
    `).all(query, limit) as { meetingId: string; text: string; speaker: string; timestamp: string }[];
  }

  listMeetings(limit: number = 50): readonly MeetingState[] {
    const rows = this.db.prepare(`
      SELECT id, status, platform, started_at as startedAt, ended_at as endedAt,
             duration_ms as durationMs, participants
      FROM meetings ORDER BY created_at DESC LIMIT ?
    `).all(limit) as { id: string; status: string; platform: string; startedAt: string; endedAt: string; durationMs: number; participants: string }[];

    return rows.map(r => ({
      ...r,
      status: r.status as MeetingState["status"],
      platform: r.platform as MeetingState["platform"],
      participants: JSON.parse(r.participants) as readonly string[],
      segmentCount: 0,
    }));
  }

  getTranscript(meetingId: string): readonly TranscriptSegment[] {
    return this.db.prepare(`
      SELECT id, speaker, text, start_ms as startMs, end_ms as endMs, confidence, timestamp
      FROM transcript_segments WHERE meeting_id = ? ORDER BY start_ms
    `).all(meetingId) as TranscriptSegment[];
  }

  getActionItems(meetingId: string): readonly { id: number; content: string; assignee: string | null; completed: boolean }[] {
    return this.db.prepare(`
      SELECT id, content, assignee, completed FROM action_items WHERE meeting_id = ? ORDER BY id
    `).all(meetingId) as { id: number; content: string; assignee: string | null; completed: boolean }[];
  }

  close(): void {
    this.db.close();
  }
}
