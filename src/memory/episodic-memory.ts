/**
 * Episodic Memory — full task narratives for cross-session learning.
 *
 * Unlike working memory (key-value) or archival (search-indexed),
 * episodic memory captures the COMPLETE story of a task:
 * what was attempted, what failed, what worked, and why.
 *
 * This enables:
 * - "Last time I worked on auth, I found that..." recall
 * - Pattern extraction: which strategies work for which task types
 * - Error avoidance: "This approach failed last time because..."
 * - Task estimation: "Similar tasks took ~30 minutes and $0.50"
 */

import { existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { writeFileAtomic } from "../utils/atomic-io.js";
import { join } from "node:path";

// ── Types ───────────────────────────────────────────────

export interface EpisodeEvent {
  readonly timestamp: number;
  readonly type:
    | "start"
    | "plan"
    | "edit"
    | "test"
    | "error"
    | "fix"
    | "verify"
    | "complete"
    | "abandon"
    | "decision"
    | "discovery";
  readonly description: string;
  readonly file?: string;
  readonly tokensUsed?: number;
  readonly cost?: number;
  readonly metadata?: Record<string, unknown>;
}

export interface Episode {
  readonly id: string;
  readonly title: string;
  readonly taskDescription: string;
  readonly startedAt: number;
  readonly completedAt?: number;
  readonly outcome: "success" | "failure" | "partial" | "abandoned" | "in-progress";
  readonly events: readonly EpisodeEvent[];
  readonly filesModified: readonly string[];
  readonly totalTokensUsed: number;
  readonly totalCost: number;
  readonly provider: string;
  readonly model: string;
  readonly strategies: readonly string[];
  readonly errorsEncountered: readonly string[];
  readonly lessonsLearned: readonly string[];
  readonly tags: readonly string[];
}

export interface EpisodeSummary {
  readonly id: string;
  readonly title: string;
  readonly outcome: "success" | "failure" | "partial" | "abandoned" | "in-progress";
  readonly startedAt: number;
  readonly duration: number;
  readonly eventCount: number;
  readonly cost: number;
  readonly tags: readonly string[];
}

export interface EpisodeQuery {
  readonly searchText?: string;
  readonly outcome?: Episode["outcome"];
  readonly tags?: readonly string[];
  readonly since?: number;
  readonly maxResults?: number;
}

/** Cross-episode reasoning result (LoCoMo R8). */
export interface CrossEpisodePattern {
  readonly pattern: string;
  readonly episodeIds: readonly string[];
  readonly occurrences: number;
  readonly confidence: number;
}

/** Episode link connecting two episodes by shared topic. */
export interface EpisodeLink {
  readonly sourceId: string;
  readonly targetId: string;
  readonly sharedTags: readonly string[];
  readonly strength: number; // 0-1 based on tag overlap
}

// ── Episode Store ───────────────────────────────────────

export class EpisodicMemory {
  private readonly storageDir: string;
  private currentEpisode: Episode | null = null;
  private readonly eventBuffer: EpisodeEvent[] = [];

  constructor(wotannDir: string) {
    this.storageDir = join(wotannDir, "memory", "episodes");
    if (!existsSync(this.storageDir)) {
      mkdirSync(this.storageDir, { recursive: true });
    }
  }

  /**
   * Start recording a new episode.
   */
  startEpisode(taskDescription: string, provider: string, model: string): string {
    const id = `ep_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const title =
      taskDescription.length > 80 ? taskDescription.slice(0, 77) + "..." : taskDescription;

    this.currentEpisode = {
      id,
      title,
      taskDescription,
      startedAt: Date.now(),
      outcome: "in-progress",
      events: [],
      filesModified: [],
      totalTokensUsed: 0,
      totalCost: 0,
      provider,
      model,
      strategies: [],
      errorsEncountered: [],
      lessonsLearned: [],
      tags: extractTags(taskDescription),
    };

    this.eventBuffer.length = 0;
    this.recordEvent("start", `Task started: ${title}`);

    return id;
  }

  /**
   * Record an event in the current episode.
   */
  recordEvent(
    type: EpisodeEvent["type"],
    description: string,
    metadata?: {
      file?: string;
      tokensUsed?: number;
      cost?: number;
      extra?: Record<string, unknown>;
    },
  ): void {
    if (!this.currentEpisode) return;

    const event: EpisodeEvent = {
      timestamp: Date.now(),
      type,
      description: description.slice(0, 500),
      file: metadata?.file,
      tokensUsed: metadata?.tokensUsed,
      cost: metadata?.cost,
      metadata: metadata?.extra,
    };

    this.eventBuffer.push(event);

    // Track files modified
    if (metadata?.file && (type === "edit" || type === "fix")) {
      const files = [...this.currentEpisode.filesModified];
      if (!files.includes(metadata.file)) files.push(metadata.file);
      this.currentEpisode = { ...this.currentEpisode, filesModified: files };
    }

    // Track errors
    if (type === "error") {
      const errors = [...this.currentEpisode.errorsEncountered];
      errors.push(description.slice(0, 200));
      this.currentEpisode = { ...this.currentEpisode, errorsEncountered: errors };
    }

    // Track accumulated cost/tokens
    if (metadata?.tokensUsed || metadata?.cost) {
      this.currentEpisode = {
        ...this.currentEpisode,
        totalTokensUsed: this.currentEpisode.totalTokensUsed + (metadata.tokensUsed ?? 0),
        totalCost: this.currentEpisode.totalCost + (metadata.cost ?? 0),
      };
    }
  }

  /**
   * Record a strategy used during the episode.
   */
  recordStrategy(strategy: string): void {
    if (!this.currentEpisode) return;
    const strategies = [...this.currentEpisode.strategies];
    if (!strategies.includes(strategy)) {
      strategies.push(strategy);
      this.currentEpisode = { ...this.currentEpisode, strategies };
    }
  }

  /**
   * Record a lesson learned during the episode.
   */
  recordLesson(lesson: string): void {
    if (!this.currentEpisode) return;
    const lessons = [...this.currentEpisode.lessonsLearned];
    lessons.push(lesson);
    this.currentEpisode = { ...this.currentEpisode, lessonsLearned: lessons };
  }

  /**
   * Complete the current episode and persist to disk.
   */
  completeEpisode(outcome: Episode["outcome"]): Episode | null {
    if (!this.currentEpisode) return null;

    this.recordEvent("complete", `Task ${outcome}`);

    const completed: Episode = {
      ...this.currentEpisode,
      completedAt: Date.now(),
      outcome,
      events: [...this.eventBuffer],
    };

    this.persist(completed);
    const result = completed;
    this.currentEpisode = null;
    this.eventBuffer.length = 0;
    return result;
  }

  /**
   * Get the current in-progress episode.
   */
  getCurrentEpisode(): Episode | null {
    if (!this.currentEpisode) return null;
    return { ...this.currentEpisode, events: [...this.eventBuffer] };
  }

  /**
   * Search past episodes.
   */
  search(query: EpisodeQuery): readonly EpisodeSummary[] {
    const allEpisodes = this.loadAll();
    let results = allEpisodes;

    if (query.outcome) {
      results = results.filter((e) => e.outcome === query.outcome);
    }

    if (query.since) {
      results = results.filter((e) => e.startedAt >= query.since!);
    }

    if (query.tags && query.tags.length > 0) {
      results = results.filter((e) => query.tags!.some((tag) => e.tags.includes(tag)));
    }

    if (query.searchText) {
      const lower = query.searchText.toLowerCase();
      results = results.filter(
        (e) =>
          e.title.toLowerCase().includes(lower) ||
          e.taskDescription.toLowerCase().includes(lower) ||
          e.lessonsLearned.some((l) => l.toLowerCase().includes(lower)),
      );
    }

    // Sort by most recent first
    results.sort((a, b) => b.startedAt - a.startedAt);

    const maxResults = query.maxResults ?? 20;
    return results.slice(0, maxResults).map(toSummary);
  }

  /**
   * Recall a specific episode by ID.
   */
  recall(episodeId: string): Episode | null {
    const filePath = join(this.storageDir, `${episodeId}.json`);
    if (!existsSync(filePath)) return null;

    try {
      return JSON.parse(readFileSync(filePath, "utf-8")) as Episode;
    } catch {
      return null;
    }
  }

  /**
   * Get lessons learned from similar past episodes.
   */
  getLessonsForTask(taskDescription: string): readonly string[] {
    const tags = extractTags(taskDescription);
    const related = this.search({ tags, maxResults: 10 });

    const lessons: string[] = [];
    for (const summary of related) {
      const full = this.recall(summary.id);
      if (full) {
        lessons.push(...full.lessonsLearned);
      }
    }

    return [...new Set(lessons)]; // Deduplicate
  }

  /**
   * Get average cost/time for similar tasks.
   */
  getEstimateForTask(
    taskDescription: string,
  ): { avgCost: number; avgDuration: number; sampleSize: number } | null {
    const tags = extractTags(taskDescription);
    const related = this.search({ tags, outcome: "success", maxResults: 10 });

    if (related.length === 0) return null;

    let totalCost = 0;
    let totalDuration = 0;

    for (const summary of related) {
      totalCost += summary.cost;
      totalDuration += summary.duration;
    }

    return {
      avgCost: totalCost / related.length,
      avgDuration: totalDuration / related.length,
      sampleSize: related.length,
    };
  }

  // ── Cross-Episode Reasoning (LoCoMo R8) ───────────────

  /**
   * Find recurring patterns across episodes by analyzing shared tags,
   * strategies, errors, and lessons. Enables multi-hop queries like
   * "What patterns repeat in auth-related tasks?"
   */
  findPatterns(
    tags?: readonly string[],
    minOccurrences: number = 2,
  ): readonly CrossEpisodePattern[] {
    const allEpisodes = this.loadAll();
    const targetEpisodes =
      tags && tags.length > 0
        ? allEpisodes.filter((e) => tags.some((t) => e.tags.includes(t)))
        : allEpisodes;

    if (targetEpisodes.length < minOccurrences) return [];

    const patternCounts = new Map<string, { ids: Set<string>; count: number }>();

    // Analyze recurring strategies
    for (const episode of targetEpisodes) {
      for (const strategy of episode.strategies) {
        const normalized = strategy.toLowerCase().trim();
        const existing = patternCounts.get(`strategy:${normalized}`) ?? {
          ids: new Set(),
          count: 0,
        };
        existing.ids.add(episode.id);
        existing.count++;
        patternCounts.set(`strategy:${normalized}`, existing);
      }

      // Analyze recurring error types
      for (const error of episode.errorsEncountered) {
        // Normalize errors by extracting the key message (first line, no paths)
        const normalized =
          error
            .split("\n")[0]
            ?.replace(/\/[^\s]+/g, "<path>")
            .trim() ?? "";
        if (normalized.length < 5) continue;
        const existing = patternCounts.get(`error:${normalized}`) ?? { ids: new Set(), count: 0 };
        existing.ids.add(episode.id);
        existing.count++;
        patternCounts.set(`error:${normalized}`, existing);
      }

      // Analyze recurring lessons
      for (const lesson of episode.lessonsLearned) {
        const normalized = lesson.toLowerCase().trim();
        const existing = patternCounts.get(`lesson:${normalized}`) ?? { ids: new Set(), count: 0 };
        existing.ids.add(episode.id);
        existing.count++;
        patternCounts.set(`lesson:${normalized}`, existing);
      }
    }

    // Filter to patterns that recur across multiple episodes
    return [...patternCounts.entries()]
      .filter(([, data]) => data.ids.size >= minOccurrences)
      .map(([pattern, data]) => ({
        pattern,
        episodeIds: [...data.ids],
        occurrences: data.count,
        confidence: Math.min(1.0, data.ids.size / targetEpisodes.length),
      }))
      .sort((a, b) => b.occurrences - a.occurrences);
  }

  /**
   * Build an episode link graph based on shared tags.
   * Each link connects two episodes that share at least one tag.
   */
  buildEpisodeLinks(minSharedTags: number = 1): readonly EpisodeLink[] {
    const allEpisodes = this.loadAll();
    const links: EpisodeLink[] = [];

    for (let i = 0; i < allEpisodes.length; i++) {
      for (let j = i + 1; j < allEpisodes.length; j++) {
        const a = allEpisodes[i]!;
        const b = allEpisodes[j]!;
        const sharedTags = a.tags.filter((t) => b.tags.includes(t));

        if (sharedTags.length >= minSharedTags) {
          const maxTags = Math.max(a.tags.length, b.tags.length, 1);
          links.push({
            sourceId: a.id,
            targetId: b.id,
            sharedTags,
            strength: sharedTags.length / maxTags,
          });
        }
      }
    }

    return links.sort((a, b) => b.strength - a.strength);
  }

  /**
   * Multi-hop recall: "What happened across all episodes about topic X?"
   * Traverses episode links to find connected context.
   */
  multiHopRecall(
    startTag: string,
    maxHops: number = 2,
  ): readonly { episode: EpisodeSummary; hop: number; sharedTags: readonly string[] }[] {
    const allEpisodes = this.loadAll();
    const links = this.buildEpisodeLinks();

    // Find seed episodes (directly tagged)
    const seeds = allEpisodes.filter((e) => e.tags.includes(startTag));
    if (seeds.length === 0) return [];

    const visited = new Set<string>();
    const results: { episode: EpisodeSummary; hop: number; sharedTags: readonly string[] }[] = [];

    let frontier = seeds.map((e) => ({ id: e.id, hop: 0, tags: [startTag] }));

    for (let hop = 0; hop <= maxHops && frontier.length > 0; hop++) {
      const nextFrontier: { id: string; hop: number; tags: string[] }[] = [];

      for (const { id, tags } of frontier) {
        if (visited.has(id)) continue;
        visited.add(id);

        const episode = allEpisodes.find((e) => e.id === id);
        if (episode) {
          results.push({ episode: toSummary(episode), hop, sharedTags: tags });
        }

        // Follow links to connected episodes
        for (const link of links) {
          const otherId =
            link.sourceId === id ? link.targetId : link.targetId === id ? link.sourceId : null;
          if (otherId && !visited.has(otherId)) {
            nextFrontier.push({ id: otherId, hop: hop + 1, tags: [...link.sharedTags] });
          }
        }
      }

      frontier = nextFrontier;
    }

    return results;
  }

  // ── Private ───────────────────────────────────────────

  private persist(episode: Episode): void {
    const filePath = join(this.storageDir, `${episode.id}.json`);
    // Wave 6.5-UU (H-22) — episodic memory record. Atomic write.
    writeFileAtomic(filePath, JSON.stringify(episode, null, 2), { encoding: "utf-8" });
  }

  private loadAll(): Episode[] {
    if (!existsSync(this.storageDir)) return [];

    const files = readdirSync(this.storageDir).filter((f) => f.endsWith(".json"));
    const episodes: Episode[] = [];

    for (const file of files) {
      try {
        const raw = readFileSync(join(this.storageDir, file), "utf-8");
        episodes.push(JSON.parse(raw) as Episode);
      } catch {
        // Corrupt file — skip
      }
    }

    return episodes;
  }
}

// ── Helpers ─────────────────────────────────────────────

function extractTags(description: string): readonly string[] {
  const tags = new Set<string>();
  const lower = description.toLowerCase();

  // Task type tags
  const typePatterns: Array<[RegExp, string]> = [
    [/\b(fix|bug|debug|error)\b/, "bug-fix"],
    [/\b(test|tdd|spec|coverage)\b/, "testing"],
    [/\b(refactor|clean|simplif)\b/, "refactor"],
    [/\b(feat|feature|implement|add|create|build)\b/, "feature"],
    [/\b(review|audit|check)\b/, "review"],
    [/\b(deploy|release|ci|cd)\b/, "devops"],
    [/\b(auth|login|oauth|session)\b/, "auth"],
    [/\b(api|endpoint|route|rest|graphql)\b/, "api"],
    [/\b(ui|component|page|layout|style)\b/, "frontend"],
    [/\b(db|database|migration|query|sql)\b/, "database"],
    [/\b(security|xss|inject|csrf|vuln)\b/, "security"],
    [/\b(perf|optim|speed|latency|cache)\b/, "performance"],
    [/\b(doc|readme|comment)\b/, "documentation"],
  ];

  for (const [pattern, tag] of typePatterns) {
    if (pattern.test(lower)) tags.add(tag);
  }

  return [...tags];
}

function toSummary(episode: Episode): EpisodeSummary {
  return {
    id: episode.id,
    title: episode.title,
    outcome: episode.outcome,
    startedAt: episode.startedAt,
    duration: (episode.completedAt ?? Date.now()) - episode.startedAt,
    eventCount: episode.events.length,
    cost: episode.totalCost,
    tags: episode.tags,
  };
}
