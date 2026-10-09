/**
 * AI destekli keşif mimarisi.
 *
 * Kural: AI kendi kafasından mekân, fiyat, saat veya adres UYDURAMAZ.
 * V1'de cevaplar yalnızca uygulamanın gerçek OSM verisi üzerinden üretilir.
 *
 * Sağlayıcı arayüzü modülerdir: ileride bir LLM (örn. proxy backend üzerinden)
 * eklenecekse yalnızca yeni bir `AIProvider` implementasyonu yazılır ve
 * `createAIProvider` fabrikasına kaydedilir. LLM'e verilecek sistem mesajı
 * da yalnızca gerçek mekân verisini (fetchRealPlaces sonucu) içerecek
 * şekilde tasarlanmıştır.
 */

import type { Place } from "../../models/types";

export interface AIContext {
  /** Kullanıcı konumu (izin verildiyse). */
  userCoords?: { lat: number; lon: number };
  userCity?: string;
  /** Kullanıcının manuel seçtiği şehir (konum izni yoksa). */
  selectedCity?: string;
}

export interface AIRequest {
  query: string;
  context: AIContext;
  /**
   * Önceki konuşma turları (en yeniden en eskiye).
   * Motor, "daha uygun olsun", "yakın olsun" gibi takip isteklerini
   * bağlamdan çözmek için kullanır.
   */
  history?: Array<{ role: "user" | "assistant"; text: string }>;
}

export interface AIResponse {
  /** Kullanıcıya gösterilecek metin. */
  text: string;
  /** Gerçek place ID ile ilişkilendirilmiş öneriler. */
  places: Place[];
  /** Motor kendini tanıtır (UI rozeti için). */
  engine: string;
}

export interface AIProvider {
  id: string;
  recommend(req: AIRequest): Promise<AIResponse>;
  /**
   * Streaming öneri: her metin parçası geldikçe `onChunk` birikmiş
   * metinle çağrılır (UI canlı döker). Desteklenmiyorsa tanımsız
   * kalır; çağıran `recommend`'e düşer.
   */
  recommendStream?(
    req: AIRequest,
    onChunk: (partialText: string) => void,
  ): Promise<AIResponse>;
}

export class AIUnavailableError extends Error {
  constructor(message = "AI şu anda cevap veremedi.") {
    super(message);
    this.name = "AIUnavailableError";
  }
}
