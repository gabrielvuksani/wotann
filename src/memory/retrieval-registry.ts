/**
 * RetrievalRegistry — P1-M6 port of Cognee's 14-retriever menu.
 *
 * Existing WOTANN retrieval surface:
 *   - store.search()                   FTS5 BM25
 *   - store.hybridRetrieve()           vector + BM25 + reranker (P1-M4)
 *   - 10 modes in extended-search-types.ts (insight-synthesis,
 *     entity-relationship, temporal-filtered, document-scope,
 *     cross-document, code-aware, summary-only, metadata-only,
 *     graph-hop, hybrid-fusion)
 *
 * P1-M6 adds 12 narrower single-mode retrievers (this module) so the
 * registry exposes a diverse menu that downstream orchestrators
 * (TEMPR, hybrid-retrieval) can pick from. Total retrieval modes on
 * the registry = 12 (names below).
 *
 * The registry is just a Map<name, RetrievalMode>; no DI container,
 * no framework. `createDefaultRetrievalRegistry()` is what the
 * composition-root calls to get the canonical mode set.
 */

import type { RetrievalMode, RetrievalModeResult } from "./retrieval-modes/types.js";

import { graphTraversal } from "./retrieval-modes/graph-traversal.js";
import { temporalWindow } from "./retrieval-modes/temporal-window.js";
import { typedEntity } from "./retrieval-modes/typed-entity.js";
import { fuzzyMatch } from "./retrieval-modes/fuzzy-match.js";
import { semanticCluster } from "./retrieval-modes/semantic-cluster.js";
import { pathBased } from "./retrieval-modes/path-based.js";
import { timeDecay } from "./retrieval-modes/time-decay.js";
import { authorityWeight } from "./retrieval-modes/authority-weight.js";
import { summaryFirst } from "./retrieval-modes/summary-first.js";
import { ingestTimeTravel } from "./retrieval-modes/ingest-time-travel.js";
import { factTimeTravel } from "./retrieval-modes/fact-time-travel.js";
import { crossSessionBridge } from "./retrieval-modes/cross-session-bridge.js";

export type {
  RetrievalMode,
  RetrievalModeOptions,
  RetrievalModeResult,
  RetrievalContext,
  RetrievalHit,
  RetrievalEdge,
  ScoringInfo,
} from "./retrieval-modes/types.js";

export interface RetrievalRegistry {
  readonly list: () => readonly RetrievalMode[];
  readonly get: (name: string) => RetrievalMode | null;
  readonly register: (mode: RetrievalMode) => void;
  readonly unregister: (name: string) => boolean;
  readonly has: (name: string) => boolean;
}

const DEFAULT_MODES: readonly RetrievalMode[] = [
  graphTraversal,
  temporalWindow,
  typedEntity,
  fuzzyMatch,
  semanticCluster,
  pathBased,
  timeDecay,
  authorityWeight,
  summaryFirst,
  ingestTimeTravel,
  factTimeTravel,
  crossSessionBridge,
];

/** Exported so callers can introspect the canonical name list without
 *  instantiating a registry. Changes here are visible to the test
 *  that asserts "12 P1-M6 modes". */
export const DEFAULT_RETRIEVAL_MODE_NAMES: readonly string[] = DEFAULT_MODES.map((m) => m.name);

export function createRetrievalRegistry(extra?: readonly RetrievalMode[]): RetrievalRegistry {
  const modes = new Map<string, RetrievalMode>();
  for (const m of DEFAULT_MODES) modes.set(m.name, m);
  if (extra) {
    for (const m of extra) modes.set(m.name, m);
  }
  return {
    list: () => [...modes.values()],
    get: (name) => modes.get(name) ?? null,
    register: (mode) => {
      modes.set(mode.name, mode);
    },
    unregister: (name) => modes.delete(name),
    has: (name) => modes.has(name),
  };
}

export function createDefaultRetrievalRegistry(): RetrievalRegistry {
  return createRetrievalRegistry();
}

export {
  graphTraversal,
  temporalWindow,
  typedEntity,
  fuzzyMatch,
  semanticCluster,
  pathBased,
  timeDecay,
  authorityWeight,
  summaryFirst,
  ingestTimeTravel,
  factTimeTravel,
  crossSessionBridge,
};

/** Re-export the result shape for consumers who only import the registry. */
export type { RetrievalModeResult as ResultForReExport } from "./retrieval-modes/types.js";
// eslint-disable-next-line @typescript-eslint/no-unused-vars
type _ResultShape = RetrievalModeResult;
