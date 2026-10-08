import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createHash } from "node:crypto";

const MIRRORS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
  "https://overpass.osm.jp/api/interpreter",
];

const MIRROR_TIMEOUT_MS = 4000; // sert sınır: 4 sn'de cevap yoksa sonraki mirror
const RETRY_ROUNDS = 1; // bütçe 8 sn'i aşmaması için tek tur; rotasyon yeterli
const TOTAL_BUDGET_MS = 7500; // Vercel 10 sn limiti + ağ gecikmesi payı
const CACHE_TTL_MS = 60 * 60 * 1000;
const MAX_CACHE_ENTRIES = 200;

export const maxDuration = 15;

interface CacheEntry {
  body: string;
  expiry: number;
}

const cache = new Map<string, CacheEntry>();

function hashKey(query: string): string {
  return createHash("sha256").update(query).digest("hex").slice(0, 16);
}

function setCache(key: string, body: string) {
  if (cache.size >= MAX_CACHE_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest) cache.delete(oldest);
  }
  cache.set(key, { body, expiry: Date.now() + CACHE_TTL_MS });
}

function getCache(key: string): string | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (entry.expiry < Date.now()) {
    cache.delete(key);
    return null;
  }
  return entry.body;
}

function setCacheHeaders(res: VercelResponse) {
  res.setHeader("Cache-Control", "public, max-age=3600, s-maxage=3600");
}

async function fetchMirror(
  query: string,
  url: string,
  signal: AbortSignal,
): Promise<Response> {
  return fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
      "User-Agent": "NereyeGitsem/1.3.2 (Vercel Proxy)",
    },
    body: "data=" + encodeURIComponent(query),
    signal,
  });
}

interface MirrorResult {
  body: string;
  ok: boolean;
  lastStatus: number;
  errors: string[];
}

async function tryMirrors(query: string): Promise<MirrorResult> {
  const errors: string[] = [];
  let lastStatus = 0;
  const deadline = Date.now() + TOTAL_BUDGET_MS;

  for (let round = 0; round < RETRY_ROUNDS; round++) {
    for (const url of MIRRORS) {
      if (Date.now() > deadline) {
        errors.push("total time budget exhausted");
        return { body: "", ok: false, lastStatus, errors };
      }
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), MIRROR_TIMEOUT_MS);
      try {
        const res = await fetchMirror(query, url, controller.signal);
        lastStatus = res.status;
        const text = await res.text();
        if (res.ok) {
          try {
            JSON.parse(text);
            return { body: text, ok: true, lastStatus, errors };
          } catch {
            errors.push(`${url}: invalid JSON response`);
          }
        } else {
          errors.push(`${url}: HTTP ${res.status}`);
        }
      } catch (err) {
        errors.push(
          `${url}: ${err instanceof Error ? err.message : String(err)}`,
        );
      } finally {
        clearTimeout(timer);
      }
    }
  }

  return { body: "", ok: false, lastStatus, errors };
}

export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
) {
  res.setHeader("Access-Control-Allow-Credentials", "true");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader(
    "Access-Control-Allow-Methods",
    "GET,OPTIONS,PATCH,DELETE,POST,PUT",
  );
  res.setHeader(
    "Access-Control-Allow-Headers",
    "X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version",
  );

  if (req.method === "OPTIONS") {
    res.status(200).end();
    return;
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { query } = (req.body as { query?: unknown }) || {};
  if (!query || typeof query !== "string") {
    return res.status(400).json({ error: "Query parameter is missing" });
  }

  const key = hashKey(query);
  const cached = getCache(key);
  if (cached) {
    setCacheHeaders(res);
    return res.status(200).send(cached);
  }

  const result = await tryMirrors(query);
  if (result.ok) {
    setCache(key, result.body);
    setCacheHeaders(res);
    return res.status(200).send(result.body);
  }

  return res.status(502).json({
    error: "All Overpass mirrors failed",
    status: result.lastStatus,
    details: result.errors,
  });
}
