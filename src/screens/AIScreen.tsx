/**
 * AI keşif sohbeti.
 *
 * Mimari not: Bu ekran tek bir chat arayüzüdür ama altındaki AIService
 * modülerdir (services/ai). İleride kişiselleştirilmiş öneriler, gezi
 * planlama, mekân karşılaştırma vb. yeni "beceriler" aynı provider
 * arayüzü üzerinden bu sohbete bağlanabilir.
 *
 * AI uydurma yapamaz: öneriler yalnızca gerçek OSM mekânlarından gelir
 * ve Place ID ile ilişkilidir → detaya geçiş + BURAYA NASIL GİDERİM.
 */

import { useEffect, useRef, useState } from "react";
import { useNavigation } from "../app/navigation";
import { useAppState } from "../app/state";
import { createAIProvider, AIUnavailableError } from "../services/ai";
import type { Place } from "../models/types";
import { PlaceCard } from "../components/PlaceCard";
import * as storage from "../services/storage";
import { toRef } from "../services/osm";

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  places?: Place[];
  engine?: string;
}

const SUGGESTIONS = [
  "İstanbul'da sakin bir yer",
  "Yakınımda kahve içebileceğim bir yer",
  "Ucuz bir gün geçirmek istiyorum",
  "Tarihi yerler gezmek istiyorum",
  "2 saatim var, ne yapabilirim?",
];

function uid() {
  return `m_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

export function AIScreen() {
  const nav = useNavigation();
  const { location, selectedCity } = useAppState();
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: uid(),
      role: "assistant",
      text: 'Merhaba! Nereye gitmek istediğine birlikte karar verelim. Bana nasıl bir yer aradığını yaz — örneğin "İstanbul\'da sakin ve ekonomik bir yer". Önerilerim yalnızca gerçek mekân verisinden gelir, asla uydurma bilgi vermem.',
      engine: "local-osm-engine",
    },
  ]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [addedLists, setAddedLists] = useState<Record<string, string>>({});
  const listRef = useRef<HTMLDivElement | null>(null);
  const providerRef = useRef<ReturnType<typeof createAIProvider> | null>(null);
  if (!providerRef.current) providerRef.current = createAIProvider();

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages, busy]);

  const addAllToList = (messageId: string, places: Place[]) => {
    if (places.length === 0) return;
    const list = storage.createTripList(`AI Önerisi · ${places[0].city ?? "Keşif"}`);
    for (const p of places) storage.addPlaceToList(list.id, toRef(p));
    setAddedLists((prev) => ({ ...prev, [messageId]: list.id }));
  };

  const send = async (text: string) => {
    const q = text.trim();
    if (!q || busy) return;
    setInput("");
    setMessages((prev) => [...prev, { id: uid(), role: "user", text: q }]);
    setBusy(true);

    try {
      const res = await providerRef.current!.recommend({
        query: q,
        context: {
          userCoords:
            location.status === "granted"
              ? { lat: location.coords.lat, lon: location.coords.lon }
              : undefined,
          userCity:
            location.status === "granted" ? location.city : undefined,
          selectedCity,
        },
        history: messages.slice(-20).map((m) => ({ role: m.role, text: m.text })),
      });
      setMessages((prev) => [
        ...prev,
        {
          id: uid(),
          role: "assistant",
          text: res.text,
          places: res.places,
          engine: res.engine,
        },
      ]);
    } catch (err) {
      const msg =
        err instanceof AIUnavailableError
          ? "AI şu anda cevap veremedi. Bağlantını kontrol edip tekrar dener misin?"
          : "AI şu anda cevap veremedi. Birazdan tekrar dene.";
      setMessages((prev) => [...prev, { id: uid(), role: "assistant", text: msg }]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="sunset-background flex h-screen flex-col pb-20">
      <header className="safe-top border-b border-line bg-surface px-4 py-3">
        <p className="text-lg font-extrabold text-ink">🤖 AI Keşif Asistanı</p>
        <p className="text-xs text-muted">
          Gerçek mekân verisiyle önerir · uydurma bilgi yok
        </p>
      </header>

      <div ref={listRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
        {messages.map((m) => (
          <div key={m.id}>
            <div
              className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-relaxed whitespace-pre-line ${
                m.role === "user"
                  ? "ml-auto bg-brand text-white"
                  : "bg-surface text-ink-soft shadow-sm"
              }`}
            >
              {m.text}
            </div>
            {m.places && m.places.length > 0 && (
              <div className="mt-2 space-y-2">
                {m.places.map((p) => (
                  <PlaceCard
                    key={p.placeId}
                    place={p}
                    onClick={() => nav.openPlace(p)}
                    onNavigate={() => nav.openPlace(p)}
                  />
                ))}
                {addedLists[m.id] ? (
                  <div className="rounded-2xl bg-brand-fog px-4 py-3 text-center text-sm font-semibold text-brand-strong">
                    ✅ Gezi listesine eklendi — Profil'den yönetebilirsin
                  </div>
                ) : (
                  <button
                    onClick={() => addAllToList(m.id, m.places!)}
                    className="w-full rounded-2xl border-2 border-brand bg-surface py-3 text-sm font-bold text-brand-strong active:scale-[0.98]"
                  >
                    📋 Önerilen {m.places.length} yeri gezi listesine ekle
                  </button>
                )}
                <p className="text-[11px] text-muted">
                  Öneriler gerçek OpenStreetMap verisinden gelir · detay için karta dokun
                </p>
              </div>
            )}
          </div>
        ))}

        {busy && (
          <div className="flex max-w-[85%] items-center gap-2 rounded-2xl bg-surface px-4 py-3 text-sm text-muted shadow-sm">
            <span className="h-2 w-2 animate-bounce rounded-full bg-brand" />
            <span className="h-2 w-2 animate-bounce rounded-full bg-brand [animation-delay:120ms]" />
            <span className="h-2 w-2 animate-bounce rounded-full bg-brand [animation-delay:240ms]" />
            Gerçek mekânlar aranıyor...
          </div>
        )}
      </div>

      {/* Öneri çipleri */}
      <div className="no-scrollbar flex gap-2 overflow-x-auto px-4 pb-2">
        {SUGGESTIONS.map((s) => (
          <button
            key={s}
            onClick={() => send(s)}
            disabled={busy}
            className="shrink-0 rounded-full bg-surface px-3.5 py-2 text-xs font-semibold text-ink-soft shadow-sm active:scale-95 disabled:opacity-50"
          >
            {s}
          </button>
        ))}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
        className="safe-bottom flex items-center gap-2 border-t border-line bg-surface px-3 py-3"
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Nasıl bir yer arıyorsun?"
          className="flex-1 rounded-xl bg-bg px-4 py-2.5 text-sm outline-none placeholder:text-muted"
        />
        <button
          type="submit"
          disabled={busy || !input.trim()}
          className="rounded-xl bg-brand px-4 py-2.5 text-sm font-bold text-white active:scale-95 disabled:opacity-40"
        >
          Gönder
        </button>
      </form>
    </div>
  );
}
