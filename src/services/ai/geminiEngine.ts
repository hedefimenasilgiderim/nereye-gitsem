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

  // Anahtar URL parametresiyle, kodlanmış ve tırnaksız gider.
  const res = await fetch(`${ENDPOINT}?key=${encodeURIComponent(cleanApiKey)}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
      contents,
      generationConfig: { temperature: 0.7, maxOutputTokens: 600 },
    }),
  });

  if (!res.ok) {
    const status = res.status;
    if (status === 400 || status === 401 || status === 403) {
      throw Object.assign(new Error("gemini-auth"), { status });
    }
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
    // Anahtar boş olsa bile istek denenir; kimlik hatası olursa
    // kullanıcıya açıklayıcı mesaj gösterilir (istemcide engelleme yok).

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
    } catch (err) {
      if ((err as Error).message === "gemini-auth") {
        throw new AIUnavailableError(
          "Gemini API anahtarı eksik veya geçersiz (401/403). Lütfen VITE_GEMINI_API_KEY değerini kontrol edin.",
        );
      }
      throw new AIUnavailableError();
    }
  },
};
