/**
 * Paylaşılan UI primitifleri: yükleme, hata, boş durum ve offline bandı.
 * Kural: uygulama hiçbir koşulda boş beyaz ekran veya JS hatasıyla kalmaz.
 */

import type { ReactNode } from "react";
import { ApiError, OfflineError } from "../services/http";

export function LoadingBlock({ label = "Yükleniyor..." }: { label?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-12 text-muted">
      <div className="h-8 w-8 animate-spin rounded-full border-[3px] border-brand-soft border-t-brand" />
      <p className="text-sm">{label}</p>
    </div>
  );
}

export function SkeletonList({ rows = 4 }: { rows?: number }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className="flex animate-pulse items-center gap-3 rounded-2xl bg-surface p-3"
        >
          <div className="h-16 w-16 shrink-0 rounded-xl bg-line" />
          <div className="flex-1 space-y-2">
            <div className="h-4 w-3/5 rounded bg-line" />
            <div className="h-3 w-2/5 rounded bg-line" />
          </div>
        </div>
      ))}
    </div>
  );
}

interface ErrorStateProps {
  error: unknown;
  onRetry?: () => void;
  title?: string;
}

export function errorToMessage(error: unknown): string {
  if (error instanceof OfflineError) return "İnternet bağlantın yok. Bağlantın geri geldiğinde tekrar dene.";
  if (error instanceof ApiError) {
    if (error.status === 429) return "Sunucuya çok fazla istek gitti. Biraz bekleyip tekrar dene.";
    if (error.status === 502 || error.status === 504) return "Overpass sunucuları şu an yoğun. Daha sonra tekrar dene.";
    if (error.status === 406) return "Sunucu isteği reddetti. Biraz bekleyip tekrar dene.";
    if (error.status === 500) return "Proxy sunucusunda bir hata oluştu. Daha sonra tekrar dene.";
    if (error.message.includes("Failed to fetch") || error.message.includes("NetworkError"))
      return "Sunucuya ulaşılamadı. İnternet bağlantını kontrol et.";
    if (error.message.includes("Zaman aşımı")) return "Sunucu yanıt vermedi. Daha sonra tekrar dene.";
    return error.message;
  }
  if (error instanceof Error) {
    if (error.message.includes("Failed to fetch") || error.message.includes("NetworkError"))
      return "Sunucuya ulaşılamadı. İnternet bağlantını kontrol et.";
    return error.message;
  }
  return "Beklenmeyen bir hata oluştu.";
}

export function ErrorState({ error, onRetry, title = "Bir sorun oluştu" }: ErrorStateProps) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-2xl bg-surface px-6 py-10 text-center">
      <span className="text-3xl">📡</span>
      <p className="font-semibold text-ink">{title}</p>
      <p className="max-w-xs text-sm text-muted">{errorToMessage(error)}</p>
      {onRetry && (
        <button
          onClick={onRetry}
          className="mt-1 rounded-full bg-brand px-5 py-2 text-sm font-semibold text-white active:scale-95"
        >
          Tekrar dene
        </button>
      )}
    </div>
  );
}

export function EmptyState({
  emoji = "🔍",
  title,
  description,
  action,
}: {
  emoji?: string;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-2xl bg-surface px-6 py-10 text-center">
      <span className="text-3xl">{emoji}</span>
      <p className="font-semibold text-ink">{title}</p>
      {description && (
        <p className="max-w-xs text-sm text-muted">{description}</p>
      )}
      {action}
    </div>
  );
}

export function OfflineBanner({ show }: { show: boolean }) {
  if (!show) return null;
  return (
    <div className="mx-4 mt-2 flex items-center gap-2 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-800">
      <span>📴</span>
      <span>İnternet bağlantısı yok — harita ve arama çevrimiçi gerektirir.</span>
    </div>
  );
}
