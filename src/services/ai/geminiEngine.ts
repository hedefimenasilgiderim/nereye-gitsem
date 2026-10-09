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
import { localEngine, parseIntent, isVenueRequest, chitChatReply } from "./localEngine";
import {
  AIUnavailableError,
  type AIProvider,
  type AIRequest,
  type AIResponse,
} from "./types";

const API_KEY = (import.meta.env.VITE_GEMINI_API_KEY as string | undefined)?.trim();
const MODEL = "gemini-flash-latest";
const ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

const SYSTEM_PROMPT = `Sen "NEREYE GİTSEM?" adlı Türkiye gezi uygulamasının yapay zekâ asistanısın. Kullanıcıya nereye gidebileceğini önerirsin.

KURALLAR (bunları ASLA ihlal etme):
1. Yalnızca sana verilen GERÇEK MEKÂN LİSTESİ'ndeki mekânları öner. Listede olmayan bir mekânın adını asla söyleme, uydurma.
2. Fiyat, çalışma saati, adres veya puan bilgisini asla uydurma. Bu bilgi listesinde olmayan bir mekân için "giriş ücreti bilmiyorum, mekân sayfasında gösterilir" gibi dürüst ol.
3. Mekân adını listedeki tam haliyle yaz ki uygulama onu gerçek mekân kartına bağlayabilsin.
4. Türkçe, samimi ama kısa cevap ver. Önerileri madde madde ver; her maddede mekân adı + (şehir/ilçe) + en fazla bir cümle gerekçe.
 5. Kullanıcının konumu veya seçtiği şehir yoksa, hangi şehirde gezmek istediğini sor.
 6. Gezi dışı konularda (kod, tarih, siyaset vb.) yardımcı olmadığını, senin bir gezi asistanı olduğunu belirt.
 7. Kullanıcı selam/sohbet amaçlı yazdığında veya net bir mekân isteği vermediğinde mekân adı GEÇİRME (mekân adları kartlara dönüştürülür); sadece doğal şekilde sohbet et ve tek bir açık soruyla ne aradığını öğren.`;

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
    `Gerçek mekân listesi (SADECE bunlardan öner yap):
${buildCandidateBlock(candidates.map((c) => c.place))}`,
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
    // SOHBET KAPISI: selam/sohbet mesajlarında mekân araması ve LLM
    // çağrısı YAPILMAZ — yalnızca metin cevap verilir, kart dökülmez.
    const combinedTexts = [
      ...(req.history ?? [])
        .filter((m) => m.role === "user")
        .map((m) => m.text)
        .slice(0, 2),
      req.query,
    ].join(" ");
    const gateIntent = parseIntent(combinedTexts, req.context);
    const gq = normalizeTr(req.query);
    if (["daha uygun", "ucuz", "bedava", "ekonomik", "daha az"].some((w) => gq.includes(w)))
      gateIntent.freeOnly = true;
    if (["daha yakın", "yakın", "yakınımda"].some((w) => gq.includes(w)))
      gateIntent.nearMe = true;
    if (!isVenueRequest(combinedTexts, gateIntent)) {
      return { engine: this.id, text: chitChatReply(req.query), places: [] };
    }

    // Anahtar yoksa sessizce yerel motora düş.
    if (!API_KEY) return localEngine.recommend(req);

    const intent = parseIntent(
      [
        ...(req.history ?? [])
          .filter((m) => m.role === "user")
          .map((m) => m.text)
          .slice(0, 2),
        req.query,
      ].join(" "),
      req.context,
    );

    const center =
      intent.nearMe && req.context.userCoords
        ? req.context.userCoords
        : intent.cityCoords ?? req.context.userCoords;

    // Konum/şehir yoksa ve kullanıcı mekân istemiyorsa: LLM şehir sorabilir.
    if (!center) {
      const originLabel = "";
      try {
        return await callGemini(req, [], originLabel);
      } catch {
        return localEngine.recommend(req);
      }
    }

    const originLabel =
      intent.nearMe && req.context.userCoords
        ? "kullanıcı konumunu paylaşıyor, çevresindeki yerler öncelikli"
        : intent.city
          ? `ilgilendiği şehir: ${intent.city}`
          : "kullanıcı konumu biliniyor";

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

      const candidates: GeminiCandidate[] = places.slice(0, 20).map((p) => ({
        name: p.name,
        label: [p.name, p.city, p.district].filter(Boolean).join(" / "),
        place: p,
      }));

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
    } catch (err) {
      // OSM veri katmanı başarısız → yerel motorun hata mesajları devreye girer.
      if (err instanceof NoSourceError) return localEngine.recommend(req);
      const status = (err as { status?: number }).status ?? 0;
      if (status === 502 || status === 504 || status === 429) {
        throw Object.assign(new AIUnavailableError(), { status });
      }
      throw new AIUnavailableError();
    }
  },
};
