/**
 * Shared plumbing for providers that read a website's public HTML instead of an API.
 * Requests are throttled and bot-protection pages are reported clearly instead of being parsed.
 */
import { parse, type HTMLElement } from 'node-html-parser';

const HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  Accept: 'text/html,application/xhtml+xml',
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Be polite: at most ~2 requests per second across all HTML sources.
const MIN_GAP = 500;
let nextSlot = 0;
async function throttle() {
  const now = Date.now();
  const start = Math.max(now, nextSlot);
  nextSlot = start + MIN_GAP;
  if (start > now) await sleep(start - now);
}

export async function getHtmlText(url: string, siteName: string, attempt = 0): Promise<string> {
  await throttle();
  let res: Response;
  try {
    res = await fetch(url, { headers: HEADERS });
  } catch {
    throw new Error('Network error — check your internet connection.');
  }
  if ((res.status === 429 || res.status >= 500) && attempt < 2) {
    await sleep(1500 * (attempt + 1));
    return getHtmlText(url, siteName, attempt + 1);
  }
  if (res.status === 404) throw new Error(`Not found on ${siteName}.`);
  if (res.status === 403 || res.status === 503) {
    throw new Error(`${siteName} blocked the request (bot protection). Try again later or switch source.`);
  }
  if (!res.ok) throw new Error(`${siteName} request failed (${res.status})`);
  const body = await res.text();
  if (/<title>\s*Just a moment/i.test(body)) {
    throw new Error(`${siteName} is showing a bot check. Try again later or switch source.`);
  }
  return body;
}

export async function getHtml(url: string, siteName: string): Promise<HTMLElement> {
  return parse(await getHtmlText(url, siteName));
}

export const text = (el: HTMLElement | null | undefined) => (el ? el.text.replace(/\s+/g, ' ').trim() : '');

export function imgUrl(img: HTMLElement | null | undefined): string {
  if (!img) return '';
  const raw =
    img.getAttribute('data-src') ||
    img.getAttribute('data-lazy-src') ||
    img.getAttribute('src') ||
    (img.getAttribute('srcset') ?? '').split(/\s+/)[0] ||
    '';
  const url = raw.trim();
  if (!url || url.startsWith('data:')) return '';
  return url.startsWith('//') ? `https:${url}` : url;
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/**
 * Reads dates written like "Nov. 5, 2026, 3:38 a.m.", "July 15, 2026, 5:31 p.m." or "Nov 5, 2026" (as UTC).
 * Returns null when the text is not that form. (Date.parse cannot be trusted for these on every JS engine.)
 */
export function parseSiteDate(raw: string): string | null {
  const m = raw.match(/([A-Za-z]{3,9})\.?\s+(\d{1,2}),\s+(\d{4})(?:,\s+(\d{1,2})(?::(\d{2}))?\s*([ap])\.?m\.?)?/i);
  if (!m) return null;
  const month = MONTHS.indexOf(m[1].slice(0, 3).toLowerCase());
  if (month < 0) return null;
  let hour = m[4] ? Number(m[4]) % 12 : 0;
  if (m[6] && m[6].toLowerCase() === 'p') hour += 12;
  return new Date(Date.UTC(Number(m[3]), month, Number(m[2]), hour, Number(m[5] ?? 0))).toISOString();
}

/** "5 mins ago" / "2 days ago" / "March 3, 2024" -> ISO string (falls back to now). */
export function parseReleaseDate(raw: string): string {
  const s = raw.trim().toLowerCase();
  const rel = s.match(/(\d+)\s*(sec|min|hour|day|week|month|year)/);
  if (rel) {
    const unit: Record<string, number> = { sec: 1e3, min: 6e4, hour: 36e5, day: 864e5, week: 6048e5, month: 2592e6, year: 31536e6 };
    return new Date(Date.now() - Number(rel[1]) * unit[rel[2]]).toISOString();
  }
  if (s.includes('yesterday')) return new Date(Date.now() - 864e5).toISOString();
  const t = Date.parse(raw);
  return Number.isNaN(t) ? new Date().toISOString() : new Date(t).toISOString();
}
