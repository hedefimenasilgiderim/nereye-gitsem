/**
 * OpenStreetMap veri katmanı (Overpass + Nominatim).
 *
 * - Ücretsiz, API key gerektirmez.
 * - Mekân verisi yalnızca gerçek OSM tag'lerinden üretilir; olmayan bilgi
 *   asla uydurulmaz (undefined kalır, UI "Bilgi mevcut değil" gösterir).
 * - Overpass için yedek sunucular ve timeout bulunur.
 * - Tüm sorgular TTL cache üzerinden yapılır (rate limit koruması).
 */

import type { Coordinates, Place, PlaceRef } from "../models/types";
import { CATEGORIES } from "../data/categories";
import {
  filterFallbackPlaces,
  popularRegionalPlaces,
  sortFallbackByDistance,
} from "../data/fallbackPlaces";
import { cached, cachedWithStale } from "./cache";
import { fetchJSON, qs } from "./http";

// Firestore cache modülü LAZY yüklenir: Firebase SDK'sı ana paket şişmesin
// diye yalnızca ilk getNearbyPlaces çağrısında indirilir.
type FirebaseCache = typeof import("./firebase");
let fbPromise: Promise<FirebaseCache> | null = null;
function loadFirebaseCache(): Promise<FirebaseCache> {
  fbPromise ??= import("./firebase");
  return fbPromise;
}

// Overpass istekleri tarayıcıdan TEK bir güvenilir primary sunucuya gider.
// Paralel mirror yarışı kaldırıldı: 5-6 eşzamanlı istek ağı kilitleyip
// 406/500/504 yağmuruna yol açıyordu. 2,5 sn'de yanıt gelmezse istek iptal
// edilir ve sessizce yerel kategorik veri devreye girer.
const PRIMARY_OVERPASS = "https://overpass.kumi.systems/api/interpreter";
const PRIMARY_TIMEOUT_MS = 2500;

const NOMINATIM = "https://nominatim.openstreetmap.org";

const TTL_SEARCH = 10 * 60 * 1000; // 10 dk
const TTL_DETAIL = 60 * 60 * 1000; // 1 saat

// ---------------------------------------------------------------- Overpass

