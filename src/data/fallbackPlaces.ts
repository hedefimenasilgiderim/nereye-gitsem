import type { Coordinates, Place } from "../models/types";

/**
 * Çevrimdışı acil durum verisi (Crash Guard).
 *
 * Tüm Overpass sunucuları erişilemezse veya ağ çok yavaşsa uygulama
 * "Bir sorun oluştu" ekranı yerine bu gerçek popüler noktaları gösterir.
 * Koordinatlar yaklaşık değerlerdir; ağ döndüğünde canlı OSM verisi ile
 * otomatik olarak değiştirilir.
 */
export const FALLBACK_PLACES: Place[] = [
  {
    placeId: "local:seka-park",
    name: "Seka Park",
    latitude: 40.7797,
    longitude: 29.9385,
    categoryId: "nature",
    city: "Kocaeli",
    district: "İzmit",
    description: "Kocaeli'nin en büyük sahil parkı; yürüyüş yolları, gölet ve kafe alanları.",
    images: [],
    tags: {},
  },
  {
    placeId: "local:basiskele-sahil",
    name: "Başiskele Sahil Parkı",
    latitude: 40.6861,
    longitude: 29.95,
    categoryId: "nature",
    city: "Kocaeli",
    district: "Başiskele",
    description: "İzmit Körfezi kıyısında yürüyüş ve dinlenme alanı.",
    images: [],
    tags: {},
  },
  {
    placeId: "local:kirtepe-mesire",
    name: "Kırtepe Mesire Alanı",
    latitude: 40.67,
    longitude: 29.92,
    categoryId: "nature",
    city: "Kocaeli",
    district: "Başiskele",
    description: "Şehir manzaralı mesire ve piknik alanı.",
    images: [],
    tags: {},
  },
  {
    placeId: "local:gulhane-parki",
    name: "Gülhane Parkı",
    latitude: 41.0166,
    longitude: 28.9797,
    categoryId: "nature",
    city: "İstanbul",
    district: "Fatih",
    description: "Sarayburnu'nda, Osmanlı dönemi saray bahçesinden dönüştürülmüş tarihi park.",
    images: [],
    tags: {},
  },
  {
    placeId: "local:emirgan-korusu",
    name: "Emirgan Korusu",
    latitude: 41.1049,
    longitude: 29.0459,
    categoryId: "nature",
    city: "İstanbul",
    district: "Sarıyer",
    description: "Boğaz manzaralı, lale festivaliyle ünlü tarihi koru ve park.",
    images: [],
    tags: {},
  },
  {
    placeId: "local:galata-kulesi",
    name: "Galata Kulesi",
    latitude: 41.0256,
    longitude: 28.9744,
    categoryId: "attraction",
    city: "İstanbul",
    district: "Beyoğlu",
    description: "Ceneviz döneminden kalma tarihi kule; 360° şehir manzarası.",
    images: [],
    tags: {},
  },
  {
    placeId: "local:pierre-loti-tepesi",
    name: "Pierre Loti Tepesi",
    latitude: 41.0475,
    longitude: 28.9339,
    categoryId: "photo",
    city: "İstanbul",
    district: "Eyüpsultan",
    description: "Haliç'e bakan teleferikli manzara tepesi.",
    images: [],
    tags: {},
  },
  {
    placeId: "local:pierre-loti-kafe",
    name: "Pierre Loti Café",
    latitude: 41.0478,
    longitude: 28.9341,
    categoryId: "cafe",
    city: "İstanbul",
    district: "Eyüpsultan",
    description: "Tepede, Haliç manzaralı tarihi kafe.",
    images: [],
    tags: {},
  },
  {
    placeId: "local:fazil-bey-kahvesi",
    name: "Fazıl Bey'in Kahvesi",
    latitude: 40.988,
    longitude: 29.0269,
    categoryId: "cafe",
    city: "İstanbul",
    district: "Kadıköy",
    description: "1923'ten beri hizmet veren tarihi Türk kahvesi.",
    images: [],
    tags: {},
  },
  {
    placeId: "local:moda-sahili",
    name: "Moda Sahili",
    latitude: 40.9848,
    longitude: 29.027,
    categoryId: "attraction",
    city: "İstanbul",
    district: "Kadıköy",
    description: "Kadıköy'de yürüyüş ve gün batımı için popüler sahil hattı.",
    images: [],
    tags: {},
  },
  {
    placeId: "local:genclik-parki",
    name: "Gençlik Parkı",
    latitude: 39.9403,
    longitude: 32.853,
    categoryId: "nature",
    city: "Ankara",
    district: "Ulus",
    description: "Ankara'nın klasik lunaparklı ve göletli büyük parkı.",
    images: [],
    tags: {},
  },
  {
    placeId: "local:anitkabir",
    name: "Anıtkabir",
    latitude: 39.9254,
    longitude: 32.8376,
    categoryId: "historic",
    city: "Ankara",
    district: "Çankaya",
    description: "Atatürk'ün anıt mezarı; mimarisiyle ünlü ulusal anıt.",
    images: [],
    tags: {},
  },
  {
    placeId: "local:kugulu-park",
    name: "Kuğulu Park",
    latitude: 39.9036,
    longitude: 32.8574,
    categoryId: "nature",
    city: "Ankara",
    district: "Çankaya",
    description: "Tunalı Hilmi Caddesi üzerinde kuğularıyla ünlü park.",
    images: [],
    tags: {},
  },
  {
    placeId: "local:kulturpark",
    name: "Kültürpark",
    latitude: 38.4367,
    longitude: 27.1411,
    categoryId: "nature",
    city: "İzmir",
    district: "Konak",
    description: "Fuar alanını kapsayan, İzmir'in en bilinen şehir parkı.",
    images: [],
    tags: {},
  },
  {
    placeId: "local:kaleici",
    name: "Kaleiçi",
    latitude: 36.8846,
    longitude: 30.7051,
    categoryId: "attraction",
    city: "Antalya",
    district: "Muratpaşa",
    description: "Antalya'nın tarihi liman bölgesi; dar sokaklar ve Osmanlı evleri.",
    images: [],
    tags: {},
  },
  {
    placeId: "local:konyaalti-plaji",
    name: "Konyaaltı Plajı",
    latitude: 36.862,
    longitude: 30.632,
    categoryId: "beach",
    city: "Antalya",
    district: "Muratpaşa",
    description: "Dağ manzaralı, uzun ve popüler şehir plajı.",
    images: [],
    tags: {},
  },
];

/**
 * Acil durum listesini kategoriye göre filtreler. Seçili kategorilerde
 * hiç kayıt yoksa genel listeye geri döner — kullanıcıya asla boş ekran
 * gösterilmez.
 */
export function filterFallbackPlaces(opts: {
  categoryIds?: string[];
  limit?: number;
}): Place[] {
  const limit = opts.limit ?? 20;
  let list = FALLBACK_PLACES;
  if (opts.categoryIds?.length) {
    const filtered = list.filter((p) => opts.categoryIds!.includes(p.categoryId));
    if (filtered.length > 0) list = filtered;
  }
  return list.slice(0, limit);
}

/** Kullanıcı konumuna göre acil durum listesini mesafeye göre sıralar. */
export function sortFallbackByDistance(
  places: Place[],
  center: Coordinates,
  haversine: (a: Coordinates, b: { lat: number; lon: number }) => number,
): Place[] {
  return places
    .map((p) => ({
      ...p,
      distanceMeters: haversine(center, { lat: p.latitude, lon: p.longitude }),
    }))
    .sort((a, b) => (a.distanceMeters ?? 0) - (b.distanceMeters ?? 0));
}
