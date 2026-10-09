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

const API_KEY = readApiKey();

/**
 * .env / ortam değişkeninden anahtarı temiz okur: tırnak/boşluk
 * kalıntılarını atar. Boş gelirse yalnızca uyarı yazar; bozuk anahtar
 * asla ağa gönderilmez (401 üretmesin diye istek atılmaz).
 */
// Tarayıcıda `process` yoktur; Vite `define` ile derleme anında gömülür.
declare const process:
  | { env: Record<string, string | undefined> }
  | undefined;

function readApiKey(): string | undefined {
  const apiKey = (import.meta.env.VITE_GEMINI_API_KEY || "").trim();
  const nodeKey =
    typeof process !== "undefined"
      ? (process.env.VITE_GEMINI_API_KEY || "").trim()
      : "";
  const key = (apiKey || nodeKey)
    .replace(/^["']|["']$/g, "")
    .trim();
  if (!key) {
    console.warn("VITE_GEMINI_API_KEY eksik");
    return undefined;
  }
  if (!/^AIza[0-9A-Za-z_-]{30,}$/.test(key)) {
    console.error(
      "[gemini] API anahtarı beklenen 'AIza...' formatında değil; .env değerindeki tırnak/boşlukları kontrol edin.",
    );
    return undefined;
  }
  return key;
}
const MODEL = "gemini-flash-latest";
const ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

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

async function callGemini(
  req: AIRequest,
  candidates: GeminiCandidate[],
  originLabel: string,
): Promise<AIResponse> {
  if (!API_KEY) throw new Error("gemini-no-key");
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
      : "Elinde gerçek mekân listesi yok; mekân adı uydurma, hayali yer önerme.",
  ]
    .filter(Boolean)
    .join("\n\n");

  contents.push({
    role: "user",
    parts: [{ text: `${contextLines}\n\nKullanıcının sorusu: ${req.query}` }],
  });

  // Anahtar URL yerine başlıkla gider (Google'ın önerdiği yöntem):
  // URL kodlama/bozulma sınıfı hataları ve log'lara anahtar sızması engellenir.
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": API_KEY,
    },
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
    if (!API_KEY) {
      throw new AIUnavailableError(
        "AI anahtarı tanımlı değil. Devam etmek için VITE_GEMINI_API_KEY ekleyin.",
      );
    }

    // Konum SADECE yapısal bağlamdan alınır (mesaj taranmaz): GPS izni
    // veya kullanıcının seçtiği şehir. Aday liste tüm kategorilerden
    // hazırlanır; seçimi model yapar.
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

    let candidates: GeminiCandidate[] = [];
    if (center) {
      try {
        const { places } = await getNearbyPlaces({
          center,
          radius: 15000,
          limit: 100,
        });
        candidates = places.slice(0, 30).map((p) => ({
          name: p.name,
          label: [p.name, p.city, p.district].filter(Boolean).join(" / "),
          place: p,
        }));
      } catch {
        // Veri katmanı sustu: adaylar boş gider, yanıtı model kurar.
      }
    }

    try {
      return await callGemini(req, candidates, originLabel);
    } catch {
      throw new AIUnavailableError();
    }
  },
};
