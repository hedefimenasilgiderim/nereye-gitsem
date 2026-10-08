/**
 * Harita ekranı — Leaflet + OpenStreetMap.
 * Kategori filtreleri istemci tarafında uygulanır (gereksiz API çağrısı yok).
 */

import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { useNavigation } from "../app/navigation";
import { useAppState } from "../app/state";
import { CATEGORIES } from "../data/categories";
import { CITIES } from "../data/cities";
import { getNearbyPlaces } from "../services/osm";
import type { Coordinates, Place } from "../models/types";
import { NavigateButton } from "../components/NavigateButton";
import { OfflineBanner } from "../components/states";
import { getCategory } from "../data/categories";

const MapView = lazy(() =>
  import("../components/MapView").then((m) => ({ default: m.MapView })),
);

export function MapScreen() {
  const nav = useNavigation();
  const { location, selectedCity } = useAppState();

  const [places, setPlaces] = useState<Place[]>([]);
  const [status, setStatus] = useState<"loading" | "ready">("loading");
  const [selected, setSelected] = useState<Place | null>(null);
  const [activeCategories, setActiveCategories] = useState<Set<string>>(new Set());
  const [tilesOffline, setTilesOffline] = useState(false);

  const center = useMemo<Coordinates>(() => {
    if (location.status === "granted") return location.coords;
    const c = CITIES.find((x) => x.name === selectedCity) ?? CITIES[0];
    return { lat: c.lat, lon: c.lon };
  }, [location, selectedCity]);

  useEffect(() => {
    let cancelled = false;
    setStatus("loading");
    getNearbyPlaces({ center, radius: 8000, limit: 120 })
      .then((result) => {
        if (cancelled) return;
        setPlaces(result.places);
        setStatus("ready");
      })
      .catch(() => {
        // Ağ hataları servis içinde sessizce yerel veriye düşer; burada
        // hata durumu gösterilmez.
        if (cancelled) return;
        setPlaces([]);
        setStatus("ready");
      });
    return () => {
      cancelled = true;
    };
  }, [center.lat, center.lon]);

  const filtered = useMemo(() => {
    if (activeCategories.size === 0) return places;
    return places.filter((p) => activeCategories.has(p.categoryId));
  }, [places, activeCategories]);

  const toggleCategory = (id: string) => {
    setActiveCategories((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div className="sunset-background relative h-screen w-full">
      <Suspense
        fallback={
          <div className="flex h-full items-center justify-center text-sm text-muted">
            Harita yükleniyor...
          </div>
        }
      >
        <MapView
          center={center}
          centerKey={`${center.lat.toFixed(3)},${center.lon.toFixed(3)}`}
          zoom={location.status === "granted" ? 13 : 12}
          places={filtered}
          userCoords={location.status === "granted" ? location.coords : undefined}
          onSelectPlace={(p) => setSelected(p)}
          onTilesError={() => setTilesOffline(true)}
        />
      </Suspense>

      {/* Kategori filtre şeridi */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-[500]">
        <div className="safe-top bg-gradient-to-b from-black/40 to-transparent px-3 pb-6 pt-3">
          <OfflineBanner show={tilesOffline} />
          <div className="no-scrollbar mt-1 flex gap-2 overflow-x-auto">
            <button
              onClick={() => setActiveCategories(new Set())}
              className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-bold shadow ${
                activeCategories.size === 0
                  ? "bg-ink text-white"
                  : "bg-surface text-ink-soft"
              }`}
            >
              Tümü
            </button>
            {CATEGORIES.filter((c) => c.tagFilters.length > 0).map((cat) => {
              const active = activeCategories.has(cat.id);
              return (
                <button
                  key={cat.id}
                  onClick={() => toggleCategory(cat.id)}
                  className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-bold shadow ${
                    active ? "text-white" : "bg-surface text-ink-soft"
                  }`}
                  style={active ? { backgroundColor: cat.color } : undefined}
                >
                  {cat.emoji} {cat.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Yükleme durumu */}
      {status === "loading" && (
        <div className="absolute inset-x-0 top-24 z-[500] mx-auto w-fit rounded-full bg-surface px-4 py-2 text-xs font-semibold text-muted shadow">
          Mekânlar yükleniyor...
        </div>
      )}

      {/* Seçili mekân önizlemesi */}
      {selected && (
        <div className="safe-bottom absolute inset-x-0 bottom-0 z-[600] rounded-t-3xl bg-surface p-4 shadow-2xl">
          <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-line" />
          <div className="flex items-start gap-3">
            <div
              className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl text-2xl"
              style={{
                backgroundColor: `${getCategory(selected.categoryId).color}1a`,
              }}
            >
              {getCategory(selected.categoryId).emoji}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate font-bold text-ink">{selected.name}</p>
              <p className="text-xs text-muted">
                {getCategory(selected.categoryId).label}
                {selected.city ? ` · ${selected.city}` : ""}
              </p>
            </div>
            <button
              onClick={() => setSelected(null)}
              className="rounded-full bg-bg px-3 py-1 text-xs font-bold text-muted"
            >
              Kapat
            </button>
          </div>
          <div className="mt-3 flex gap-2">
            <button
              onClick={() => {
                const ref = selected;
                setSelected(null);
                nav.openPlace(ref);
              }}
              className="flex-1 rounded-xl bg-ink py-3 text-sm font-bold text-white active:scale-95"
            >
              Detayları gör
            </button>
            <div className="flex-1">
              <NavigateButton place={selected} size="compact" />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
