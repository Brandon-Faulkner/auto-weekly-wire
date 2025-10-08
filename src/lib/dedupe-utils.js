import { DateTime } from "luxon";
import { TZ } from "../lib/utils.js";

// --- Title normalization: make “Born from Above: Bible Study” ≈ “Born from Above”
const normalizeTitle = (t = "") =>
  t
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/\s*[-–—:]\s*.*$/i, "") // drop anything after ":" or "-"
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .trim();

// Round to N-minute bucket (default 10)
const bucket = (dt, mins = 10) => {
  const m = dt.minute - (dt.minute % mins);
  return dt.set({ minute: m, second: 0, millisecond: 0 });
};

// Prefer the location that looks more specific (has a room or is simply longer)
const isMoreSpecificLocation = (a = "", b = "") => {
  const ra = /(room|rm|suite|#)\s*\w+/i.test(a);
  const rb = /(room|rm|suite|#)\s*\w+/i.test(b);
  if (ra !== rb) return ra;
  return (a || "").length > (b || "").length;
};

// Prefer ChurchCenter/registration URLs when merging
const pickUrl = (a, b) => {
  const pri = (u) => /churchcenter\.com|registrations/.test(u || "");
  if (pri(a) && !pri(b)) return a;
  if (!pri(a) && pri(b)) return b;
  return a || b || null;
};

// Merge two events believed to be the same instance
const mergeEvents = (a, b) => {
  const aStart = DateTime.fromISO(a.start, { zone: TZ });
  const bStart = DateTime.fromISO(b.start, { zone: TZ });
  const aEnd = a.end ? DateTime.fromISO(a.end, { zone: TZ }) : aStart;
  const bEnd = b.end ? DateTime.fromISO(b.end, { zone: TZ }) : bStart;

  const start = (aStart < bStart ? aStart : bStart).toISO();
  const end = (aEnd > bEnd ? aEnd : bEnd).toISO();

  const location = isMoreSpecificLocation(a.location, b.location)
    ? a.location
    : b.location;

  return {
    id: a.id || b.id || null,
    title: (a.title || "").length >= (b.title || "").length ? a.title : b.title,
    start,
    end,
    location,
    url: pickUrl(a.url, b.url),
  };
};

/**
 * De-dupe events:
 * - Pass 1: exact by UID (keeps first)
 * - Pass 2: near-dupe by (normalizedTitle + time bucket), ignoring location
 * Options:
 *   windowMins: rounding window for time bucket (default 10)
 *   includeLocationInKey: set true to be stricter (default false)
 */
export function dedupeEvents(
  list,
  { windowMins = 10, includeLocationInKey = false } = {}
) {
  if (!Array.isArray(list) || list.length === 0) return [];

  // Pass 1 — exact UID
  const byUid = new Map();
  const withoutUid = [];
  for (const e of list) {
    if (e.id) {
      if (!byUid.has(e.id)) byUid.set(e.id, e);
    } else {
      withoutUid.push(e);
    }
  }
  const pass1 = [...byUid.values(), ...withoutUid];

  // Pass 2 — near-dupes
  const map = new Map();
  for (const e of pass1) {
    const start = DateTime.fromISO(e.start, { zone: TZ });
    if (!start.isValid) continue;

    const titleKey = normalizeTitle(e.title);
    const center = bucket(start, windowMins);
    const neighbors = [
      center.toISO(),
      center.minus({ minutes: windowMins }).toISO(),
      center.plus({ minutes: windowMins }).toISO(),
    ];

    let merged = false;
    for (const tb of neighbors) {
      let key = `${titleKey}|${tb}`;
      if (includeLocationInKey) {
        const locKey = (e.location || "")
          .toLowerCase()
          .replace(/\\[n,]/g, " ")
          .replace(/\s+/g, " ")
          .trim();
        key += `|${locKey}`;
      }
      if (map.has(key)) {
        map.set(key, mergeEvents(map.get(key), e));
        merged = true;
        break;
      }
    }
    if (!merged) {
      const primaryKey = `${titleKey}|${center.toISO()}`;
      map.set(primaryKey, e);
    }
  }

  return [...map.values()].sort(
    (a, b) => new Date(a.start).getTime() - new Date(b.start).getTime()
  );
}
