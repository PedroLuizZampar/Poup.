export type { CategorizationRule } from "./rules";
export { CATEGORIZATION_RULES } from "./rules";

export { merchantKey, normalizeDescription } from "./normalize";
export { SIMILARITY_THRESHOLD, similarityScore } from "./similarity";

export {
  TRANSFER_WINDOW_DAYS,
  detectTransferPairs,
  type TransferCandidate,
  type TransferPair,
} from "./transfers";

export {
  PLUGGY_CONFIDENCE,
  RULE_CONFIDENCE,
  buildHistoryIndex,
  suggestCategory,
  type CategoryRef,
  type HistoryIndex,
  type Suggestion,
  type SuggestionContext,
  type SuggestionInput,
} from "./engine";
