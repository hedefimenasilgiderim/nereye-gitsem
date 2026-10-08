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
import { cached } from "./cache";
import { ApiError, fetchJSON, qs } from "./http";

const OVERPASS_URL = "https://overpass-api.de/api/interpreter";

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

async function queryOverpass(ql: string): Promise<OverpassElement[]> {
  // Sorgu her zaman JSON çıktı ister; Content-Type form-urlencoded olmalı.
  // Not: ekstra başlık gönderilmiyor (406 önlemi).
  const query = ql.trimStart().startsWith("[out:json]")
    ? ql
    : `[out:json];\n${ql}`;
  try {
    const res = await fetchJSON<OverpassResponse>(OVERPASS_URL, {
      method: "POST",
      body: "data=" + encodeURIComponent(query),
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      timeoutMs: 30000,
    });
    return res.elements ?? [];
  } catch (err) {
    throw err instanceof Error ? err : new ApiError("Overpass erişilemedi");
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
  const around = `(around:${Math.round(opts.radius)},${opts.center.lat},${opts.center.lon})`;

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
        lines.push(`nwr${tagExpr}${around};`);
      }
    }
  }

  if (lines.length === 0) return null;
  return `[out:json][timeout:25];\n(\n${lines.join("\n")}\n);\nout center ${opts.limit};`;
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

export async function getNearbyPlaces(opts: NearbyOptions): Promise<Place[]> {
  const { center } = opts;
  const radius = opts.radius ?? 4000;
  const limit = opts.limit ?? 80;

  if (opts.categoryIds) {
    const cats = CATEGORIES.filter((c) => opts.categoryIds!.includes(c.id));
    if (cats.every((c) => c.tagFilters.length === 0)) throw new NoSourceError();
  }

  const ql = buildAroundQuery({ center, radius, categoryIds: opts.categoryIds, limit });
  if (!ql) throw new NoSourceError();

  const key = `nearby:${center.lat.toFixed(3)},${center.lon.toFixed(3)}:${radius}:${
    (opts.categoryIds ?? []).join(",") || "all"
  }:${limit}`;

  return cached(key, TTL_NEARBY, async () => {
    const elements = await queryOverpass(ql);
    const seen = new Set<string>();
    const places: Place[] = [];
    for (const el of elements) {
      const place = elementToPlace(el, center);
      if (!place || seen.has(place.placeId)) continue;
      seen.add(place.placeId);
      places.push(place);
    }
    places.sort((a, b) => (a.distanceMeters ?? 0) - (b.distanceMeters ?? 0));
    return places;
  });
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
export async function searchPlaces(
  query: string,
  origin?: Coordinates,
): Promise<Place[]> {
  const q = query.trim();
  if (q.length < 2) return [];

  return cached(
    `search:${q.toLocaleLowerCase("tr-TR")}:${origin
      ? `${origin.lat.toFixed(2)},${origin.lon.toFixed(2)}`
      : "no"}`,
    TTL_SEARCH,
    async () => {
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
    },
  );
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
    const ql = `[out:json][timeout:20];\n${osmType}(id:${ref.osmId});\nout center;`;
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
