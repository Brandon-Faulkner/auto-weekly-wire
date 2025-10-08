import axios from "axios";
import { DateTime } from "luxon";
import { TZ } from "../lib/utils.js";
import { dedupeEvents } from "../lib/dedupe-utils.js";

// Unfold folded lines per RFC 5545 (join CRLF + space/tab)
const unfold = (txt) => txt.replace(/\r?\n[ \t]/g, "");

// Grab a VEVENT property, capturing optional params (e.g., ;TZID=...;VALUE=DATE)
function getProp(block, key) {
  const re = new RegExp(`^${key}(;[^:\\r\\n]+)?:([^\\r\\n]+)`, "m");
  const m = block.match(re);
  if (!m) return null;
  const paramsStr = m[1] || "";
  const value = m[2].trim();
  const params = Object.fromEntries(
    paramsStr
      .split(";")
      .filter(Boolean)
      .map((p) => {
        const [k, v] = p.split("=");
        return [k?.toUpperCase(), v];
      })
  );
  return { value, params };
}

// Parse DTSTART/DTEND with support for TZID, Zulu, date-only (VALUE=DATE), and no-seconds
function parseIcsDate(prop, fallbackZone = TZ) {
  if (!prop) return null;
  const { value, params } = prop;
  const tzid = params?.TZID;
  const isDateOnly = params?.VALUE === "DATE" || /^\d{8}$/.test(value);
  const zoneToUse = tzid || fallbackZone;

  if (isDateOnly) {
    const d = DateTime.fromFormat(value, "yyyyLLdd", { zone: zoneToUse });
    return d.isValid ? d.toISO() : null;
  }

  // Date-time variants: yyyyMMddTHHmmss[Z]? or yyyyMMddTHHmm[Z]?
  const zulu = value.endsWith("Z");
  const base = value.replace("Z", "");

  let dt =
    (base.length === 15 &&
      DateTime.fromFormat(base, "yyyyLLdd'T'HHmmss", {
        zone: zulu ? "utc" : zoneToUse,
      })) ||
    (base.length === 13 &&
      DateTime.fromFormat(base, "yyyyLLdd'T'HHmm", {
        zone: zulu ? "utc" : zoneToUse,
      }));

  if (!dt || !dt.isValid) return null;

  if (zulu) dt = dt.setZone("utc");

  return dt.setZone(fallbackZone).toISO();
}
// Map ICS weekday to Luxon (1=Mon..7=Sun)
const BYDAY_MAP = { MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6, SU: 7 };

function parseRRule(rruleStr = "") {
  // "FREQ=WEEKLY;BYDAY=WE;INTERVAL=1;UNTIL=20251231T235959Z;COUNT=10"
  const parts = Object.fromEntries(
    rruleStr.split(";").map((s) => {
      const [k, v] = s.split("=");
      return [(k || "").toUpperCase(), v];
    })
  );
  return {
    freq: parts.FREQ || "",
    interval: parts.INTERVAL ? parseInt(parts.INTERVAL, 10) : 1,
    byday: (parts.BYDAY || "").split(",").filter(Boolean),
    untilRaw: parts.UNTIL || null,
    count: parts.COUNT ? parseInt(parts.COUNT, 10) : null,
  };
}

// parse comma-separated EXDATE/RDATE lines (with optional TZID or VALUE=DATE)
// returns Set of ISO strings (date-only normalized to 00:00 in TZ)
function parseDateListProp(block, key, fallbackZone) {
  const all = [];
  const re = new RegExp(`^${key}(;[^:\\r\\n]+)?:([^\\r\\n]+)`, "gm");
  let m;
  while ((m = re.exec(block))) {
    const paramsStr = m[1] || "";
    const value = m[2].trim();
    const params = Object.fromEntries(
      paramsStr
        .split(";")
        .filter(Boolean)
        .map((p) => {
          const [k, v] = p.split("=");
          return [k?.toUpperCase(), v];
        })
    );
    for (const piece of value.split(",")) {
      const iso = parseIcsDate({ value: piece, params }, fallbackZone);
      if (iso) all.push(iso);
    }
  }
  return new Set(all);
}

// find the first date on or after 'from' that matches weekday 'targetDow'
function firstOnOrAfter(from, targetDow) {
  const delta = (targetDow + 7 - from.weekday) % 7;
  return from.plus({ days: delta });
}

