/**
 * Gemini LLM keşif motoru (tek AI sağlayıcısı).
 *
 * İlke: kullanıcı mesajı %100 DOĞRUDAN Gemini API'ye gider. Mesajı
 * engelleyen, kelime arayan veya hazır şablon döndüren kural katmanı
 * yoktur. Aday mekân listesi yalnızca veri olarak hazırlanır; yanıtı
 * her durumda model kurar.
 *
 * API anahtarı .env üzerinden okunur (VITE_GEMINI_API_KEY). Anahtar
 * yoksa veya istek başarısız olursa hata fırlatılır; kural bazlı
 * yedek yanıt üretilmez.
 */

import type { Place } from "../../models/types";
import { findCityByName, normalizeTr } from "../../data/cities";
import { getNearbyPlaces } from "../osm";
import {
  AIUnavailableError,
  type AIProvider,
  type AIRequest,
  type AIResponse,
} from "./types";

const cleanApiKey = readApiKey();

// Tarayıcıda `process` yoktur; Vite `define` ile derleme anında gömülür.
// Bildirim yalnızca tsc içindir.
declare const process:
  | { env: Record<string, string | undefined> }
  | undefined;

/**
 * Anahtarı katı şekilde temizler: çift kaynaktan okur, çevreleyen
 * tırnakları söker, kırpar. Değerin kendisi asla loglanmaz, yalnızca
 * uzunluğu yazılır. Boş gelse bile çağrı engellenmez; kimlik hatası
 * kullanıcıya açıklayıcı mesaj olarak gösterilir.
 */
function readApiKey(): string {
  // Not: `process.env...` ifadesi Vite `define` ile derleme anında
  // gerçek değerle değiştirilir; `typeof` koruması yalnızca tanımsız
  // ortamlarda (tsc dahil) güvenli okuma içindir.
  const rawKey =
    import.meta.env.VITE_GEMINI_API_KEY ||
    (typeof process !== "undefined" ? process.env.VITE_GEMINI_API_KEY : undefined) ||
    "";
  const cleanApiKey = rawKey.replace(/^["']|["']$/g, "").trim();
  console.log("Gemini Key Length:", cleanApiKey.length);
  if (!cleanApiKey) {
    console.error("Gemini Key Missing");
  }
  return cleanApiKey;
}
import { GoogleGenerativeAI } from "@google/generative-ai";

const MODEL = "gemini-2.5-flash";

/** Model istemcisi (tek noktadan; URL birleştirme yok). */
function getModel() {
  const genAI = new GoogleGenerativeAI(cleanApiKey);
  return genAI.getGenerativeModel({
    model: MODEL,
    systemInstruction: SYSTEM_PROMPT,
    generationConfig: { temperature: 0.7, maxOutputTokens: 500 },
  });
}

const SYSTEM_PROMPT = `Sen Nereye Gitsem uygulamasının akıllı, samimi ve arkadaş canlısı AI Keşif Asistanısın. Kullanıcı seninle sohbet etmek istediğinde, hal hatır sorduğunda tamamen doğal bir insan gibi konuş. Yalnızca kullanıcı spesifik bir yer/mekân/gezilecek yer istediğinde lokasyon önerilerini kart yapısında sun.`;

interface GeminiCandidate {
  name: string;
  label: string;
  place: Place;
}

function buildCandidateBlock(places: Place[]): string {
  return places
    .map((p) => {
      const bits = [p.city, p.district].filter(Boolean).join("/");
      const fee =
        p.tags.fee === "yes" || p.tags.charge
          ? "; ücretli olabilir (kesin bilgi mekân sayfasında)"
          : "";
      return `- ${p.name}${bits ? ` (${bits})` : ""}${fee}`;
    })
    .join("\n");
}

function matchMentionedPlaces(text: string, candidates: GeminiCandidate[]): Place[] {
  const t = normalizeTr(text);
  const matched: Place[] = [];
  for (const c of candidates) {
    const n = normalizeTr(c.place.name);
    if (n.length >= 4 && t.includes(n)) {
      matched.push(c.place);
    }
  }
  return matched.slice(0, 5);
}

type GeminiContents = Array<{
  role: "user" | "model";
  parts: Array<{ text: string }>;
}>;

function buildContents(
  req: AIRequest,
  candidates: GeminiCandidate[],
  originLabel: string,
): GeminiContents {
  const contents: GeminiContents = [];

  for (const m of req.history ?? []) {
    contents.push({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.text }],
    });
  }

  const contextLines = [
    originLabel ? `Kullanıcının bağlamı: ${originLabel}.` : "",
    candidates.length > 0
      ? `Gerçek mekân listesi (mekân önerisi istendiyse SADECE bunlardan öner, adları tam haliyle yaz):
${buildCandidateBlock(candidates.map((c) => c.place))}`
      : "Elinde gerçek mekân listesi yok; mekân adı uydurma, hayali yer önerme.",
  ]
    .filter(Boolean)
    .join("\n\n");

  contents.push({
    role: "user",
    parts: [{ text: `${contextLines}\n\nKullanıcının sorusu: ${req.query}` }],
  });
  return contents;
}

