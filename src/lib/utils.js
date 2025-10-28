import sanitizeHtml from "sanitize-html";
import { DateTime } from "luxon";

export const fmtDate = (iso) =>
  DateTime.fromISO(iso, { zone: "America/Chicago" }).toFormat(
    "cccc, LLL d, h:mm a"
  );

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

export function calcRemainingAmount(
  givingGoal,
  giftsReceived,
  stretchIncrement = 10000
) {
  const goal = Number(givingGoal) || 0;
  const received = Number(giftsReceived) || 0;
  const stretch = Number(stretchIncrement) || 0;

  if (received < goal) {
    const remaining = goal - received;
    return remaining.toLocaleString("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    });
  }

  // Goal met - apply any overage toward the next $stretch
  const over = received - goal;
  const applied = Math.min(over, stretch);
  const remainingStretch = Math.max(stretch - applied, 0);
  const remainingStretchFormatted = remainingStretch.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
  const stretchFormatted = stretch.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });

  // Return the html message + the remaining stretch
  return `<div style="font-size: 12px;">Goal Met!<br/>Can we stretch an additional ${stretchFormatted}?</div>${remainingStretchFormatted}`;
}
