import type { CategoryDef } from "../models/types";

/**
 * Kategori kayıt defteri.
 *
 * Kategoriler sabit HTML kartları değildir; buradaki kayıt arayüzü üzerinden
 * tanımlanırlar ve Overpass (OpenStreetMap) tag filtreleriyle veriye
 * bağlanırlar. Yeni bir kategori eklemek için sadece bu listeye yeni bir
 * kayıt eklemek yeterlidir — arama, keşif, harita ve AI otomatik olarak
 * yeni kategoriyi kullanır.
 */
export const CATEGORIES: CategoryDef[] = [
  {
    id: "historic",
    label: "Tarihi Yerler",
    emoji: "🏛️",
    color: "#b45309",
    tagFilters: [{ historic: "*" }],
  },
  {
    id: "nature",
    label: "Doğa",
    emoji: "🌿",
    color: "#16a34a",
    tagFilters: [
      { leisure: ["park", "garden", "nature_reserve"] },
      { natural: ["wood", "scrub", "grassland", "wetland"] },
    ],
  },
  {
    id: "beach",
    label: "Deniz / Plaj",
    emoji: "🌊",
    color: "#0284c7",
    tagFilters: [
      { natural: ["beach"] },
      { leisure: ["beach_resort", "marina", "park"] },
      { man_made: ["pier"] },
      { tourism: ["viewpoint"] },
      { amenity: ["cafe"] },
    ],
  },
  {
    id: "cafe",
    label: "Kafe",
    emoji: "☕",
    color: "#92400e",
    tagFilters: [
      { amenity: ["cafe", "tea_garden"] },
      { shop: ["coffee", "pastry"] },
    ],
  },
  {
    id: "restaurant",
    label: "Restoran",
    emoji: "🍽️",
    color: "#dc2626",
    tagFilters: [
      { amenity: ["restaurant", "food_court"] },
      { amenity: ["bar", "pub"] },
    ],
  },
  {
    id: "attraction",
    label: "Gezilecek Yer",
    emoji: "📍",
    color: "#0d9488",
    tagFilters: [
      { tourism: ["attraction", "artwork", "viewpoint"] },
      { historic: ["*"] },
      { leisure: ["park", "garden"] },
      { place: ["square"] },
    ],
  },
  {
    id: "event",
    label: "Etkinlik",
    emoji: "🎭",
    color: "#7c3aed",
    // Etkinlik mekânları: kültür merkezi, tiyatro, sinema, konser/gösteri
    // alanı, sahil ve etkinlik parkları. Uydurma etkinlik üretmek yok;
    // gerçek OSM mekânları gösterilir.
    tagFilters: [
      {
        amenity: [
          "events_venue",
          "community_centre",
          "cinema",
          "theatre",
          "concert_hall",
          "arts_centre",
        ],
      },
      { leisure: ["water_park", "amusement_arcade"] },
    ],
  },
  {
    id: "shopping",
    label: "Alışveriş",
    emoji: "🛍️",
    color: "#db2777",
    tagFilters: [
      { shop: ["mall", "department_store", "marketplace", "clothes", "boutique"] },
      { amenity: ["marketplace"] },
    ],
  },
  {
    id: "entertainment",
    label: "Eğlence",
    emoji: "🎮",
    color: "#4f46e5",
    tagFilters: [
      { amenity: ["cinema", "theatre", "nightclub", "arts_centre"] },
      { leisure: ["amusement_arcade", "escape_game", "bowling_alley", "water_park"] },
      { tourism: ["theme_park"] },
      { sport: ["karting"] },
    ],
  },
  {
    id: "family",
    label: "Aile",
    emoji: "👨‍👩‍👧",
    color: "#0891b2",
    tagFilters: [
      { tourism: ["zoo", "aquarium", "museum", "picnic_site"] },
      { leisure: ["playground", "water_park", "bird_hide"] },
    ],
  },
  {
    id: "photo",
    label: "Fotoğraf Noktaları",
    emoji: "📸",
    color: "#c026d3",
    // Manzara seyir terasları, tarihi yapılar, anıtlar, sahil ve otantik
    // noktalar.
    tagFilters: [
      { tourism: ["viewpoint", "artwork"] },
      { historic: ["monument", "memorial", "castle", "ruins"] },
      { natural: ["beach"] },
    ],
  },
];

const BY_ID = new Map(CATEGORIES.map((c) => [c.id, c]));

export function getCategory(id: string): CategoryDef {
  return (
    BY_ID.get(id) ?? {
      id,
      label: "Diğer",
      emoji: "📍",
      color: "#64748b",
      tagFilters: [],
    }
  );
}
