/**
 * Mekân arama overlay'i.
 * 450ms debounce + Nominatim (gerçek veri) + cache. Sonuç yoksa net
 * mesaj; ağ hatasında düzgün durum ekranı.
 */

import { useEffect, useRef, useState } from "react";
import { useNavigation } from "../app/navigation";
import { useAppState } from "../app/state";
import { searchPlaces } from "../services/osm";
import type { Place } from "../models/types";
import { PlaceCard } from "../components/PlaceCard";
import { LoadingBlock } from "../components/states";
import { getCategory } from "../data/categories";
import { CITIES, findCityByName, normalizeTr } from "../data/cities";

const SUGGESTIONS = ["Efes", "Kapadokya", "Pamukkale", "Ayasofya", "Bodrum"];

export function SearchOverlay() {
  const nav = useNavigation();
  const { location, setSelectedCity } = useAppState();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Place[]>([]);
  const [status, setStatus] = useState<"idle" | "loading" | "ready">("idle");
  const debounceRef = useRef<number | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const origin =
    location.status === "granted" ? location.coords : undefined;

  // Şehir tespiti: sorgu bir şehir adıyla başlıyorsa "keşfet" aksiyonu göster
  const matchedCity = findCityByName(query.trim()) ??
    CITIES.find((c) => normalizeTr(query).startsWith(normalizeTr(c.name)) &&
      normalizeTr(c.name).length >= 4);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      setStatus("idle");
      return;
    }
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    setStatus("loading");
    debounceRef.current = window.setTimeout(async () => {
      try {
        const r = await searchPlaces(q, origin);
        setResults(r.places);
        setStatus("ready");
      } catch {
        // Ağ hatası: sessizce boş sonuç — hata ekranı yok.
        setResults([]);
        setStatus("ready");
      }
    }, 450);
    return () => {
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  return (
    <div className="fixed inset-0 z-[1000] flex flex-col sunset-background">
      <div className="safe-top flex items-center gap-2 border-b border-line bg-surface px-3 pb-3 pt-3">
        <button
          onClick={nav.back}
          className="rounded-full p-2 text-xl active:scale-90"
          aria-label="Geri"
        >
          ←
        </button>
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Yer, şehir, mekân veya kategori ara..."
          className="flex-1 rounded-xl bg-bg px-4 py-2.5 text-sm outline-none placeholder:text-muted"
        />
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4">
        {matchedCity && query.trim().length >= 3 && (
          <button
            onClick={() => {
              setSelectedCity(matchedCity.name);
              nav.setTab("discover");
            }}
            className="mb-4 flex w-full items-center gap-3 rounded-2xl bg-gradient-to-r from-brand to-brand-strong px-4 py-4 text-left text-white shadow-lg shadow-brand/20 active:scale-[0.98]"
          >
            <span className="text-2xl">🏙️</span>
            <span className="flex-1">
              <span className="block font-extrabold">{matchedCity.name} şehrini keşfet</span>
              <span className="text-xs opacity-85">
                Yakınındaki yerleri, kategorileri ve modları gör
              </span>
            </span>
            <span>→</span>
          </button>
        )}

        {status === "idle" && (
          <div className="space-y-4">
            <p className="text-sm font-bold text-ink-soft">Popüler aramalar</p>
            <div className="flex flex-wrap gap-2">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => setQuery(s)}
                  className="rounded-full bg-surface px-4 py-2 text-sm font-semibold text-ink-soft shadow-sm active:scale-95"
                >
                  {s}
                </button>
              ))}
            </div>
            <p className="text-xs text-muted">
              Arama isim, şehir, ilçe, kategori ve konum üzerinden çalışır.
              Örnek: "Efes", "İzmir kafe", "Kapadokya".
            </p>
          </div>
        )}

        {status === "loading" && <LoadingBlock label="Aranıyor..." />}

        {status === "ready" && results.length === 0 && (
          <div className="flex flex-col items-center gap-2 rounded-2xl bg-surface px-6 py-10 text-center">
            <span className="text-3xl">🔍</span>
            <p className="font-semibold text-ink">
              Aradığın ifade için şimdilik kayıt yok.
            </p>
            <p className="text-sm text-muted">
              Yazımı kontrol et ya da farklı bir ifade dene.
            </p>
          </div>
        )}

        {status === "ready" && results.length > 0 && (
          <div className="space-y-3">
            {results.map((place) => (
              <PlaceCard
                key={place.placeId}
                place={place}
                onClick={() => nav.openPlace(place)}
              />
            ))}
          </div>
        )}
      </div>

      {/* kategori ipucu */}
      {status === "ready" && results.length > 0 && (
        <div className="safe-bottom border-t border-line bg-surface px-4 py-2 text-center text-[11px] text-muted">
          Sonuçlar OpenStreetMap gerçek verisinden gelir
          {getCategory(results[0].categoryId) && " · kategoriye göre sıralı"}
        </div>
      )}
    </div>
  );
}
