/**
 * Firebase Firestore — Cache-First mimari.
 *
 * Kamu Overpass API'sine canlı bağımlılığı bitirmek için kategori/şehir
 * bazlı mekan verileri `places_cache` koleksiyonunda tutulur:
 *   doc id: `{sehir}_{kategori}` (örn. `basiskele_kafe`, `izmit_doga`)
 *   alanlar: places[], source, createdAt, expireAt
 *
 * Yapılandırma Vite env değişkenlerinden okunur (VITE_FIREBASE_*).
 * Firebase yapılandırılmamışsa TÜM cache fonksiyonları sessizce no-op
 * olur; uygulama Overpass → yerel veri akışıyla kesintisiz çalışır.
 */

import { initializeApp, type FirebaseApp } from "firebase/app";
import {
  doc,
  getDoc,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  setDoc,
  Timestamp,
  type Firestore,
} from "firebase/firestore";
import type { Place } from "../models/types";

const FIREBASE_CONFIG = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY as string | undefined,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN as string | undefined,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID as string | undefined,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET as string | undefined,
  messagingSenderId: import.meta.env
    .VITE_FIREBASE_MESSAGING_SENDER_ID as string | undefined,
  appId: import.meta.env.VITE_FIREBASE_APP_ID as string | undefined,
};

export const PLACES_CACHE_COLLECTION = "places_cache_v132";

/** Overpass'ten gelen gerçek verinin önbellek süresi. */
export const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 gün
/** Yerel fallback verisinin önbellek süresi (yerine gerçek veri geçsin). */
export const FALLBACK_CACHE_TTL_MS = 60 * 60 * 1000; // 1 saat

let app: FirebaseApp | null = null;
let db: Firestore | null = null;
let initTried = false;

function getDb(): Firestore | null {
  if (initTried) return db;
  initTried = true;
  if (!FIREBASE_CONFIG.apiKey || !FIREBASE_CONFIG.projectId) return null;
  try {
    app = initializeApp({
      apiKey: FIREBASE_CONFIG.apiKey,
      authDomain: FIREBASE_CONFIG.authDomain,
      projectId: FIREBASE_CONFIG.projectId,
      storageBucket: FIREBASE_CONFIG.storageBucket,
      messagingSenderId: FIREBASE_CONFIG.messagingSenderId,
      appId: FIREBASE_CONFIG.appId,
    });
    // Kalıcı (IndexedDB) önbellek: çevrimdışı tekrarlarda Firestore'dan
    // milisaniyeler içinde dönüş yapılır.
    db = initializeFirestore(app, {
      localCache: persistentLocalCache({
        tabManager: persistentMultipleTabManager(),
      }),
    });
  } catch {
    db = null;
  }
  return db;
}

/** Türkçe karakterleri sadeleştirip güvenli doc kimliği parçası üretir. */
function slug(text: string): string {
  return text
    .toLocaleLowerCase("tr-TR")
    .replace(/ı/g, "i")
    .replace(/İ/g, "i")
    .replace(/ş/g, "s")
    .replace(/ğ/g, "g")
    .replace(/ü/g, "u")
    .replace(/ö/g, "o")
    .replace(/ç/g, "c")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

/** `{sehir}_{kategori}` biçiminde doc kimliği (örn. `basiskele_kafe`). */
export function placeCacheDocId(cityKey: string | undefined, categoryId: string): string {
  const city = cityKey ? slug(cityKey) : "geo";
  return `${city}_${slug(categoryId)}`;
}

export type CacheSource = "overpass" | "fallback";

/** Önbellekten mekan listesi okur; yoksa / süresi dolduysa null döner. */
export async function readPlaceCache(docId: string): Promise<Place[] | null> {
  const d = getDb();
  if (!d) return null;
  try {
    const snap = await getDoc(doc(d, PLACES_CACHE_COLLECTION, docId));
    if (!snap.exists()) return null;
    const data = snap.data() as {
      places?: Place[];
      expireAt?: Timestamp;
    };
    if (!Array.isArray(data.places) || data.places.length === 0) return null;
    const expireMs = data.expireAt?.toMillis?.() ?? 0;
    if (expireMs && expireMs < Date.now()) return null;
    return data.places;
  } catch {
    // Firebase yok / ağ yok / kural engeli — sessizce cache miss döner.
    return null;
  }
}

/** Mekan listesini önbelleğe yazar (read-through). Hata durumunda sessiz. */
export async function writePlaceCache(
  docId: string,
  places: Place[],
  source: CacheSource = "overpass",
  ttlMs: number = CACHE_TTL_MS,
): Promise<void> {
  const d = getDb();
  if (!d || places.length === 0) return;
  try {
    // distanceMeters cihazın konumuna bağlıdır; saklanmaz, okuma anında
    // yeniden hesaplanır.
    await setDoc(doc(d, PLACES_CACHE_COLLECTION, docId), {
      places: places.map(({ distanceMeters: _distance, ...rest }) => rest),
      source,
      createdAt: Timestamp.now(),
      expireAt: Timestamp.fromMillis(Date.now() + ttlMs),
    });
  } catch {
    // Cache yazımı opsiyoneldir; hata akışı etkilemez.
  }
}
