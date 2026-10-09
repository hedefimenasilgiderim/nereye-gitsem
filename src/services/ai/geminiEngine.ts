/**
 * Gemini LLM keşif motoru.
 *
 * Uydurma yasağı burada da geçerlidir: modele yalnızca gerçek OSM verisinden
 * gelen mekân listesi verilir ve SADECE bu listedeki mekânları önermesi
 * istenir. Fiyat/saat/adres bilgisi veri kümesinde yoksa söylememesi
 * istenir. Cevaptaki mekân adları gerçek Place nesneleriyle eşleştirilir;
 * eşleşmeyen adlar öneri kartlarına dönüştürülmez.
 *
 * API anahtarı .env üzerinden okunur (VITE_GEMINI_API_KEY). Anahtar yoksa
 * veya istek başarısız olursa yerel motora (localEngine) geri düşülür —
 * uygulama hiçbir durumda boş cevap vermez.
 */

import type { Place } from "../../models/types";
import { normalizeTr } from "../../data/cities";
import { getNearbyPlaces } from "../osm";
import { localEngine, parseIntent, isVenueRequest } from "./localEngine";
import {
  AIUnavailableError,
  type AIProvider,
  type AIRequest,
  type AIResponse,
} from "./types";

const API_KEY = (import.meta.env.VITE_GEMINI_API_KEY as string | undefined)?.trim();
const MODEL = "gemini-flash-latest";
const ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

const SYSTEM_PROMPT = `Sen Nereye Gitsem uygulamasının yapay zeka seyahat asistanısın. Kullanıcı seninle sohbet ettiğinde, soru sorduğunda veya dertleştiğinde tamamen doğal, samimi ve zeki bir insan gibi cevap ver. Sadece kullanıcı açıkça bir mekan/yer önerisi istediğinde lokasyon önerilerinde bulun.`;

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

async function callGemini(
  req: AIRequest,
  candidates: GeminiCandidate[],
  originLabel: string,
  venueWanted: boolean,
): Promise<AIResponse> {
  const contents: Array<{ role: "user" | "model"; parts: Array<{ text: string }> }> = [];

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
      : venueWanted
        ? "Kullanıcı mekân önerisi istedi ancak bu kriterde gerçek mekân bulunamadı (veya konum bilinmiyor). Bunu doğal bir dille söyle; gerekirse şehir veya kriter sor. Hayali mekân ismi verme."
        : "Bu turda mekân önerisi istenmedi; doğal şekilde sohbet et, mekân adı geçirme.",
  ]
    .filter(Boolean)
    .join("\n\n");

  contents.push({
    role: "user",
    parts: [{ text: `${contextLines}\n\nKullanıcının sorusu: ${req.query}` }],
  });

  const res = await fetch(`${ENDPOINT}?key=${encodeURIComponent(API_KEY!)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
      contents,
      generationConfig: { temperature: 0.7, maxOutputTokens: 600 },
    }),
  });

  if (!res.ok) {
    const status = res.status;
    if (status === 429 || status === 503 || status >= 500) {
      throw Object.assign(new Error("gemini-busy"), { status });
    }
    throw new Error(`gemini-error-${status}`);
  }

  const data = (await res.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  const text =
    data.candidates?.[0]?.content?.parts
      ?.map((p) => p.text ?? "")
      .join("")
      .trim() ?? "";

  if (!text) throw new Error("gemini-empty");

  const places = matchMentionedPlaces(text, candidates);
  return { engine: "gemini", text, places };
}

export const geminiEngine: AIProvider = {
  id: "gemini-osm-engine",

  async recommend(req: AIRequest): Promise<AIResponse> {
    // Anahtar yoksa çevrimdışı yedek motora düş (Gemini'ye ulaşılamayan
    // tek durum). Anahtar varken HER mesaj doğrudan Gemini'ye gider;
    // arada engelleyen kural/şablon yoktur.
    if (!API_KEY) return localEngine.recommend(req);

    // Niyet ayrıştırması SADECE veri amaçlıdır (konum + aday mekânlar);
    // yanıta asla müdahale etmez.
    const userTexts = (req.history ?? [])
      .filter((m) => m.role === "user")
      .map((m) => m.text);
    const combinedTexts = [...userTexts.slice(0, 2), req.query].join(" ");
    const intent = parseIntent(combinedTexts, req.context);
    const gq = normalizeTr(req.query);
    if (["daha uygun", "ucuz", "bedava", "ekonomik", "daha az"].some((w) => gq.includes(w)))
      intent.freeOnly = true;
    if (["daha yakın", "yakın", "yakınımda"].some((w) => gq.includes(w)))
      intent.nearMe = true;

    const center =
      intent.nearMe && req.context.userCoords
        ? req.context.userCoords
        : intent.cityCoords ?? req.context.userCoords;

    const originLabel =
      intent.nearMe && req.context.userCoords
        ? "kullanıcı konumunu paylaşıyor, çevresindeki yerler öncelikli"
        : intent.city
          ? `ilgilendiği şehir: ${intent.city}`
          : "kullanıcı konumu biliniyor";

    // Aday mekânlar YALNIZCA veri olarak hazırlanır; boşsa bile yanıtı
    // Gemini kurar (şablon yok).
    const venueWanted = isVenueRequest(combinedTexts, intent);
    let candidates: GeminiCandidate[] = [];
    if (venueWanted && center) {
      try {
        const { places } = await getNearbyPlaces({
          center,
          radius: intent.nearMe ? 5000 : 15000,
          categoryIds: intent.categoryIds,
          limit: 30,
        });
        candidates = places.slice(0, 20).map((p) => ({
          name: p.name,
          label: [p.name, p.city, p.district].filter(Boolean).join(" / "),
          place: p,
        }));
      } catch {
        // Veri katmanı sustu: adaylar boş gider, durumu Gemini doğal
        // dille açıklar.
      }
    }

    try {
      return await callGemini(req, candidates, originLabel, venueWanted);
    } catch {
      throw new AIUnavailableError();
    }
  },
};
