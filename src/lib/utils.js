import sanitizeHtml from "sanitize-html";
import { DateTime } from "luxon";

export const TZ = "America/Chicago";

export const fmtDate = (iso) =>
  DateTime.fromISO(iso, { zone: TZ }).toFormat("cccc, LLL d, h:mm a");

export function sanitize(html) {
  return sanitizeHtml(html, {
    allowedTags: sanitizeHtml.defaults.allowedTags.concat(["img"]),
    allowedAttributes: {
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

export function calcRemaining(total, received) {}
