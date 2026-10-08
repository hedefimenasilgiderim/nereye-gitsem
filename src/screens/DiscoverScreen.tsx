/**
 * Ana sayfa — Keşfet.
 * Arama, kategoriler, keşif modları ve konum/şehir tabanlı "yakınındaki
 * yerler" akışı. Konum izni yoksa uygulama çalışmaya devam eder.
 */

import { useEffect, useMemo, useState } from "react";
import { useNavigation } from "../app/navigation";
import { useAppState } from "../app/state";
import { CATEGORIES } from "../data/categories";
import { DISCOVERY_MODES } from "../data/modes";
import { CITIES } from "../data/cities";
import { getNearbyPlaces } from "../services/osm";
import type { Place } from "../models/types";
import { PlaceCard } from "../components/PlaceCard";
import { EmptyState, LoadingBlock, SkeletonList } from "../components/states";

export function DiscoverScreen() {
  const nav = useNavigation();
  const { location, selectedCity, setSelectedCity, favorites, toggleFavorite } =
    useAppState();

  const [activeFilter, setActiveFilter] = useState<{
    label: string;
    categoryIds: string[];
    preferFree?: boolean;
  } | null>(null);

  const [places, setPlaces] = useState<Place[]>([]);
  const [state, setState] = useState<"loading" | "ready">("loading");
  const [reloadKey, setReloadKey] = useState(0);

  // Merkez nokta: kullanıcı konumu > seçili şehir > ilk büyük şehir önerisi
  const center = useMemo(() => {
    if (location.status === "granted") return location.coords;
    if (selectedCity) {
      const c = CITIES.find((x) => x.name === selectedCity);
      if (c) return { lat: c.lat, lon: c.lon };
    }
    return null;
  }, [location, selectedCity]);

  const originLabel = useMemo(() => {
    if (location.status === "granted")
      return location.city ? location.city : "Yakınındaki yerler";
    if (selectedCity) return selectedCity;
    return null;
  }, [location, selectedCity]);

  useEffect(() => {
    if (!center) {
      setPlaces([]);
      setState("ready");
      return;
    }
    let cancelled = false;
    setState("loading");

    const radius = activeFilter ? 12000 : location.status === "granted" ? 4000 : 8000;
    getNearbyPlaces({
      center,
      radius,
      categoryIds: activeFilter?.categoryIds,
      limit: activeFilter ? 60 : 40,
      cityKey: location.status === "granted"
        ? location.city ?? selectedCity ?? undefined
        : selectedCity ?? undefined,
    })
      .then((result) => {
        if (cancelled) return;
        let list = result.places;
        if (activeFilter?.preferFree) {
          list = list.filter((p) => p.tags.fee !== "yes" && !p.tags.charge);
        }
        setPlaces(list);
        setState("ready");
      })
      .catch(() => {
        // Yalnızca veri kaynağı olmayan kategoriler (Etkinlik) buraya düşer;
        // ağ hataları servis içinde sessizce yerel veriye düşer.
        if (cancelled) return;
        setPlaces([]);
        setState("ready");
      });

    return () => {
      cancelled = true;
    };
  }, [
    center?.lat,
    center?.lon,
    activeFilter?.label,
    location.status,
    selectedCity,
    reloadKey,
  ]);

  return (
    <div className="sunset-background pb-24">
      {/* Üst bölüm */}
      <header className="safe-top px-4 pb-4 pt-3">
        <p className="text-2xl font-extrabold leading-tight text-ink">
          Bugün nereye gitmek istersin?
        </p>

        <button
          onClick={nav.openSearch}
          className="mt-3 flex w-full items-center gap-2 rounded-2xl border border-line bg-surface px-4 py-3 text-left text-sm text-muted shadow-sm active:scale-[0.99]"
        >
          <span>🔎</span>
          <span>Yer, şehir, mekân veya kategori ara...</span>
        </button>

        {/* Konum / şehir durumu */}
        <div className="no-scrollbar mt-3 flex items-center gap-2 overflow-x-auto">
          {location.status === "granted" && (
            <span className="flex shrink-0 items-center gap-1 rounded-full bg-brand px-3 py-1.5 text-xs font-bold text-white">
              📍 {location.city ?? "Konumun alındı"}
            </span>
          )}
          {location.status === "locating" && (
            <span className="shrink-0 rounded-full bg-surface px-3 py-1.5 text-xs font-semibold text-muted">
              📍 Konum alınıyor...
            </span>
          )}
          {(location.status === "denied" || location.status === "unavailable") && (
            <button
              onClick={nav.openCitySelect}
              className="flex shrink-0 items-center gap-1 rounded-full bg-amber-100 px-3 py-1.5 text-xs font-bold text-amber-800"
            >
              📍 Konum izni yok — Şehir seç
            </button>
          )}
          {selectedCity && (
            <button
              onClick={nav.openCitySelect}
              className="shrink-0 rounded-full bg-surface px-3 py-1.5 text-xs font-semibold text-ink-soft"
            >
              🏙️ {selectedCity}
            </button>
          )}
          <button
            onClick={nav.openCitySelect}
            className="shrink-0 rounded-full bg-surface px-3 py-1.5 text-xs font-semibold text-ink-soft"
          >
            🏙️ Şehir değiştir
          </button>
        </div>
      </header>

      <div className="px-4">
        {/* Kategoriler */}
        <section className="mt-5">
          <h2 className="mb-2 text-sm font-bold text-ink-soft">Kategoriler</h2>
          <div className="grid grid-cols-5 gap-2">
            {CATEGORIES.map((cat) => {
              const active =
                activeFilter?.categoryIds.length === 1 &&
                activeFilter.categoryIds[0] === cat.id;
              return (
                <button
                  key={cat.id}
                  onClick={() =>
                    setActiveFilter(
                      active ? null : { label: cat.label, categoryIds: [cat.id] },
                    )
                  }
                  className={`flex flex-col items-center gap-1 rounded-2xl px-1 py-2.5 text-center transition active:scale-95 ${
                    active
                      ? "bg-brand text-white"
                      : "bg-surface text-ink-soft shadow-[0_1px_2px_rgba(15,23,42,0.05)]"
                  }`}
                >
                  <span className="text-xl">{cat.emoji}</span>
                  <span className="text-[9px] font-semibold leading-tight">
                    {cat.label}
                  </span>
                </button>
              );
            })}
          </div>
        </section>

        {/* Keşif modları */}
        <section className="mt-5">
          <h2 className="mb-2 text-sm font-bold text-ink-soft">
            Bugün nasıl bir yer istiyorsun?
          </h2>
          <div className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
            {DISCOVERY_MODES.map((mode) => {
              const active = activeFilter?.label === mode.label;
              return (
                <button
                  key={mode.id}
                  onClick={() =>
                    setActiveFilter(
                      active
                        ? null
                        : {
                            label: mode.label,
                            categoryIds: mode.categoryIds,
                            preferFree: mode.preferFree,
                          },
                    )
                  }
                  className={`flex shrink-0 items-center gap-2 rounded-full px-4 py-2.5 text-sm font-semibold transition active:scale-95 ${
                    active
                      ? "bg-accent text-white"
                      : "bg-surface text-ink-soft shadow-[0_1px_2px_rgba(15,23,42,0.05)]"
                  }`}
                >
                  <span>{mode.emoji}</span>
                  {mode.label}
                </button>
              );
            })}
          </div>
          {activeFilter && (
            <p className="mt-2 text-xs text-muted">
              <strong>{activeFilter.label}</strong> için sonuçlar · temizlemek
              için tekrar dokun
            </p>
          )}
        </section>

        {/* Yakındaki / şehirdeki yerler */}
        <section className="mt-5">
          <div className="mb-2 flex items-baseline justify-between">
            <h2 className="text-sm font-bold text-ink-soft">
              {center
                ? originLabel
                  ? `${originLabel} ${activeFilter ? "· " + activeFilter.label : "yerler"}`
                  : "Yakınındaki yerler"
                : "Keşfe başla"}
            </h2>
            {center && state === "ready" && places.length > 0 && (
              <button
                onClick={() => nav.setTab("map")}
                className="text-xs font-bold text-brand"
              >
                Haritada gör →
              </button>
            )}
          </div>

          {!center ? (
            <EmptyState
              emoji="📍"
              title="Nerede keşfetmek istersin?"
              description="Konum izni vererek çevrendeki yerleri görebilir ya da bir şehir seçerek keşfe başlayabilirsin. Uygulama konum olmadan da çalışır."
              action={
                <div className="mt-3 flex flex-col gap-2">
                  <button
                    onClick={nav.openCitySelect}
                    className="rounded-full bg-brand px-5 py-2.5 text-sm font-bold text-white active:scale-95"
                  >
                    🏙️ Şehir Seç
                  </button>
                  <p className="text-[11px] text-muted">
                    Şehir seçenekleri: {CITIES.slice(0, 6).map((c) => c.name).join(", ")}...
                  </p>
                </div>
              }
            />
          ) : state === "loading" ? (
            <SkeletonList rows={4} />
          ) : places.length === 0 ? (
            <EmptyState
              emoji="🧭"
              title={
                activeFilter
                  ? `${activeFilter.label} için şimdilik öneri yok`
                  : "Şimdilik burada öneri yok"
              }
              description="Kaynaklar birazdan güncellenebilir; tekrar denemek için dokun."
              action={
                <button
                  onClick={() => setReloadKey((k) => k + 1)}
                  className="mt-3 rounded-full bg-brand px-5 py-2 text-sm font-semibold text-white active:scale-95"
                >
                  Yenile
                </button>
              }
            />
          ) : (
            <div className="space-y-3">
              {places.slice(0, 12).map((place) => (
                <PlaceCard
                  key={place.placeId}
                  place={place}
                  onClick={() => nav.openPlace(place)}
                  isFavorite={favorites.some((f) => f.placeId === place.placeId)}
                  onToggleFavorite={() => toggleFavorite(place)}
                  onNavigate={() => nav.openPlace(place)}
                />
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
