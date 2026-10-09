import type { DiscoveryModeDef } from "../models/types";

/**
 * "Bugün nasıl bir yer istiyorsun?" keşif modları.
 * Kategori kayıt defterine (categories.ts) bağlıdır; yeni mod eklemek
 * için buraya yeni kayıt eklemek yeterlidir.
 */
export const DISCOVERY_MODES: DiscoveryModeDef[] = [
  {
    id: "calm",
    label: "Sakin",
    emoji: "🌿",
    description: "Kalabalıktan uzak, huzurlu mekânlar",
    categoryIds: ["nature", "photo"],
  },
  {
    id: "scenic",
    label: "Manzaralı",
    emoji: "📸",
    description: "Fotoğraflık noktalar ve seyir yerleri",
    categoryIds: ["photo", "attraction"],
  },
  {
    id: "budget",
    label: "Ekonomik",
    emoji: "💰",
    description: "Ücretsiz veya düşük maliyetli seçenekler",
    categoryIds: ["nature", "beach", "photo"],
    preferFree: true,
  },
  {
    id: "coffee",
    label: "Kahve Molalı",
    emoji: "☕",
    description: "Mola vermek için güzel kafeler",
    categoryIds: ["cafe"],
  },
  {
    id: "history",
    label: "Tarihi",
    emoji: "🏛️",
    description: "Tarih kokan yerler ve eserler",
    categoryIds: ["historic", "attraction"],
  },
  {
    id: "sea",
    label: "Deniz",
    emoji: "🌊",
    description: "Sahil, plaj ve deniz keyfi",
    categoryIds: ["beach"],
  },
  {
    id: "outdoor",
    label: "Doğa",
    emoji: "🌲",
    description: "Yeşil alanlar ve doğa yürüyüşleri",
    categoryIds: ["nature"],
  },
  {
    id: "fun",
    label: "Eğlence",
    emoji: "🎮",
    description: "Eğleneceğin, vakit geçireceğin yerler",
    categoryIds: ["entertainment"],
  },
];
