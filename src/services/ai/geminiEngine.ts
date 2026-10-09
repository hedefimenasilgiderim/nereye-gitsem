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
import { getNearbyPlaces, NoSourceError } from "../osm";
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

const SYSTEM_PROMPT = `Sen "NEREYE GİTSEM?" uygulamasının samimi, zeki ve arkadaş canlısı AI Keşif Asistanısın. Kullanıcıyla doğal bir insan gibi sohbet edersin.

SOHBET: Kullanıcı sana selam verdiğinde, kendini tanıttığında, "sen kimsin / ne işe yararsın / nasıl çalışırsın" diye sorduğunda ya da hava durumu, çanta hazırlığı gibi genel konular açtığında kendi cümlelerinle doğal, akıcı ve samimi cevap ver. Kısa tut; gerekirse tek bir sohbet sorusuyla devam et.

MEKÂN ÖNERİSİ: Yalnızca kullanıcı spesifik bir yer/mekân/gezi önerisi istediğinde aşağıdaki GERÇEK MEKÂN LİSTESİ'nden öner. Kurallar:
1. Listede olmayan bir mekânın adını asla söyleme, uydurma.
2. Fiyat, çalışma saati, adres veya puan uydurma; listede yoksa bilmediğini dürüstçe söyle.
3. Mekân adını listedeki tam haliyle yaz ki uygulama onu gerçek mekân kartına bağlayabilsin.
4. Türkçe, kısa ve madde madde yaz; her maddede mekân adı + (şehir/ilçe) + en fazla bir cümle gerekçe.
5. Kullanıcının konumu veya seçtiği şehir yoksa, hangi şehirde gezmek istediğini sor.`;

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
      ? `Gerçek mekân listesi (mekân önerisi istendiyse SADECE bunlardan öner):
${buildCandidateBlock(candidates.map((c) => c.place))}`
      : "Bu turda mekân önerisi istenmedi; sadece doğal şekilde sohbet et, mekân adı geçirme.",
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
    // Anahtar yoksa sessizce yerel motora düş.
    if (!API_KEY) return localEngine.recommend(req);

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

    // Aday mekânlar YALNIZCA net bir mekân isteğinde çekilir; sohbette
    // boş liste gider ve model kendi cümleleriyle doğal cevap verir.
    // (Kartlar yalnızca modelin andığı gerçek isimlerden oluşur.)
    let candidates: GeminiCandidate[] = [];
    if (isVenueRequest(combinedTexts, intent) && center) {
      try {
        const { places } = await getNearbyPlaces({
          center,
          radius: intent.nearMe ? 5000 : 15000,
          categoryIds: intent.categoryIds,
          limit: 30,
        });

        if (places.length === 0) {
          return {
            engine: this.id,
            text: `${intent.city ? intent.city + " için" : "Çevrende"} bu kriterlere uyan gerçek bir mekân bulamadım. Şehri veya kriterleri değiştirip tekrar dener misin?`,
            places: [],
          };
        }

        candidates = places.slice(0, 20).map((p) => ({
          name: p.name,
          label: [p.name, p.city, p.district].filter(Boolean).join(" / "),
          place: p,
        }));
      } catch (err) {
        // OSM veri katmanı başarısız → yerel motorun hata mesajları devreye girer.
        if (err instanceof NoSourceError) return localEngine.recommend(req);
        const status = (err as { status?: number }).status ?? 0;
        if (status === 502 || status === 504 || status === 429) {
          throw Object.assign(new AIUnavailableError(), { status });
        }
        throw new AIUnavailableError();
      }
    }

    try {
      return await callGemini(req, candidates, originLabel);
    } catch (err) {
      // LLM katmanı başarısız → gerçek OSM önerisiyle yerel motora düş.
      const status = (err as { status?: number }).status ?? 0;
      if (status === 429 || status >= 500) {
        return {
          engine: this.id,
          text: "Gemini sunucuları şu anda yoğun. Birkaç dakika sonra tekrar dener misin? Bu arada yerel keşif motorumu kullanabilirim.",
          places: [],
        };
      }
      return localEngine.recommend(req);
    }
  },
};
