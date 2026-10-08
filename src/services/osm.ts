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
  sortFallbackByDistance,
} from "../data/fallbackPlaces";
import { cached, cachedWithStale } from "./cache";
import { fetchJSON, qs } from "./http";

// Overpass istekleri tarayıcıdan DOĞRUDAN kamu mirror'larına gider.
// Vercel serverless proxy'si 10 sn limitine takıldığı için kaldırıldı;
// Overpass sunucuları CORS'a açıktır ve tarayıcıdan çalışır.
const DIRECT_MIRRORS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
  "https://overpass.osm.jp/api/interpreter",
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
];

const RACE_MIRROR_COUNT = 3; // ilk 3 mirror'a paralel istek
const RACE_TIMEOUT_MS = 3000; // paralel turda mirror başına sert sınır
const SEQUENTIAL_TIMEOUT_MS = 4000; // kalan mirror'lar için sınır

const NOMINATIM = "https://nominatim.openstreetmap.org";

const TTL_NEARBY = 10 * 60 * 1000; // 10 dk
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

async function fetchMirror(
  url: string,
  query: string,
  timeoutMs: number,
): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: "data=" + encodeURIComponent(query),
      signal: controller.signal,
    });
    // Overpass yoğunlukta XML/HTML hata sayfası döndürebilir; text okuyup
    // parse etmeyi dene (JSON dışı yanıt patlamasın).
    const text = await res.text();
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    JSON.parse(text);
    return text;
  } finally {
    clearTimeout(timer);
  }
}

/** İlk başarılı promise'i bekler (Promise.any ES2021 olduğu için elle yazıldı). */
function firstSuccess(tasks: Promise<string>[]): Promise<string> {
  return new Promise((resolve, reject) => {
    let failed = 0;
    if (tasks.length === 0) {
      reject(new Error("no mirrors"));
      return;
    }
    for (const task of tasks) {
      task.then(resolve, () => {
        if (++failed === tasks.length) {
          reject(new Error("all race mirrors failed"));
        }
      });
    }
  });
}

