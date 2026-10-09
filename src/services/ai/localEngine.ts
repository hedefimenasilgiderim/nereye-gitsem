/**
 * Yerel keşif motoru (V1 AI provider).
 *
 * Türkçe doğal dil girdisini basit NLU ile ayrıştırır:
 *   - şehir adı (İstanbul, İzmir, ...)
 *   - niyet kelimeleri (sakin, tarihi, ucuz, kahve, deniz, yakınımda, ...)
 * Ardından gerçek OSM verisi üzerinden öneri üretir.
 *
 * Uydurma yasağı: fiyat/saat/adres gibi bilgiler asla üretilmez;
 * öneri metni yalnızca gerçek veri alanlarından kurallu olarak yazılır.
 */

import type { Place } from "../../models/types";
import { CITIES, findCityByName, normalizeTr } from "../../data/cities";
import { DISCOVERY_MODES } from "../../data/modes";
import { getNearbyPlaces, NoSourceError } from "../osm";
import {
  AIUnavailableError,
  type AIProvider,
  type AIRequest,
  type AIResponse,
} from "./types";

export interface Intent {
  city?: string;
  cityCoords?: { lat: number; lon: number };
  categoryIds?: string[];
  modeLabel?: string;
  nearMe: boolean;
  freeOnly: boolean;
  wantsFood: boolean;
}

const KEYWORD_MAP: Array<{
  words: string[];
  categoryIds: string[];
  modeLabel: string;
}> = [
  { words: ["sakin", "sessiz", "huzur", "sükunet", "sukunet"], categoryIds: ["nature", "photo"], modeLabel: "sakin" },
  { words: ["manzara", "manzaralı", "manzarali", "fotoğraf", "fotograf", "foto"], categoryIds: ["photo"], modeLabel: "manzaralı" },
  { words: ["kahve", "cafe", "kafe", "mola"], categoryIds: ["cafe"], modeLabel: "kahve molalı" },
  { words: ["tarih", "tarihi", "antik", "müze", "muze", "kalıntı", "kalinti", "eser"], categoryIds: ["historic", "attraction"], modeLabel: "tarihi" },
  { words: ["deniz", "plaj", "sahil", "yüzme", "yuzme", "kumsal"], categoryIds: ["beach"], modeLabel: "deniz kenarı" },
  { words: ["doğa", "doga", "yeşil", "yesil", "orman", "park", "yürüyüş", "yuruyus"], categoryIds: ["nature"], modeLabel: "doğa" },
  { words: ["eğlence", "eglence", "eğlen", "eglence", "sinema", "tiyatro", "oyun"], categoryIds: ["entertainment"], modeLabel: "eğlence" },
  { words: ["aile", "çocuk", "cocuk", "çocukla", "cocukla"], categoryIds: ["entertainment", "nature"], modeLabel: "aile dostu" },
  { words: ["yemek", "lokanta", "restoran", "akşam yemeği", "aksam yemegi"], categoryIds: ["restaurant"], modeLabel: "yemek" },
  { words: ["alışveriş", "alisveris", "avm", "market"], categoryIds: ["shopping"], modeLabel: "alışveriş" },
  { words: ["gezecek", "gezilecek", "gezmek", "keşfet", "kesfet", "yer arıyorum", "ne yapabilirim"], categoryIds: ["attraction", "historic", "nature"], modeLabel: "gezilecek" },
];

const NEAR_WORDS = ["yakın", "yakınımda", "yakin", "etraf", "burada", "çevre", "cevre", "bana yakın"];
const FREE_WORDS = ["ucuz", "ekonomik", "bedava", "ücretsiz", "ucretsiz", "parasız", "parasiz", "az para"];

/**
 * SOHBET KAPISI — mekân isteği ayrımı.
 *
 * Kullanıcı net bir mekân/yer aramadığı sürece (selam, nasılsın, hava
 * nasıl, çantamda ne olmalı, genel tavsiye vb.) mekân araması
 * TETİKLENMEZ ve UI'a kart DÖKÜLMEZ; yalnızca metin cevap verilir.
 * Kartlar YALNIZCA açık isteklerde gösterilir:
 *   - kategori niyeti (kafe, restoran, plaj, ...) veya
 *   - yakınlık niyeti (yakınımda, çevremde, ...) veya
 *   - fiyat niyeti (ucuz, ekonomik, ...) veya
 *   - yer-yönelimli kelime (nereye, nerede, mekân, listele, gezilecek ...)
 */
const VENUE_PLACE_WORDS = [
  "nereye", "nerede", "mekan", "listele", "liste",
  "gezilecek", "gorulecek", "gezi", "yer ariyorum",
  "ne yapabilirim", "gideyim", "gidelim", "onerirsin",
];

