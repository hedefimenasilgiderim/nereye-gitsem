/**
 * AI sağlayıcı fabrikası.
 *
 * Tek sağlayıcı: Gemini LLM. Mesajlar kural katmanından geçmeden
 * doğrudan modele gider; yanıtı her durumda model kurar.
 */

import type { AIProvider } from "./types";
import { geminiEngine } from "./geminiEngine";

export type { AIProvider, AIRequest, AIResponse, AIContext } from "./types";
export { AIUnavailableError } from "./types";

export function createAIProvider(): AIProvider {
  return geminiEngine;
}