/** SDK hatasını sınıflandırır ve tam sebebini loglar. */
function toAuthOrRethrow(err: unknown): Error {
  const msg = err instanceof Error ? err.message : String(err);
  console.error("[gemini] çağrı hatası:", msg);
  if (/40[013]/.test(msg)) return new Error("gemini-auth");
  return err instanceof Error ? err : new Error("gemini-error");
}

async function callGemini(
  req: AIRequest,
  candidates: GeminiCandidate[],
  originLabel: string,
): Promise<AIResponse> {
  const contents = buildContents(req, candidates, originLabel);

  try {
    const result = await getModel().generateContent({ contents });
    const text = result.response.text().trim();
    if (!text) throw new Error("gemini-empty");
    const places = matchMentionedPlaces(text, candidates);
    return { engine: "gemini", text, places };
  } catch (err) {
    throw toAuthOrRethrow(err);
  }
}

/**
 * Streaming çağrı: her metin parçası geldikçe `onChunk` ile birikmiş
 * metni iletir; UI cümleyi canlı döker.
 */
async function callGeminiStream(
  req: AIRequest,
  candidates: GeminiCandidate[],
  originLabel: string,
  onChunk: (partialText: string) => void,
): Promise<AIResponse> {
  const contents = buildContents(req, candidates, originLabel);

  try {
    const result = await getModel().generateContentStream({ contents });
    let full = "";
    for await (const chunk of result.stream) {
      const piece = chunk.text();
      if (piece) {
        full += piece;
        onChunk(full);
      }
    }
    const text = full.trim();
    if (!text) throw new Error("gemini-empty");
    const places = matchMentionedPlaces(text, candidates);
    return { engine: "gemini", text, places };
  } catch (err) {
    throw toAuthOrRethrow(err);
  }
}

/** Aday mekânları yapısal bağlamdan hazırlar (mesaj taranmaz). */
async function fetchCandidates(
  center: { lat: number; lon: number } | undefined,
): Promise<GeminiCandidate[]> {
  if (!center) return [];
  try {
    const { places } = await getNearbyPlaces({
      center,
      radius: 15000,
      limit: 100,
    });
    return places.slice(0, 30).map((p) => ({
      name: p.name,
      label: [p.name, p.city, p.district].filter(Boolean).join(" / "),
      place: p,
    }));
  } catch {
    // Veri katmanı sustu: adaylar boş gider, yanıtı model kurar.
    return [];
  }
}

function resolveCenter(req: AIRequest) {
  // Konum SADECE yapısal bağlamdan alınır (mesaj taranmaz): GPS izni
  // veya kullanıcının seçtiği şehir.
  const selected = req.context.selectedCity
    ? findCityByName(req.context.selectedCity)
    : undefined;
  const center = req.context.userCoords ??
    (selected ? { lat: selected.lat, lon: selected.lon } : undefined);

  const cityName = req.context.selectedCity ?? req.context.userCity;
  const originLabel =
    [
      req.context.userCoords
        ? `kullanıcı konumu: ${req.context.userCoords.lat},${req.context.userCoords.lon}`
        : "",
      cityName ? `ilgili şehir: ${cityName}` : "",
    ]
      .filter(Boolean)
      .join("; ") || "kullanıcı konumu bilinmiyor";

  return { center, originLabel };
}

function mapRecommendError(err: unknown): never {
  if ((err as Error).message === "gemini-auth") {
    throw new AIUnavailableError(
      "Gemini API anahtarı eksik veya geçersiz (401/403). Lütfen VITE_GEMINI_API_KEY değerini kontrol edin.",
    );
  }
  throw new AIUnavailableError();
}

export const geminiEngine: AIProvider = {
  id: "gemini-osm-engine",

  async recommend(req: AIRequest): Promise<AIResponse> {
    // Anahtar boşsa istemciyi yormadan önceden hata döndür.
    if (!cleanApiKey) {
      console.error("Gemini Key Missing");
      throw new AIUnavailableError(
        "Gemini API anahtarı eksik. Lütfen VITE_GEMINI_API_KEY değerini kontrol edin.",
      );
    }
    const { center, originLabel } = resolveCenter(req);
    const candidates = await fetchCandidates(center);

    try {
      return await callGemini(req, candidates, originLabel);
    } catch (err) {
      mapRecommendError(err);
    }
  },

  async recommendStream(
    req: AIRequest,
    onChunk: (partialText: string) => void,
  ): Promise<AIResponse> {
    if (!cleanApiKey) {
      console.error("Gemini Key Missing");
      throw new AIUnavailableError(
        "Gemini API anahtarı eksik. Lütfen VITE_GEMINI_API_KEY değerini kontrol edin.",
      );
    }
    const { center, originLabel } = resolveCenter(req);
    const candidates = await fetchCandidates(center);

    // Önce streaming dene; patlarsa (404/500/ağ) tek-seferlik
    // generateContent'e düş. Her iki yol da aynı modeli kullanır.
    try {
      return await callGeminiStream(req, candidates, originLabel, onChunk);
    } catch (streamErr) {
      if ((streamErr as Error).message === "gemini-auth") {
        mapRecommendError(streamErr);
      }
      try {
        return await callGemini(req, candidates, originLabel);
      } catch (err) {
        mapRecommendError(err);
      }
    }
  },
};
