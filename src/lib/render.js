import { fmtDate, sanitize, escapeHtml, leftAlignParagraphs } from "./utils.js";

export function renderRemainingAmount(givingGoal, giftsReceived) {
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

export function renderStatistic(financialStat) {;
  return Number(financialStat) || 0;
}

export function renderCalendar(events) {
  if (!events?.length) return "<p>No upcoming events.</p>";
  const items = events
    .map((e) => {
      const when = fmtDate(e.start);
      return `<li><strong>${when}</strong> • ${escapeHtml(e.title)}</li>`;
    })
    .join("\n");
  return sanitize(`<ul>${items}</ul>`);
}

export function renderUpcomingEvents(regs) {
  if (!regs?.length) return "<p>No upcoming registrations.</p>";
  const items = regs
    .map((r) => {
      const hasDate = !!r.display_starts_at;
      const when = hasDate ? fmtDate(r.display_starts_at) : null;
      const whenHtml = hasDate ? `<strong>${when}</strong> - ` : "";
      const url = r.url || "#";
      return `<li>${whenHtml}${escapeHtml(
        r.title
      )} — <a href="${url}" target="_blank" rel="noopener">Details</a></li>`;
    })
    .join("\n");
  return sanitize(`<ul>${items}</ul>`);
}

export function renderSermon(sermon, summary) {
  const title = sermon?.title || "This Week's Message";
  const thumbnail = sermon?.thumbnail;
  const url = sermon?.url || "#";

  const img = thumbnail
    ? `<p><a href="${url}" target="_blank" rel="noopener"><img src="${thumbnail}" alt="${escapeHtml(
        title
      )}"/></a></p>`
    : "";
  return sanitize(`${img}<h3>${escapeHtml(title)}</h3><div>${summary}</div>`);
}

export function renderRegistrations(html, regs = []) {
  const START = '<div data-block="registration_block_start"></div>';
  const END = '<div data-block="registration_block_end"></div>';

  const startIdx = html.indexOf(START);
  const endIdx = html.indexOf(END);

  // If markers missing or invalid order, leave html unchanged
  if (startIdx === -1 || endIdx === -1 || endIdx <= startIdx) return html;

  const template = html.slice(startIdx + START.length, endIdx);

  const blocks = (regs || [])
    .map((reg) => {
      const name = reg.title || reg.name || "";
      const url = reg.url || "";
      const imageUrl = reg.logo_url || "";
      const descriptionHtml = leftAlignParagraphs(reg.description_html);

      const imgHtml = imageUrl
        ? `<div style="text-align:center;margin:0 0 12px 0;">
           <img src="${escapeHtml(imageUrl)}" alt="${escapeHtml(
            name
          )}" style="max-width:100%;height:auto;border-radius:16px;display:inline-block;" />
         </div>`
        : "";

      let filled = template;

      // Name/title
      filled = filled.replaceAll("{{REGISTRATION_NAME}}", escapeHtml(name));

      // Main content (image + description)
      filled = filled.replace(
        "{{REGISTRATION}}",
        `${imgHtml}<div style="text-align:left;">${descriptionHtml}</div>`
      );

      // Button label
      filled = filled.replaceAll("{{REGISTRATION_LINK}}", "View Details");

      // First empty href becomes the event URL
      filled = filled.replace(/href=""/, `href="${escapeHtml(url)}"`);

      return filled;
    })
    .join("\n");

  return (
    html.slice(0, startIdx + START.length) +
    "\n" +
    blocks +
    "\n" +
    html.slice(endIdx)
  );
}
