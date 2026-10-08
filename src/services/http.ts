/**
 * Ağ katmanı: timeout, çevrimdışı algılama ve hata sınıflandırması.
 * Her hata kullanıcıya düzgün bir durum ekranıyla yansıtılır; uygulama
 * hiçbir koşulda boş beyaz ekran veya JS hatasıyla kalmaz.
 */

export class OfflineError extends Error {
  constructor() {
    super("İnternet bağlantısı yok.");
    this.name = "OfflineError";
  }
}

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export function isOffline(): boolean {
  return typeof navigator !== "undefined" && navigator.onLine === false;
}

export async function fetchJSON<T>(
  url: string,
  opts: {
    timeoutMs?: number;
    method?: string;
    body?: string;
    headers?: Record<string, string>;
  } = {},
): Promise<T> {
  if (isOffline()) throw new OfflineError();

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    opts.timeoutMs ?? 15000,
  );

  try {
    const res = await fetch(url, {
      method: opts.method ?? "GET",
      body: opts.body,
      signal: controller.signal,
      headers: opts.headers,
    });
    if (!res.ok) {
      const bodyText = await res.text();
      throw new ApiError(
        `HTTP ${res.status}: ${bodyText.slice(0, 120)}`,
        res.status,
      );
    }
    return (await res.json()) as T;
  } catch (err) {
    if (err instanceof ApiError) throw err;
    if (isOffline()) throw new OfflineError();
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new ApiError("Zaman aşımı");
    }
    throw new ApiError(err instanceof Error ? err.message : "Ağ hatası");
  } finally {
    clearTimeout(timeout);
  }
}

/** URL query parametresi (UTF-8 güvenli). */
export function qs(params: Record<string, string | number | undefined>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== "") sp.set(k, String(v));
  }
  return sp.toString();
}
