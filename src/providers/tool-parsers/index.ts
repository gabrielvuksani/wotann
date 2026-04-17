/**
 * Tool-parser registry — re-exports the 11 model-family-aware tool-call
 * parsers so the rest of the codebase can import them from one place.
 * See parsers.ts for per-format implementation details.
 */

export {
  parseHermes,
  parseMistral,
  parseMistralAll,
  parseLlama,
  parseQwen,
  parseDeepSeek,
  parseDeepSeekAll,
  parseFunctionary,
  parseJamba,
  parseJambaAll,
  parseCommandR,
  parseCommandRAll,
  parseToolBench,
  parseGlaive,
  parseReact,
  parseWotannXML,
  parseAny,
  parseToolCall,
  parseToolCalls,
  resolveParser,
  type ParsedToolCall,
  type ParserFn,
} from "./parsers.js";
