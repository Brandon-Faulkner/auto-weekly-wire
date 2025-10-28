import {
  fmtDate,
  sanitize,
  escapeHtml,
  leftAlignParagraphs,
  calcRemainingAmount,
} from "./utils.js";

export function renderFinancials(html, financial) {
  let givingGoal = financial.givingGoal;
  let remaining = calcRemainingAmount(givingGoal, financial.giftsReceived);
  let givingGoalFormatted = givingGoal.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });

  html = html.replaceAll("{{F_R}}", remaining);
  html = html.replaceAll("{{F_G}}", givingGoalFormatted);
  html = html.replaceAll("{{F_T}}", financial.totalGifts);
  html = html.replaceAll("{{F_TG}}", financial.totalGiftsGoal);
  html = html.replaceAll("{{F_N}}", financial.newGivers);
  html = html.replaceAll("{{F_NG}}", financial.newGiversGoal);
  html = html.replaceAll("{{F_U}}", financial.uniqueGivers);
  html = html.replaceAll("{{F_UG}}", financial.uniqueGiversGoal);

  return html;
}

export function renderWeeklyEvents(html) {
  return `<div mc:edit="weekly_events" class="mceText" style="width:100% text-align:left;">${html}</div>`;
}

export function renderUpcomingEvents(regs) {
  if (!regs?.length) return "<p>No upcoming registrations.</p>";
  const items = regs
    .map((r) => {
      const hasDate = !!r.display_starts_at;
      const when = hasDate ? fmtDate(r.display_starts_at) : null;
      const whenHtml = hasDate ? `<strong>${when}</strong> - ` : "";

      // Build a local anchor link that matches the registration anchor ID
      const anchorId = `reg-${
        r.id || r.title.replace(/\s+/g, "-").toLowerCase()
      }`;
      const url = `#${anchorId}`;

      return `<li>${whenHtml}${escapeHtml(
        r.title
      )} — <a href="${url}">Details</a></li>`;
    })
    .join("\n");
  return sanitize(`<ul>${items}</ul>`);
}

export function renderSermon(sermon, summary) {
  const title = sermon?.title || "This Week's Message";
  const thumbnail = sermon?.thumbnail;
  const url = sermon?.url || "canachurch.com/sermons";

  const img = thumbnail
    ? `<p><a href="${url}" target="_blank" rel="noopener"><img src="${thumbnail}" alt="${escapeHtml(
        title
      )}"/></a></p>`
    : "";
  return sanitize(
    `${img}<h3 style="margin-top:12px;">${escapeHtml(
      title
    )}</h3><div>${summary}</div>`
  );
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

      // Event anchor before registrations Name/title
      const anchorId = `reg-${
        reg.id || reg.title.replace(/\s+/g, "-").toLowerCase()
      }`;
      filled =
        `<a id="${anchorId}" name="${anchorId}"></a>\n` +
        filled.replaceAll("{{REGISTRATION_NAME}}", escapeHtml(name));

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
