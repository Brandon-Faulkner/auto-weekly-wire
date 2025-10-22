import axios from "axios";
import { DateTime } from "luxon";
import { getTemplateGoals } from "./mailchimp.js";

// Get the current financial stats from PCO
export async function fetchPcoFinancialStats({ patId, patSecret }) {
  if (!patId || !patSecret) return [];

  const auth = Buffer.from(`${patId}:${patSecret}`).toString("base64");
  const base = "https://api.planningcenteronline.com/giving/v2";
  const headers = {
    Authorization: `Basic ${auth}`,
    Accept: "application/json",
  };

  const start = DateTime.local().startOf("month").toISODate();
  const end = DateTime.local().plus({ months: 1 }).startOf("month").toISODate();

  const getAll = async (url) => {
    let out = [];
    while (url) {
      const res = await axios.get(url, { headers, timeout: 15000 });
      out = out.concat(res.data?.data ?? []);
      url = res.data?.links?.next || null;
    }
    return out;
  };

  try {
    // 1) Get donations received this month and giving goal concurrently
    const donationsPromise = getAll(
      `${base}/donations?where[received_at][gte]=${start}&where[received_at][lt]=${end}&per_page=100`
    );
    const goalsPromise = getTemplateGoals();
    const [donations, goals] = await Promise.all([
      donationsPromise,
      goalsPromise,
    ]);

    const {
      giving_goal: givingGoal,
      total_gifts_goal: totalGiftsGoal,
      new_givers_goal: newGiversGoal,
      unique_givers_goal: uniqueGiversGoal,
    } = goals;

    const totalGifts = donations.length;

    const giftsReceivedCents = donations.reduce(
      (sum, d) => sum + (d?.attributes?.amount_cents ?? 0),
      0
    );
    const giftsReceived = +(giftsReceivedCents / 100).toFixed(2);

    const personIds = [
      ...new Set(
        donations.map((d) => d?.relationships?.person?.data?.id).filter(Boolean)
      ),
    ];
    const uniqueGivers = personIds.length;

    // 2) New givers = people with NO donation before month start
    const hasPriorDonation = async (personId) => {
      const url = `${base}/people/${personId}/donations?where[received_at][lt]=${start}&per_page=1&order=-received_at`;
      const res = await axios.get(url, { headers, timeout: 15000 });
      return (res.data?.data?.length ?? 0) > 0;
    };

    let newGivers = 0;
    const pool = 5; // small concurrency to be kind to the API
    for (let i = 0; i < personIds.length; i += pool) {
      const chunk = personIds.slice(i, i + pool);
      const checks = await Promise.all(
        chunk.map((id) => hasPriorDonation(id).catch(() => true))
      );
      newGivers += checks.filter((hadPrior) => !hadPrior).length;
    }

    return {
      giftsReceived,
      totalGifts,
      newGivers,
      uniqueGivers,
      givingGoal,
      totalGiftsGoal,
      newGiversGoal,
      uniqueGiversGoal,
    };
  } catch (err) {
    console.error("PCO Giving stats error:", err?.message || err);
    return {
      giftsReceived: 0,
      totalGifts: 0,
      newGivers: 0,
      uniqueGivers: 0,
      givingGoal: 0,
      totalGiftsGoal: 0,
      newGiversGoal: 0,
      uniqueGiversGoal: 0,
    };
  }
}

