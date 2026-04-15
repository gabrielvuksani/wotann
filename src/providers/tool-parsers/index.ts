/**
 * Tool-parser registry — re-exports the 11 model-family-aware tool-call
 * parsers so the rest of the codebase can import them from one place.
 * See parsers.ts for per-format implementation details.
 */

export {
  parseHermes,
  parseMistral,
  parseLlama,
  parseQwen,
  parseDeepSeek,
  parseFunctionary,
  parseJamba,
  parseCommandR,
  parseToolBench,
  parseGlaive,
  parseReact,
  parseWotannXML,
  parseAny,
  parseToolCall,
  resolveParser,
  type ParsedToolCall,
  type ParserFn,
} from "./parsers.js";
