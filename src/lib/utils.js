import sanitizeHtml from "sanitize-html";
import { DateTime } from "luxon";

export const fmtDate = (iso) =>
  DateTime.fromISO(iso, { zone: "America/Chicago" }).toFormat("cccc, LLL d, h:mm a");

export function sanitize(html) {
  return sanitizeHtml(html, {
    allowedTags: sanitizeHtml.defaults.allowedTags.concat(["img"]),
    allowedAttributes: {
      "*": ["style"],
      a: ["href", "title", "target", "rel"],
      img: ["src", "alt"],
    },
  });
}

export const escapeHtml = (s = "") =>
  s.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[
        c
      ])
  );

export function leftAlignParagraphs(html) {
  if (!html) return "";

  // 1. Ensure every <p> tag has text-align:left
  // If the <p> already has a style attribute, prepend text-align:left;
  // If not, add a full style attribute
  html = html.replace(
    /<p(?![^>]*text-align\s*:)/gi,
    '<p style="text-align:left;"'
  );

  // Also handle <p style="..."> that already have a style attr (prepend)
  html = html.replace(
    /<p([^>]*\sstyle=")([^"]*)"/gi,
    (m, pre, styles) => `<p${pre}text-align:left; ${styles}"`
  );

  return html;
}

export function calcRemainingAmount(givingGoal, giftsReceived) {
  const goal = Number(givingGoal) || 0;
  const received = Number(giftsReceived) || 0;

  // Ensure it doesn't go below 0
  const remaining = Math.max(goal - received, 0);

  // Format as U.S. currency, no cents
  return remaining.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
}