export function isVenueRequest(combined: string, intent: Intent): boolean {
  if (intent.categoryIds?.length) return true;
  if (intent.nearMe) return true;
  if (intent.freeOnly) return true;
  const q = normalizeTr(combined);
  return VENUE_PLACE_WORDS.some((w) => q.includes(w));
}

function tokensOf(s: string): string[] {
  return normalizeTr(s).split(/[^a-z0-9]+/).filter(Boolean);
}

function hasToken(q: string, words: string[]): boolean {
  const tokens = tokensOf(q);
  return words.some((w) => tokens.includes(w));
}

/**
 * Mekân isteği İÇERMEYEN mesajlara verilen salt-metin sohbet cevabı.
 * Asla mekân adı geçirmez (mekân adları kartlara dönüştüğü için) ve
 * öneri baskısı yapmaz; soruya odaklanır.
 */
export function chitChatReply(query: string): string {
  const q = normalizeTr(query);

  if (
    hasToken(q, ["gorusuruz", "baybay", "hosca"]) ||
    q.includes("hosca kal") || q.includes("bay bay")
  ) {
    return "Görüşürüz! İyi gezmeler! 👋";
  }
  if (
    hasToken(q, ["tesekkur", "tesekkurler", "sagol", "eyvallah"]) ||
    q.includes("sag ol")
  ) {
    return "Rica ederim! 😊 Başka bir şey merak edersen buradayım.";
  }
  if (
    hasToken(q, ["nasilsin", "naber"]) ||
    q.includes("ne haber") || q.includes("nasil gidiyor")
  ) {
    return "İyiyim, teşekkürler! 😊 Sen nasılsın? Gezi planın varsa yardımcı olabilirim.";
  }
  if (
    hasToken(q, ["selam", "merhaba", "mrb", "gunaydin", "hey", "gunler", "aksamlar"]) ||
    q.includes("iyi aksam") || q.includes("iyi gun")
  ) {
    return "Merhaba! 😊 Ben gezi asistanınım. Hangi şehirde, nasıl bir yer arıyorsun? Örneğin: \"Kadıköy'de sakin bir kafe\".";
  }
  if (q.includes("hava")) {
    return "Canlı hava durumunu takip edemiyorum. Ama gezi planın için yardımcı olabilirim — hangi şehirde, nasıl bir yer arıyorsun?";
  }
  if (
    q.includes("canta") || q.includes("bavul") || q.includes("hazirlik") ||
    q.includes("yanima ne") || q.includes("ne almali") || q.includes("ne olmali")
  ) {
    return "Genel bir gezi çantası için rahat ayakkabı, su/matara, powerbank, havaya göre ince bir katman ve kimlik yeterli olur. Nereye gidiyorsun? Söylersen daha net yardımcı olurum. 🙂";
  }
  // Net bir mekân isteği yoksa genel bir netleştirme sorusu sor.
  // Tek bir ezber cümleye kilitlenmemek için kısa varyantlar dönülür.
  const CLARIFY_VARIANTS = [
    "Ne aradığını biraz açar mısın? 🙂 Örneğin: \"Yakınımda restoran\" ya da \"İzmir'de gezilecek yerler\".",
    "Sana uygun bir öneri için biraz detay lazım — hangi şehirde, nasıl bir yer olsun? Örn: \"Kadıköy'de sakin bir kafe\".",
    "Hangi şehirde ne tür bir yer arıyorsun? \"Ankara'da tarihi yerler\" gibi yazarsan hemen bakayım. 🙂",
  ];
  return CLARIFY_VARIANTS[query.length % CLARIFY_VARIANTS.length];
}

/** Gemini motorunun da gerçek OSM verisi çekmesi için dışa açılmıştır. */
export function parseIntent(query: string, ctx: AIRequest["context"]): Intent {
  const q = normalizeTr(query);

  const intent: Intent = { nearMe: false, freeOnly: false, wantsFood: false };

  // Şehir tespiti
  for (const city of CITIES) {
    if (q.includes(normalizeTr(city.name))) {
      intent.city = city.name;
      intent.cityCoords = { lat: city.lat, lon: city.lon };
      break;
    }
  }

  // Niyet kelimeleri
  for (const entry of KEYWORD_MAP) {
    if (entry.words.some((w) => q.includes(normalizeTr(w)))) {
      intent.categoryIds = entry.categoryIds;
      intent.modeLabel = entry.modeLabel;
      break;
    }
  }

  // Keşif modu kelimeleri (modlar kategoriye bağladır)
  if (!intent.categoryIds) {
    for (const mode of DISCOVERY_MODES) {
      if (q.includes(normalizeTr(mode.label))) {
        intent.categoryIds = mode.categoryIds;
        intent.modeLabel = mode.label.toLocaleLowerCase("tr-TR");
        if (mode.preferFree) intent.freeOnly = true;
        break;
      }
    }
  }

  if (NEAR_WORDS.some((w) => q.includes(normalizeTr(w)))) intent.nearMe = true;
  if (FREE_WORDS.some((w) => q.includes(normalizeTr(w)))) intent.freeOnly = true;

  // Bağlamdan varsayılanlar
  if (!intent.city && ctx.selectedCity) {
    const c = findCityByName(ctx.selectedCity);
    if (c) {
      intent.city = c.name;
      intent.cityCoords = { lat: c.lat, lon: c.lon };
    }
  }

  return intent;
}

