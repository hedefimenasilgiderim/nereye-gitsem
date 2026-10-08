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
    placeId: "local:saatci-ali-efendi-konagi",
    name: "Saatçi Ali Efendi Konağı",
    latitude: 40.7654,
    longitude: 29.9406,
    categoryId: "historic",
    city: "Kocaeli",
    district: "İzmit",
    description: "19. yüzyıldan kalma, restore edilmiş tarihî konak.",
    images: [],
    tags: {},
  },
  {
    placeId: "local:karamursel-sahili",
    name: "Karamürsel Sahili",
    latitude: 40.6894,
    longitude: 29.6169,
    categoryId: "nature",
    city: "Kocaeli",
    district: "Karamürsel",
    description: "İzmit Körfezi'nin güney kıyısında deniz kenarı yürüyüş alanı.",
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
  {
    placeId: "local:kleopatra-plaji",
    name: "Kleopatra Plajı",
    latitude: 36.5446,
    longitude: 31.9963,
    categoryId: "beach",
    city: "Antalya",
    district: "Alanya",
    description: "Alanya'nın ünlü ince kumlu plajı.",
    images: [],
    tags: {},
  },
  {
    placeId: "local:mandabatmaz",
    name: "Mandabatmaz",
    latitude: 41.0314,
    longitude: 28.9759,
    categoryId: "cafe",
    city: "İstanbul",
    district: "Beyoğlu",
    description: "Beyoğlu'nun köklü, sıcak çikolatasıyla ünlü kahvehanesi.",
    images: [],
    tags: {},
  },
  {
    placeId: "local:ciya-sofrasi",
    name: "Çiya Sofrası",
    latitude: 40.9899,
    longitude: 29.0265,
    categoryId: "restaurant",
    city: "İstanbul",
    district: "Kadıköy",
    description: "Anadolu'nun kayıp lezzetlerini sunan ünlü lokanta.",
    images: [],
    tags: {},
  },
  {
    placeId: "local:kanaat-lokantasi",
    name: "Kanaat Lokantası",
    latitude: 41.0246,
    longitude: 29.0143,
    categoryId: "restaurant",
    city: "İstanbul",
    district: "Üsküdar",
    description: "1933'ten beri hizmet veren köklü Türk lokantası.",
    images: [],
    tags: {},
  },
  {
    placeId: "local:istinye-park",
    name: "İstinye Park",
    latitude: 41.1081,
    longitude: 29.1178,
    categoryId: "shopping",
    city: "İstanbul",
    district: "Sarıyer",
    description: "Mağaza, restoran ve sinema içeren büyük alışveriş merkezi.",
    images: [],
    tags: {},
  },
  {
    placeId: "local:kanyon",
    name: "Kanyon",
    latitude: 41.0796,
    longitude: 29.0146,
    categoryId: "shopping",
    city: "İstanbul",
    district: "Beşiktaş",
    description: "Açık hava avlulu, modern mimarili alışveriş merkezi.",
    images: [],
    tags: {},
  },
  {
    placeId: "local:gebze-center",
    name: "Gebze Center",
    latitude: 40.8022,
    longitude: 29.4377,
    categoryId: "shopping",
    city: "Kocaeli",
    district: "Gebze",
    description: "Gebze'nin merkezinde mağaza ve kafe alanları olan AVM.",
    images: [],
    tags: {},
  },
  {
    placeId: "local:ankamall",
    name: "AnkaMall",
    latitude: 39.9624,
    longitude: 32.7878,
    categoryId: "shopping",
    city: "Ankara",
    district: "Yenimahalle",
    description: "Ankara'nın büyük mağaza ve eğlence merkezlerinden biri.",
    images: [],
    tags: {},
  },
  {
    placeId: "local:armada",
    name: "Armada AVM",
    latitude: 39.892,
    longitude: 32.7996,
    categoryId: "shopping",
    city: "Ankara",
    district: "Çankaya",
    description: "Metro girişli, geniş mağaza ve sinema içeren AVM.",
    images: [],
    tags: {},
  },
  {
    placeId: "local:forum-bornova",
    name: "Forum Bornova",
    latitude: 38.4664,
    longitude: 27.2045,
    categoryId: "shopping",
    city: "İzmir",
    district: "Bornova",
    description: "Açık hava konseptli alışveriş ve yaşam merkezi.",
    images: [],
    tags: {},
  },
  {
    placeId: "local:markantalya",
    name: "MarkAntalya",
    latitude: 36.8962,
    longitude: 30.7076,
    categoryId: "shopping",
    city: "Antalya",
    district: "Muratpaşa",
    description: "Şehir merkezinde mağaza ve kafeleri olan AVM.",
    images: [],
    tags: {},
  },
  {
    placeId: "local:isfankbul",
    name: "İsfanbul (Vialand)",
    latitude: 41.0847,
    longitude: 28.7953,
    categoryId: "entertainment",
    city: "İstanbul",
    district: "Eyüpsultan",
    description: "Lunapark, alışveriş ve gösteri alanları içeren tematik park.",
    images: [],
    tags: {},
  },
  {
    placeId: "local:bursa-hayvanat-bahcesi",
    name: "Bursa Hayvanat Bahçesi",
    latitude: 40.2114,
    longitude: 29.0716,
    categoryId: "family",
    city: "Bursa",
    district: "Nilüfer",
    description: "Soğanlı Botanik Park içinde geniş alanlı hayvanat bahçesi.",
    images: [],
    tags: {},
  },
  {
    placeId: "local:boga-heykeli",
    name: "Kadıköy Boğa Heykeli",
    latitude: 40.9885,
    longitude: 29.029,
    categoryId: "photo",
    city: "İstanbul",
    district: "Kadıköy",
    description: "Kadıköy Altıyol'da sembolleşmiş buluşma noktası heykel.",
    images: [],
    tags: {},
  },
];

/**
 * Acil durum verisi için mesafe sınırı: seçilen merkezden daha uzaktaki
 * (örn. başka şehirdeki) mekanlar ASLA gösterilmez.
 */
export const MAX_FALLBACK_DISTANCE_M = 20000;

/** Küçük haversine (osm.ts ile döngüsel import yaratmamak için burada). */
function haversine(
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

/**
 * Acil durum listesini KESİN kategori filtresiyle süzer:
 * - Yalnızca seçili kategorilere ait mekanlar döner — başka kategorinin
 *   mekanları asla karıştırılmaz (örn. Alışveriş'te park çıkmaz).
 * - Merkez verilirse yalnızca 20 km içindeki mekanlar kalır; uzak
 *   şehirlerin (örn. İstanbul) mekanları başka il/ilçede asla görünmez.
 * - Filtre sonrası hiç kayıt kalmazsa BOŞ liste döner.
 */
export function filterFallbackPlaces(opts: {
  center?: Coordinates;
  categoryIds?: string[];
  limit?: number;
}): Place[] {
  const limit = opts.limit ?? 20;
  let list = FALLBACK_PLACES;
  if (opts.categoryIds?.length) {
    list = list.filter((p) => opts.categoryIds!.includes(p.categoryId));
  }
  if (opts.center) {
    list = list.filter(
      (p) =>
        haversine(opts.center!, { lat: p.latitude, lon: p.longitude }) <=
        MAX_FALLBACK_DISTANCE_M,
    );
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