async function queryOverpass(ql: string): Promise<OverpassElement[]> {
  const normalized = ql.trimStart().startsWith("[out:json]")
    ? ql.replace(/\[timeout:\d+\]/, "[timeout:5]")
    : `[out:json][timeout:5];\n${ql}`;
  const query = normalized.includes("[timeout:5]")
    ? normalized
    : normalized.replace("[out:json]", "[out:json][timeout:5]");

  // Hızlı tur: ilk 3 mirror'a aynı anda istek; en hızlı 200 dönen kazanır.
  try {
    const body = await firstSuccess(
      DIRECT_MIRRORS.slice(0, RACE_MIRROR_COUNT).map((url) =>
        fetchMirror(url, query, RACE_TIMEOUT_MS),
      ),
    );
    return (JSON.parse(body) as OverpassResponse).elements ?? [];
  } catch {
    // Paralel tur başarısız: kalan mirror'lar sırayla denenir.
    for (const url of DIRECT_MIRRORS.slice(RACE_MIRROR_COUNT)) {
      try {
        const body = await fetchMirror(url, query, SEQUENTIAL_TIMEOUT_MS);
        return (JSON.parse(body) as OverpassResponse).elements ?? [];
      } catch {
        /* sonraki mirror */
      }
    }
    throw new Error("Tüm Overpass mirror'ları başarısız");
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
): Place | null {
  const tags = el.tags ?? {};
  const name = tags.name ?? tags["name:tr"];
  if (!name) return null;

  const lat = el.lat ?? el.center?.lat;
  const lon = el.lon ?? el.center?.lon;
  if (lat === undefined || lon === undefined) return null;

  const categoryId = categorize(tags);
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
  // WAF/timeout koruması: 5 km ana arama; 0 sonuç durumunda 15 km
  // fallback'e izin vermek için üst sınır 15 km.
  const cappedRadius = Math.min(Math.round(opts.radius), 15000);
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
  const limit = opts.radius > 5000 ? 15 : opts.limit;
  return `[out:json][timeout:5];\n(\n${lines.join("\n")}\n);\nout center ${limit};`;
}

export interface NearbyOptions {
  center: Coordinates;
  radius?: number;
  categoryIds?: string[];
  limit?: number;
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
  stale: boolean;
}

export async function getNearbyPlaces(opts: NearbyOptions): Promise<NearbyResult> {
  const { center } = opts;
  const radius = opts.radius ?? 4000;
  const limit = opts.limit ?? 80;

  if (opts.categoryIds) {
    const cats = CATEGORIES.filter((c) => opts.categoryIds!.includes(c.id));
    if (cats.every((c) => c.tagFilters.length === 0)) throw new NoSourceError();
  }

  const ql = buildAroundQuery({ center, radius, categoryIds: opts.categoryIds, limit });
  if (!ql) throw new NoSourceError();

  // 0 sonuçta genel yarıçap fallback'i: turizm/boş zaman etiketli popüler noktalar.
  const POPULAR_FALLBACK_IDS = ["attraction", "nature", "family", "photo"];

  const key = `nearby:${center.lat.toFixed(3)},${center.lon.toFixed(3)}:${radius}:${
    (opts.categoryIds ?? []).join(",") || "all"
  }:${limit}`;

  try {
    const { value, stale } = await cachedWithStale(key, TTL_NEARBY, async () => {
      let elements = await queryOverpass(ql);

      // 5 km boş döndüyse aynı sorguyu 15 km ile tek seferlik tekrar dene.
      if (elements.length === 0) {
        const wideQl = buildAroundQuery({
          center,
          radius: 15000,
          categoryIds: opts.categoryIds,
          limit,
        });
        if (wideQl) elements = await queryOverpass(wideQl);
      }

      const seen = new Set<string>();
      const places: Place[] = [];
      const collect = (els: OverpassElement[]) => {
        for (const el of els) {
          const place = elementToPlace(el, center);
          if (!place || seen.has(place.placeId)) continue;
          seen.add(place.placeId);
          places.push(place);
        }
      };
      collect(elements);

      // Seçili kategori 0 sonuç döndürse bile kullanıcıya "Sonuç bulunamadı"
      // yerine yakındaki genel popüler noktalar gösterilir.
      if (places.length === 0 && opts.categoryIds?.length) {
        const popQl = buildAroundQuery({
          center,
          radius: 15000,
          categoryIds: POPULAR_FALLBACK_IDS,
          limit,
        });
        if (popQl) collect(await queryOverpass(popQl));
      }

      places.sort((a, b) => (a.distanceMeters ?? 0) - (b.distanceMeters ?? 0));
      return places;
    });

    return { places: value, stale };
  } catch {
    // Crash Guard: tüm mirror'lar başarısız/yavaş olsa bile uygulama
    // hata ekranı basmaz; gerçek popüler noktalardan oluşan acil durum
    // verisi gösterilir (banner ile "çevrimdışı veri" belirtilir).
    const fallback = sortFallbackByDistance(
      filterFallbackPlaces({ categoryIds: opts.categoryIds, limit }),
      center,
      haversineMeters,
    );
    return { places: fallback, stale: true };
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
  stale: boolean;
}

export async function searchPlaces(
  query: string,
  origin?: Coordinates,
): Promise<SearchResult> {
  const q = query.trim();
  if (q.length < 2) return { places: [], stale: false };

  const key = `search:${q.toLocaleLowerCase("tr-TR")}:${origin
    ? `${origin.lat.toFixed(2)},${origin.lon.toFixed(2)}`
    : "no"}`;

  const { value, stale } = await cachedWithStale(key, TTL_SEARCH, async () => {
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
      timeoutMs: 12000,
    });
    return results
      .filter((r) => r.osm_type && r.osm_id)
      .map((r) => nominatimToPlace(r, origin));
  });

  return { places: value, stale };
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
    const ql = `[out:json][timeout:5];\n${osmType}(id:${ref.osmId});\nout center 15;`;
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