function filterFree(places: Place[]): Place[] {
  return places.filter(
    (p) => p.tags.fee !== "yes" && !p.tags.charge,
  );
}

function buildText(
  intent: Intent,
  places: Place[],
  originLabel: string,
): string {
  if (places.length === 0) {
    return `${originLabel} için bu kriterlere uyan bir mekân bulamadım. Şehri veya kriterleri değiştirip tekrar dener misin? Örneğin: "İstanbul'da sakin bir yer" ya da "Yakınımda kahve içebileceğim bir yer".`;
  }

  const scope = intent.modeLabel
    ? `${originLabel} sana ${intent.modeLabel} yerler öneriyorum`
    : `${originLabel} şu yerleri öneriyorum`;

  const lines = places.slice(0, 5).map((p, i) => {
    const bits = [p.city, p.district].filter(Boolean).join(" / ");
    return `${i + 1}. ${p.name}${bits ? ` (${bits})` : ""}`;
  });

  const note =
    "Fiyat, çalışma saati ve adres gibi bilgiler yalnızca doğrulanmış veri olduğunda mekân sayfasında gösterilir — uydurma bilgi vermem.";
  return `${scope}:\n\n${lines.join("\n")}\n\n${note}`;
}

export const localEngine: AIProvider = {
  id: "local-osm-engine",

  async recommend({ query, context, history = [] }: AIRequest): Promise<AIResponse> {
    // Çok turlu bağlam: son 2 kullanıcı mesajını birleştirerek niyet çıkar.
    // "daha uygun olsun" gibi takip cümleleri önceki konuyu taşır.
    const previousUserTexts = history
      .filter((m) => m.role === "user")
      .map((m) => m.text)
      .slice(0, 2);
    const combined = [...previousUserTexts, query].join(" ");
    const intent = parseIntent(combined, context);

    // Takip ince ayarları (yalnızca güncel cümleye bakılır)
    const q = normalizeTr(query);
    if (["daha uygun", "ucuz", "bedava", "ekonomik", "daha az"].some((w) => q.includes(w)))
      intent.freeOnly = true;
    if (["daha yakın", "yakın", "yakınımda"].some((w) => q.includes(w)))
      intent.nearMe = true;

    // SOHBET KAPISI: net bir mekân isteği yoksa mekân araması YAPILMAZ,
    // kart DÖKÜLMEZ — yalnızca metin cevap verilir.
    if (!isVenueRequest(combined, intent)) {
      return { engine: this.id, text: chitChatReply(query), places: [] };
    }

    const center = intent.nearMe && context.userCoords
      ? context.userCoords
      : intent.cityCoords
        ? intent.cityCoords
        : context.userCoords;

    if (!center) {
      return {
        engine: this.id,
        text: "Hangi şehirde gezmek istediğini yazabilir misin? Örneğin: \"İstanbul'da tarihi yerler\". Konum iznini açarsan çevrendeki yerleri de önerebilirim.",
        places: [],
      };
    }

    const originLabel =
      intent.nearMe && context.userCoords
        ? "Çevrendeki"
        : intent.city
          ? `${intent.city} için`
          : "Bulunduğun bölge için";

    try {
      const { places: raw } = await getNearbyPlaces({
        center,
        radius: intent.nearMe ? 5000 : 15000,
        categoryIds: intent.categoryIds,
        limit: 100,
      });
      let places = raw;

      if (intent.freeOnly) places = filterFree(places);

      const text = buildText(intent, places, originLabel);
      return { engine: this.id, text, places: places.slice(0, 5) };
    } catch (err) {
      if (err instanceof NoSourceError) {
        return {
          engine: this.id,
          text: `${originLabel} bu konuda henüz güvenilir bir veri kaynağım yok. Başka bir kriterle dener misin?`,
          places: [],
        };
      }
      // Sunucu yoğunluğu (502/504/429) için net, uydurmasız mesaj:
      const status = (err as { status?: number }).status;
      if (status === 502 || status === 504 || status === 429) {
        return {
          engine: this.id,
          text: "Keşif sunucuları şu anda çok yoğun. Birkaç dakika sonra aynı soruyu tekrar gönderir misin? Önbellekteki bölgeler bu sürede de çalışır.",
          places: [],
        };
      }
      throw new AIUnavailableError();
    }
  },
};