function expandWeekly({
  seedStartISO,
  seedEndISO,
  rrule,
  exdates,
  rdates,
  windowStart,
  windowEnd,
  tz = TZ,
}) {
  const out = [];

  const seedStart = DateTime.fromISO(seedStartISO, { zone: tz });
  const seedEnd = seedEndISO
    ? DateTime.fromISO(seedEndISO, { zone: tz })
    : seedStart;
  if (!seedStart.isValid) return out;

  const duration = seedEnd.diff(seedStart); // keep same duration for instances

  // determine UNTIL
  let until = null;
  if (rrule.untilRaw) {
    const untilIso = parseIcsDate({ value: rrule.untilRaw, params: {} }, tz);
    if (untilIso) until = DateTime.fromISO(untilIso, { zone: tz });
  }
  const hardEnd = until ? DateTime.min(windowEnd, until) : windowEnd;

  const bydays =
    rrule.byday.length > 0
      ? rrule.byday
      : [Object.keys(BYDAY_MAP)[seedStart.weekday - 1]];

  // 1) Generate occurrences from RRULE
  for (const by of bydays) {
    const targetDow = BYDAY_MAP[by];
    if (!targetDow) continue;

    // anchor: first occurrence on/after windowStart, aligned by INTERVAL from seed
    // Step A: find the calendar week-aligned first candidate on/after windowStart
    let first = firstOnOrAfter(windowStart.startOf("day"), targetDow).set({
      hour: seedStart.hour,
      minute: seedStart.minute,
      second: seedStart.second,
      millisecond: seedStart.millisecond,
    });

    // Step B: shift 'first' forward so it's congruent with the seed's week modulo INTERVAL
    // Compute number of weeks between seedStart and candidate; advance until (weeks % interval === 0)
    let weeksBetween = Math.floor(
      first.diff(seedStart.startOf("week"), "weeks").weeks
    );
    while (
      ((weeksBetween % rrule.interval) + rrule.interval) % rrule.interval !==
      0
    ) {
      first = first.plus({ weeks: 1 });
      weeksBetween += 1;
    }

    // iterate
    let n = 0;
    for (
      let dt = first;
      dt <= hardEnd;
      dt = dt.plus({ weeks: rrule.interval })
    ) {
      if (rrule.count && n >= rrule.count) break;

      const start = dt;
      const end = dt.plus(duration);

      // skip past-window and EXDATEs
      const startIso = start.toISO();
      if (start < windowStart) continue;
      if (exdates.has(startIso)) continue;

      out.push({ start: startIso, end: end.toISO() });
      n += 1;
    }
  }

  // 2) Add any RDATEs within window (explicit extra dates)
  for (const r of rdates) {
    const rdt = DateTime.fromISO(r, { zone: tz });
    if (!rdt.isValid) continue;
    if (rdt < windowStart || rdt > windowEnd) continue;
    const end = rdt.plus(duration);
    if (!exdates.has(r)) {
      out.push({ start: rdt.toISO(), end: end.toISO() });
    }
  }

  // de-dupe the produced list by start
  const seen = new Set();
  const uniq = [];
  for (const o of out) {
    if (seen.has(o.start)) continue;
    seen.add(o.start);
    uniq.push(o);
  }

  return uniq.sort((a, b) => new Date(a.start) - new Date(b.start));
}

export async function fetchCalendarEvents({ icalUrl, days = 14 }) {
  if (!icalUrl) return [];

  const { data: raw } = await axios.get(icalUrl, {
    responseType: "text",
    timeout: 10000,
  });

  const text = unfold(raw);

  // Extract VEVENT blocks safely
  const veventRe = /BEGIN:VEVENT([\s\S]*?)END:VEVENT/g;
  const blocks = [];
  let m;
  while ((m = veventRe.exec(text))) blocks.push(m[1]);

  const now = DateTime.now().setZone(TZ);
  const windowEnd = now.plus({ days });

  const items = [];
  for (const b of blocks) {
    const summary = getProp(b, "SUMMARY")?.value || "";
    if (!summary) continue;

    const dtstartProp = getProp(b, "DTSTART");
    const dtendProp = getProp(b, "DTEND") || dtstartProp;

    const startISO = parseIcsDate(dtstartProp);
    const endISO = parseIcsDate(dtendProp);

    // window bounds you already compute
    const now = DateTime.now().setZone(TZ);
    const windowEnd = now.plus({ days });
    const windowStart = now; // or start of day if you prefer: now.startOf("day")

    const rruleStr = getProp(b, "RRULE")?.value || "";
    const exdates = parseDateListProp(b, "EXDATE", TZ);
    const rdates = parseDateListProp(b, "RDATE", TZ);

    const base = {
      id: getProp(b, "UID")?.value?.trim() || null,
      title: summary,
      location: getProp(b, "LOCATION")?.value || "Cana Campus",
      url: getProp(b, "URL")?.value || null,
    };

    // If it's a weekly recurrence master, expand it; otherwise treat as single
    if (rruleStr && /^FREQ=WEEKLY(;|$)/i.test(rruleStr)) {
      const rrule = parseRRule(rruleStr);

      // Expand into concrete instances inside your window
      const inst = expandWeekly({
        seedStartISO: startISO,
        seedEndISO: endISO,
        rrule,
        exdates,
        rdates,
        windowStart,
        windowEnd,
        tz: TZ,
      });

      for (const o of inst) {
        // build a synthetic id to keep instances distinct (UID + occurrence start)
        items.push({
          ...base,
          id: base.id ? `${base.id}#${o.start}` : null,
          start: o.start,
          end: o.end,
        });
      }
    } else {
      // Non-recurring (or non-weekly) handling as before
      if (!startISO) continue;
      const start = DateTime.fromISO(startISO, { zone: TZ });
      if (start < windowStart || start > windowEnd) {
        // still allow if this block is a standalone future instance with RECURRENCE-ID
        // (Planning Center often emits explicit instances; this keeps them)
        // If you want strictly within window only, keep the continue.
        continue;
      }
      items.push({
        ...base,
        start: start.toISO(),
        end: endISO ? DateTime.fromISO(endISO, { zone: TZ }).toISO() : null,
      });
    }
  }

  items.sort((a, b) => DateTime.fromISO(a.start) - DateTime.fromISO(b.start));
  const deduped = dedupeEvents(items, {
    windowMins: 10,
    includeLocationInKey: false,
  });
  return deduped.slice(0, 8);
}