// Get the current open registrations from PCO
export async function fetchPcoOpenRegistrations({ patId, patSecret }) {
  if (!patId || !patSecret) return [];

  const auth = Buffer.from(`${patId}:${patSecret}`).toString("base64");
  const base = "https://api.planningcenteronline.com/registrations/v2";

  const params = new URLSearchParams({
    filter: "unarchived",
    include: "next_signup_time,signup_times",
  });

  const res = await axios.get(`${base}/signups?${params.toString()}`, {
    headers: {
      Authorization: `Basic ${auth}`,
      Accept: "application/vnd.api+json",
    },
    timeout: 10000,
  });

  const signups = res.data?.data ?? [];
  const included = res.data?.included ?? [];

  const byTypeId = new Map();
  for (const inc of included) {
    byTypeId.set(`${inc.type}:${inc.id}`, inc);
  }
  const getIncluded = (type, id) => byTypeId.get(`${type}:${id}`);

  const now = new Date();

  const events = signups
    .map((s) => {
      const a = s.attributes || {};
      const rel = s.relationships || {};

      // 1) Try next_signup_time
      let startsAt = null;
      const nextRef = rel.next_signup_time?.data;
      if (nextRef) {
        const next = getIncluded(nextRef.type, nextRef.id);
        startsAt = next?.attributes?.starts_at || null;
      }

      // 2) Fallback to earliest of signup_times
      if (!startsAt) {
        const timeRefs = rel.signup_times?.data || [];
        const times = timeRefs
          .map((r) => getIncluded(r.type, r.id))
          .filter(Boolean)
          .map((t) => t.attributes?.starts_at)
          .filter(Boolean)
          .sort();
        startsAt = times[0] || null;
      }

      // 3) Last resort fallback
      if (!startsAt) startsAt = a.open_at || null;

      // 4) Compute "is open right now" from open/close window
      const openAt = a.open_at ? new Date(a.open_at) : null;
      const closeAt = a.close_at ? new Date(a.close_at) : null;

      const isOpenNow =
        // must have at least one of openAt or closeAt
        (openAt || closeAt) &&
        // if open_at is set, it must be <= now; if not set, treat as not scheduled (assume OK)
        (!openAt || openAt <= now) &&
        // if close_at is set, it must be > now
        (!closeAt || closeAt > now);

      // Find the next future occurrence (prefer next_signup_time, else scan signup_times)
      const nowTs = Date.now();
      let nextFutureISO = null;
      {
        const nextRef = rel.next_signup_time?.data
          ? getIncluded(
              rel.next_signup_time.data.type,
              rel.next_signup_time.data.id
            )
          : null;
        const nextStarts = nextRef?.attributes?.starts_at
          ? new Date(nextRef.attributes.starts_at).getTime()
          : null;

        const allTimes = (rel.signup_times?.data || [])
          .map((r) => getIncluded(r.type, r.id))
          .filter(Boolean)
          .map((t) => t.attributes?.starts_at)
          .filter(Boolean)
          .map((iso) => new Date(iso).getTime())
          .sort((a, b) => a - b);

        const firstFuture =
          Number.isFinite(nextStarts) && nextStarts > nowTs
            ? nextStarts
            : allTimes.find((ts) => ts > nowTs) ?? null;

        if (firstFuture) nextFutureISO = new Date(firstFuture).toISOString();
      }

      // Ongoing if it's open now but there are no future occurrences
      const isOngoing = isOpenNow && !nextFutureISO;

      // Use this for rendering (hide when ongoing)
      const display_starts_at = isOngoing ? null : nextFutureISO || startsAt;

      return {
        id: s.id,
        title: a.name,
        starts_at: startsAt, // raw ISO (UTC)
        isOngoing,
        display_starts_at,
        url: a.new_registration_url?.split("/reservations/new")[0] || null,
        description_html: a.description || null,
        logo_url: a.logo_url || null,
        is_open_now: isOpenNow,
      };
    })
    // Require: has a start, has a URL, has a logo IRL, and is open now
    .filter((e) => e.starts_at && e.url && e.logo_url && e.is_open_now)
    // Remove ongoing registrations for now
    .filter((e) => !e.isOngoing)
    // Sort by display_start_time, putting ongoing events at bottom
    .sort((a, b) => {
      const aTime = a.display_starts_at
        ? new Date(a.display_starts_at).getTime()
        : Infinity;
      const bTime = b.display_starts_at
        ? new Date(b.display_starts_at).getTime()
        : Infinity;
      return aTime - bTime;
    })
    .map(({ is_open_now, ...rest }) => rest);

  return events;
}

// Get the most recent Sunday plan's sermon outline from PCO plan item
export async function fetchPcoMessageOutline({
  patId,
  patSecret,
  serviceTypeId = "884831",
}) {
  if (!patId || !patSecret) return [];

  const auth = Buffer.from(`${patId}:${patSecret}`).toString("base64");
  const api = axios.create({
    baseURL: "https://api.planningcenteronline.com/services/v2",
    headers: {
      Authorization: `Basic ${auth}`,
      Accept: "application/vnd.api+json",
    },
    timeout: 15000,
  });

  // 1) Get plans for this service type, sorted newest-first
  // We’ll request a page and then pick the most recent plan whose sort_date is in the past.
  // (Relying on order=-sort_date is robust; if your org has only Sundays, the top past plan will be last Sunday.)
  const perPage = 25;
  const plansURL = `/service_types/${serviceTypeId}/plans?order=-sort_date&per_page=${perPage}`;

  const plansRes = await api.get(plansURL);
  const plans = plansRes.data?.data ?? [];

  // Find the first plan whose sort_date is <= "now"
  const nowISO = new Date().toISOString();
  const pastPlan = plans.find((p) => {
    const sortDate = p?.attributes?.sort_date;
    if (!sortDate) return false;
    return new Date(sortDate) <= new Date(nowISO);
  });

  if (!pastPlan) {
    throw new Error(
      "No past plan found. (Check serviceTypeId or date assumptions.)"
    );
  }

  const planId = pastPlan.id;

  // 2) Fetch all items for that plan, include parent so we can see header relationships
  // We order by position so the first child after the header is easy to identify.
  const itemsURL =
    `/service_types/${serviceTypeId}/plans/${planId}/items` +
    `?order=position&per_page=200&include=parent` +
    `&fields[items]=title,description,item_type,position`;

  const itemsRes = await api.get(itemsURL);
  const items = itemsRes.data?.data ?? [];
  const included = itemsRes.data?.included ?? [];

  // Build a quick lookup for included records (parents)
  const byTypeId = new Map();
  for (const inc of included) byTypeId.set(`${inc.type}:${inc.id}`, inc);

  // 3) Find the Message header
  const messageHeaderIdx = items.findIndex(
    (it) =>
      it?.attributes?.item_type?.toLowerCase() === "header" &&
      (it?.attributes?.title || "").trim().toLowerCase() === "message"
  );

  if (messageHeaderIdx === -1) {
    throw new Error('No "Message" header found in this plan.');
  }

  const messageHeader = items[messageHeaderIdx];

  // 4) Find the first non-header item after it
  const firstChild = items
    .slice(messageHeaderIdx + 1)
    .find((it) => it?.attributes?.item_type?.toLowerCase() !== "header");

  if (!firstChild) {
    throw new Error('No item found after the "Message" header.');
  }

  const description =
    firstChild?.attributes?.description ||
    firstChild?.attributes?.html_details ||
    "";

  return {
    planId,
    planSortDate: pastPlan?.attributes?.sort_date,
    headerId: messageHeader.id,
    itemId: firstChild.id,
    itemTitle: firstChild?.attributes?.title || "",
    description,
  };
}