interface OverpassElement {
  type: "node" | "way" | "relation";
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

interface OverpassResponse {
  elements: OverpassElement[];
}

async function queryOverpass(ql: string): Promise<OverpassElement[]> {
  const normalized = ql.trimStart().startsWith("[out:json]")
    ? ql.replace(/\[timeout:\d+\]/, "[timeout:3]")
    : `[out:json][timeout:3];\n${ql}`;
  const query = normalized.includes("[timeout:3]")
    ? normalized
    : normalized.replace("[out:json]", "[out:json][timeout:3]");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PRIMARY_TIMEOUT_MS);
  try {
    const res = await fetch(PRIMARY_OVERPASS, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "data=" + encodeURIComponent(query),
      signal: controller.signal,
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (JSON.parse(text) as OverpassResponse).elements ?? [];
  } catch {
    // Tüm ağ/HTTP/parse hataları sessizce yutulur; çağıran yerel veriye düşer.
    // Console'da unhandled 500/406/504 stack trace görünmez.
    throw new Error("overpass-failed");
  } finally {
    clearTimeout(timer);
  }
}

// ------------------------------------------------------- Kategori eşleme

function tagFilterMatches(
  tags: Record<string, string>,
  filter: Record<string, string | string[]>,
): boolean {
  return Object.entries(filter).every(([key, expected]) => {
    const actual = tags[key];
    if (actual === undefined) return false;
    if (expected === "*") return true;
    const list = Array.isArray(expected) ? expected : [expected];
    return list.includes(actual);
  });
}

/** Ham OSM tag'lerinden kategori kimliği üretir (ilk eşleşen kazanır). */
export function categorize(tags: Record<string, string>): string | null {
  for (const cat of CATEGORIES) {
    for (const filter of cat.tagFilters) {
      if (tagFilterMatches(tags, filter)) return cat.id;
    }
  }
  return null;
}

/**
 * Sorgu kategorisi bilinçli bir seçim olduğundan, eşleştirmede ÖNCE
 * sorgulanan kategorilerin filtreleri denenir (örn. "Etkinlik" sekmesinde
 * bir sinema "event" olarak işaretlenir; "Eğlence" sekmesinde aynı
 * mekan "entertainment" olur). Böylece sekme bazlı sonuç listeleri
 * kendi sorgusundan gelen mekanları kaybetmez.
 */
function categorizeFor(
  tags: Record<string, string>,
  categoryIds?: string[],
): string | null {
  if (categoryIds?.length) {
    for (const id of categoryIds) {
      const cat = CATEGORIES.find((c) => c.id === id);
      if (cat && cat.tagFilters.some((f) => tagFilterMatches(tags, f))) {
        return id;
      }
    }
  }
  return categorize(tags);
}

// ------------------------------------------------------------ Geometri

export function haversineMeters(
  a: Coordinates,
  b: { lat: number; lon: number },
): number {
  const R = 6371000;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLon = ((b.lon - a.lon) * Math.PI) / 180;
  const la1 = (a.lat * Math.PI) / 180;
  const la2 = (b.lat * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function formatDistance(m?: number): string | null {
  if (m === undefined || !Number.isFinite(m)) return null;
  if (m < 1000) return `${Math.round(m)} m`;
  return `${(m / 1000).toLocaleString("tr-TR", {
    maximumFractionDigits: 1,
  })} km`;
}

// ------------------------------------------------- Overpass → Place dönüşümü

function extractImages(tags: Record<string, string>): string[] {
  const urls: string[] = [];
  const image = tags.image ?? tags["image:tr"];
  if (image && /^https?:\/\//i.test(image)) urls.push(image);
  const commons = tags.wikimedia_commons;
  if (commons && commons.startsWith("File:")) {
    urls.push(
      `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(
        commons.slice(5),
      )}?width=800`,
    );
  }
  return urls;
}

function elementToPlace(
  el: OverpassElement,
  origin?: Coordinates,
  preferredCategoryIds?: string[],
): Place | null {
  const tags = el.tags ?? {};
  const name = tags.name ?? tags["name:tr"];
  if (!name) return null;

  const lat = el.lat ?? el.center?.lat;
  const lon = el.lon ?? el.center?.lon;
  if (lat === undefined || lon === undefined) return null;

  const categoryId = categorizeFor(tags, preferredCategoryIds);
  if (!categoryId) return null;

  const priceParts: string[] = [];
  if (tags.fee) priceParts.push(tags.fee === "yes" ? "Giriş ücretli" : "Giriş ücretsiz");
  if (tags.charge) priceParts.push(`Ücret: ${tags.charge}`);

  const addrParts = [
    [tags["addr:street"], tags["addr:housenumber"]].filter(Boolean).join(" "),
    tags["addr:suburb"] ?? tags["addr:district"],
    tags["addr:city"],
  ].filter(Boolean);

  const distance =
    origin !== undefined ? haversineMeters(origin, { lat, lon }) : undefined;

  return {
    placeId: `osm:${el.type[0].toUpperCase()}/${el.id}`,
    name,
    latitude: lat,
    longitude: lon,
    osmType: el.type[0].toUpperCase() as "N" | "W" | "R",
    osmId: el.id,
    categoryId,
    description: tags["description:tr"] ?? tags.description,
    city: tags["addr:city"],
    district: tags["addr:suburb"] ?? tags["addr:district"],
    address: addrParts.length > 0 ? addrParts.join(", ") : undefined,
    images: extractImages(tags),
    openingHours: tags.opening_hours,
    priceInfo: priceParts.length > 0 ? priceParts.join(" · ") : undefined,
    phone: tags.phone ?? tags["contact:phone"],
    website: tags.website ?? tags["contact:website"],
    tags,
    distanceMeters: distance,
  };
}

// ------------------------------------------------------------ Sorgular

function buildAroundQuery(opts: {
  center: Coordinates;
  radius: number;
  categoryIds?: string[];
  limit: number;
}): string | null {
  const cats = opts.categoryIds
    ? CATEGORIES.filter((c) => opts.categoryIds!.includes(c.id))
    : CATEGORIES;
  const lines: string[] = [];
  // WAF/timeout koruması: yarıçap en fazla 50 km.
  const cappedRadius = Math.min(Math.round(opts.radius), 50000);
  const around = `(around:${cappedRadius},${opts.center.lat},${opts.center.lon})`;

  for (const cat of cats) {
    for (const filter of cat.tagFilters) {
      for (const [key, expected] of Object.entries(filter)) {
        const value =
          expected === "*"
            ? undefined
            : Array.isArray(expected)
              ? `^(${expected.join("|")})$`
              : expected;
        const tagExpr =
          value === undefined
            ? `["${key}"]`
            : value.includes("|")
              ? `["${key}"~"${value}"]`
              : `["${key}"="${value}"]`;
        // nw = node+way: ağır relation taraması yapılmaz (hız için).
        lines.push(`nw${tagExpr}${around};`);
      }
    }
  }

  if (lines.length === 0) return null;
  // Geniş etiket kümeleriyle çalışırken ham sonuç havuzunu büyüt ki
  // kategori eşleşmesi ve mesafe filtrelemesinden sonra hedeflenen
  // minimum 10 mekan yakalansın.
  const limit = opts.radius > 5000 ? 30 : opts.limit;
  // Hafif sorgu: tek birleşik blok, ana etiketler, kısa timeout —
  // overquery/timeout riskini düşürür.
  return `[out:json][timeout:3];\n(\n${lines.join("\n")}\n);\nout center ${limit};`;
}

/** Maksimum kabul edilebilir mesafe (metre). Bu değerden uzak mekanlar
 * cache, Overpass veya fallback'den gelse bile asla gösterilmez. */
const MAX_ACCEPTABLE_DISTANCE_M = 50000;

/** Kademeli yarıçap merdiveni: sonuç eşiğinin altındaysa sorgu bir üst
 * kademede tekrarlanır (Türkiye'nin 81 ilinde ölçeklenebilir — şehir
 * bazlı yama yok). */
const RADIUS_TIERS_M = [20000, 35000, 50000];
/** Bir kademede yeterli kabul edilen minimum sonuç sayısı. */
const MIN_RESULTS_THRESHOLD = 10;

export interface NearbyOptions {
  center: Coordinates;
  radius?: number;
  categoryIds?: string[];
  limit?: number;
  /**
   * Şehir/ilçe anahtarı (örn. "Başiskele"): Firestore `places_cache`
   * doc kimliği `{sehir}_{kategori}` bununla üretilir. Verilmezse
   * koordinat bazlı anahtar kullanılır.
   */
  cityKey?: string;
}

/**
 * Belirli bir nokta çevresindeki gerçek mekânları getirir.
 * Kategori filtresi belirtilen kategoride güvenilir veri kaynağı yoksa
 * (örn. "Etkinlik") NoSourceError fırlatır — uydurma sonuç dönülmez.
 */
export class NoSourceError extends Error {
  constructor() {
    super("Bu kategori için henüz bir veri kaynağımız yok.");
    this.name = "NoSourceError";
  }
}

export interface NearbyResult {
  places: Place[];
  /**
   * true ise sonuçlar seçili kategori yerine bölgenin popüler mekanları
   * genişletilerek geldi (kategori içinde 0 sonuç durumu). UI bu durumda
   * katı kategori filtresi uygulamaz — "öneri yok" ekranı asla çıkmaz.
   */
  broadened?: boolean;
}

/** Verilen merkeze 20 km'den uzak mekanları SERT şekilde siler. */
function clampByDistance(
  places: Place[],
  center: Coordinates,
  maxMeters = MAX_ACCEPTABLE_DISTANCE_M,
): Place[] {
  return places.filter((p) => {
    const d = haversineMeters(center, { lat: p.latitude, lon: p.longitude });
    return d <= maxMeters;
  });
}

/** Aynı docId için eşzamanlı tek getNearbyPlaces çalıştırmasını garantiler.
 * React strict mode / hızlı tıklamalar nedeniyle oluşan çift istekleri önler. */
const inFlight = new Map<string, Promise<NearbyResult>>();

export async function getNearbyPlaces(opts: NearbyOptions): Promise<NearbyResult> {
  const { center } = opts;
  const radius = Math.min(opts.radius ?? 4000, MAX_ACCEPTABLE_DISTANCE_M);
  const limit = opts.limit ?? 80;

  if (opts.categoryIds) {
    const cats = CATEGORIES.filter((c) => opts.categoryIds!.includes(c.id));
    if (cats.every((c) => c.tagFilters.length === 0)) throw new NoSourceError();
  }

  // Firestore doc kimliği: {sehir}_{kategori} (örn. basiskele_kafe).
  const categoryId =
    opts.categoryIds?.length && opts.categoryIds.length > 0
      ? opts.categoryIds.slice().sort().join("+")
      : "all";
  const cityKey =
    opts.cityKey ??
    `geo_${center.lat.toFixed(2)}_${center.lon.toFixed(2)}`;

  const fb = await loadFirebaseCache().catch(() => null);
  const docId = fb ? fb.placeCacheDocId(cityKey, categoryId) : null;
  const flightKey = docId ?? `${cityKey}_${categoryId}_${center.lat.toFixed(3)}_${center.lon.toFixed(3)}`;

  const existing = inFlight.get(flightKey);
  if (existing) return existing;

  const promise = (async (): Promise<NearbyResult> => {
    try {
      return await getNearbyPlacesInternal(opts, center, radius, limit, fb, docId);
    } finally {
      inFlight.delete(flightKey);
    }
  })();

  inFlight.set(flightKey, promise);
  return promise;
}

async function getNearbyPlacesInternal(
  opts: NearbyOptions,
  center: Coordinates,
  radius: number,
  limit: number,
  fb: Awaited<ReturnType<typeof loadFirebaseCache>> | null,
  docId: string | null,
): Promise<NearbyResult> {
  // Yerel kategorik veri: Overpass patlarsa/boş dönerse SESSİZCE devreye
  // girer. Kesin kategori filtresi — başka kategori asla karıştırılmaz.
  const localPlaces = () =>
    sortFallbackByDistance(
      filterFallbackPlaces({ center, categoryIds: opts.categoryIds, limit }),
      center,
      haversineMeters,
    );

  // Bölgesel popüler mekanlar: seçili kategoride 0 sonuç olduğunda
  // "öneri yok" yerine gösterilen son güvence listesi.
  const regionalPopular = () =>
    sortFallbackByDistance(
      popularRegionalPlaces({ center, limit }),
      center,
      haversineMeters,
    );

  // Cache-first: Firestore'da veri varsa Overpass'e HİÇBİR istek atılmaz.
  if (docId) {
    try {
      const cachedPlaces = await fb!.readPlaceCache(docId);
      if (cachedPlaces && cachedPlaces.length > 0) {
        const valid = clampByDistance(cachedPlaces, center);
        if (valid.length > 0) {
          return {
            places: sortFallbackByDistance(valid, center, haversineMeters),
          };
        }
      }
    } catch {
      /* Firebase erişilemez: devam et */
    }
  }

  const ql = buildAroundQuery({ center, radius, categoryIds: opts.categoryIds, limit });
  if (!ql) throw new NoSourceError();

  try {
    // Kademeli yarıçap: 15 km'den başlar, sonuç eşiğin (8) altındaysa
    // 30 km, sonra 50 km ile tekrar dener. Her kademe TEK istektir
    // (paralel istek yok); eşik yakalanınca durur.
    const seen = new Set<string>();
    const places: Place[] = [];
    for (const tier of RADIUS_TIERS_M) {
      const tierQl = buildAroundQuery({ center, radius: tier, categoryIds: opts.categoryIds, limit });
      if (!tierQl) break;
      try {
        const elements = await queryOverpass(tierQl);
        for (const el of elements) {
          const place = elementToPlace(el, center, opts.categoryIds);
          if (!place || seen.has(place.placeId)) continue;
          // Savunma: Overpass'ten dönen mekanın kategorisi seçili
          // kategoriyle uyuşmuyorsa listeye alma (örn. AVM tag'li bir
          // yer Kafe sorgusuna karışmasın).
          if (opts.categoryIds?.length && !opts.categoryIds.includes(place.categoryId)) {
            continue;
          }
          seen.add(place.placeId);
          places.push(place);
        }
      } catch {
        // Bu kademede patladı: bir üst kademe yoksa fallback'e düşülür.
        break;
      }
      const soFar = clampByDistance(places, center);
      if (soFar.length >= MIN_RESULTS_THRESHOLD) break;
    }

    const valid = clampByDistance(places, center);

    if (valid.length === 0) {
      // Kategori içinde kayıt yok: önce katı kategorik yerel veri;
      // o da boşsa bölgenin popüler mekanları. "Öneri yok" ASLA yok.
      const local = localPlaces();
      const resultPlaces =
        local.length > 0 ? local : regionalPopular();
      const broadened = local.length === 0;
      if (docId) {
        void fb?.writePlaceCache(docId, resultPlaces, "fallback", fb.FALLBACK_CACHE_TTL_MS).catch(() => {});
      }
      return broadened ? { places: resultPlaces, broadened: true } : { places: resultPlaces };
    }

    valid.sort((a, b) => (a.distanceMeters ?? 0) - (b.distanceMeters ?? 0));
    if (docId) {
      void fb?.writePlaceCache(docId, valid, "overpass").catch(() => {});
    }
    return { places: valid };
  } catch {
    // Overpass patladı / zaman aşımı: hata ekranı YOK. Önce kategorik
    // yerel veri; o da boşsa bölgesel popüler mekanlar.
    const local = localPlaces();
    if (local.length > 0) {
      if (docId) {
        void fb?.writePlaceCache(docId, local, "fallback", fb.FALLBACK_CACHE_TTL_MS).catch(() => {});
      }
      return { places: local };
    }
    const popular = regionalPopular();
    if (docId) {
      void fb?.writePlaceCache(docId, popular, "fallback", fb.FALLBACK_CACHE_TTL_MS).catch(() => {});
    }
    return { places: popular, broadened: true };
  }
}

// ------------------------------------------------------------ Nominatim

interface NominatimResult {
  place_id: number;
  osm_type: "node" | "way" | "relation";
  osm_id: number;
  lat: string;
  lon: string;
  name?: string;
  display_name: string;
  class?: string;
  type?: string;
  address?: Record<string, string>;
  extratags?: Record<string, string>;
}

function classifyNominatim(r: NominatimResult): string {
  const tags: Record<string, string> = {};
  if (r.class && r.type) tags[r.class] = r.type;
  const mapped = categorize(tags);
  if (mapped) return mapped;
  // Nominatim idari birim / şehir sonuçları için genel kategori.
  return "attraction";
}

function nominatimToPlace(r: NominatimResult, origin?: Coordinates): Place {
  const lat = parseFloat(r.lat);
  const lon = parseFloat(r.lon);
  const name = r.name || r.display_name.split(",")[0];
  const addr = r.address ?? {};
  const tags = r.extratags ?? {};

  const priceParts: string[] = [];
  if (tags.fee)
    priceParts.push(tags.fee === "yes" ? "Giriş ücretli" : "Giriş ücretsiz");
  if (tags.charge) priceParts.push(`Ücret: ${tags.charge}`);

  const street = [addr.road, addr.house_number].filter(Boolean).join(" ");

  return {
    placeId: `osm:${r.osm_type[0].toUpperCase()}/${r.osm_id}`,
    name,
    latitude: lat,
    longitude: lon,
    osmType: r.osm_type[0].toUpperCase() as "N" | "W" | "R",
    osmId: r.osm_id,
    categoryId: classifyNominatim(r),
    description: tags["description:tr"] ?? tags.description,
    city: addr.city ?? addr.town ?? addr.village ?? addr.province,
    district: addr.suburb ?? addr.district ?? addr.county,
    address: street
      ? [street, addr.city ?? addr.town ?? addr.village]
          .filter(Boolean)
          .join(", ")
      : undefined,
    images: extractImages(tags),
    openingHours: tags.opening_hours,
    priceInfo: priceParts.length > 0 ? priceParts.join(" · ") : undefined,
    phone: tags.phone ?? tags["contact:phone"],
    website: tags.website ?? tags["contact:website"],
    tags,
    distanceMeters:
      origin !== undefined ? haversineMeters(origin, { lat, lon }) : undefined,
  };
}

/**
 * Serbest metin arama (isim, şehir, ilçe, kategori, konum).
 * Nominatim üzerinden gerçek sonuçlar döner; sonuç yoksa boş dizi döner.
 */
export interface SearchResult {
  places: Place[];
}

export async function searchPlaces(
  query: string,
  origin?: Coordinates,
): Promise<SearchResult> {
  const q = query.trim();
  if (q.length < 2) return { places: [] };

  const key = `search:${q.toLocaleLowerCase("tr-TR")}:${origin
    ? `${origin.lat.toFixed(2)},${origin.lon.toFixed(2)}`
    : "no"}`;

  try {
    const { value } = await cachedWithStale(key, TTL_SEARCH, async () => {
      const url = `${NOMINATIM}/search?${qs({
        q,
        format: "jsonv2",
        addressdetails: 1,
        extratags: 1,
        limit: 12,
        "accept-language": "tr",
        countrycodes: "tr",
      })}`;
      const results = await fetchJSON<NominatimResult[]>(url, {
        timeoutMs: 8000,
      });
      return results
        .filter((r) => r.osm_type && r.osm_id)
        .map((r) => nominatimToPlace(r, origin));
    });
    return { places: value };
  } catch {
    // Ağ hatası: sessizce boş sonuç — hata ekranı basılmaz.
    return { places: [] };
  }
}

/** Kullanıcının bulunduğu şehri ters geocode ile bulur (isim için). */
export async function reverseCityName(coords: Coordinates): Promise<string | undefined> {
  return cached(`revcity:${coords.lat.toFixed(2)},${coords.lon.toFixed(2)}`, 30 * 60 * 1000, async () => {
    const url = `${NOMINATIM}/reverse?${qs({
      lat: coords.lat,
      lon: coords.lon,
      format: "jsonv2",
      zoom: 10,
      "accept-language": "tr",
    })}`;
    const res = await fetchJSON<NominatimResult & { address?: Record<string, string> }>(url, {
      timeoutMs: 10000,
    });
    const a = res.address ?? {};
    return a.city ?? a.town ?? a.village ?? a.province ?? res.name;
  });
}

/** Detay adresi tamamlamak için ters geocode (addr tag yoksa kullanılır). */
async function reverseAddress(coords: Coordinates): Promise<Partial<Place>> {
  return cached(`revaddr:${coords.lat.toFixed(4)},${coords.lon.toFixed(4)}`, 60 * 60 * 1000, async () => {
    const url = `${NOMINATIM}/reverse?${qs({
      lat: coords.lat,
      lon: coords.lon,
      format: "jsonv2",
      zoom: 18,
      addressdetails: 1,
      "accept-language": "tr",
    })}`;
    const res = await fetchJSON<NominatimResult>(url, { timeoutMs: 10000 });
    const a = res.address ?? {};
    const street = [a.road, a.house_number].filter(Boolean).join(" ");
    return {
      city: a.city ?? a.town ?? a.village ?? a.province,
      district: a.suburb ?? a.district ?? a.county,
      address: street
        ? [street, a.city ?? a.town ?? a.village ?? a.province]
            .filter(Boolean)
            .join(", ")
        : res.display_name,
    };
  });
}

// ------------------------------------------------------------ Detay

/**
 * Mekân detayını getirir: Overpass üzerinden tam tag seti, eksik adres
 * için ters geocode. Bilgi yoksa alan undefined kalır (uydurma yasak).
 */
export async function getPlaceDetail(
  ref: PlaceRef,
  origin?: Coordinates,
): Promise<Place> {
  const base: Place = {
    ...ref,
    categoryId: "attraction",
    images: [],
    tags: {},
  };

  if (ref.osmType && ref.osmId) {
    const typeMap: Record<string, string> = {
      N: "node",
      W: "way",
      R: "relation",
    };
    const osmType = typeMap[ref.osmType];
    const ql = `[out:json][timeout:3];\n${osmType}(id:${ref.osmId});\nout center 15;`;
    try {
      const elements = await queryOverpass(ql);
      const el = elements.find(
        (e) => e.type === osmType && e.id === ref.osmId,
      );
      if (el) {
        const detail = elementToPlace(el, origin);
        if (detail) {
          base.categoryId = detail.categoryId;
          base.description = detail.description;
          base.images = detail.images;
          base.openingHours = detail.openingHours;
          base.priceInfo = detail.priceInfo;
          base.phone = detail.phone;
          base.website = detail.website;
          base.tags = detail.tags;
          if (detail.city) base.city = detail.city;
          if (detail.district) base.district = detail.district;
          if (detail.address) base.address = detail.address;
        }
      }
    } catch {
      // Detay tag'leri alınamadıysa temel ref bilgisiyle devam edilir;
      // eksik alanlar UI'da "Bilgi mevcut değil" olarak gösterilir.
    }
  }

  if (!base.city || !base.address) {
    try {
      const rev = await reverseAddress({
        lat: base.latitude,
        lon: base.longitude,
      });
      base.city = base.city ?? rev.city;
      base.district = base.district ?? rev.district;
      base.address = base.address ?? rev.address;
    } catch {
      /* adres bilgisi opsiyonel */
    }
  }

  return base;
}

/** Bir mekânı PlaceRef'e indirger (storage / deep-link / AI aktarımı için). */
export function toRef(place: Place): PlaceRef {
  return {
    placeId: place.placeId,
    name: place.name,
    latitude: place.latitude,
    longitude: place.longitude,
    address: place.address,
    osmType: place.osmType,
    osmId: place.osmId,
  };
}
