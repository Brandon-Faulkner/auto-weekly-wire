import dotenv from "dotenv/config";
import fs from "fs";
import { DateTime } from "luxon";
import { fetchLatestSermon } from "./api/youtube.js";
import {
  fetchPcoFinancialStats,
  fetchPcoOpenRegistrations,
  fetchPcoMessageOutline,
} from "./api/pco.js";
import { summarizeSermon } from "./api/summarize.js";
import {
  renderFinancials,
  renderWeeklyEvents,
  renderUpcomingEvents,
  renderSermon,
  renderRegistrations,
} from "./lib/render.js";
import {
  createDraftWithHtml,
  getTemplateWeeklyEvents,
} from "./api/mailchimp.js";
import { getNextWednesday } from "./lib/utils.js";

const DRY = process.argv.includes("--dry");

async function main() {
  /*
    Mailchimp draft outline:
      - Financial Statistics:
          - {{F_R}} = Remaining amount between goal and gifts
          - {{F_G}} = Financial Goal
          - {{F_T}} = Total Gifts
            - {{F_TG}} = Total Gifts Goal
          - {{F_N}} = New Givers
            - {{F_NG}} = New Givers Goal
          - {{F_U}} = Unique Givers
            - {{F_UG}} = Unique Givers Goal
      - Calander at a Glance:
          - {{WEEKLY}} = Weekly evetns pulled from mailchimp template 
          - {{EVENTS}} = Condensed PCO Registrations
      - Last Week's Sermon:
          - {{SERMON}} = Youtube link + title + AI summarized transcript from Gemini and PCO
      - Full Registrations:
          - Duplicate between data-block="registration_block_start" and "registration_block_end"
          - Each event has:
              - {{REGISTRATION_NAME}}
              - {{REGISTRATION}} = Image and description
              - {{REGISTRATION_LINK}}
  */

  // Pull all information from API's
  const financial = await fetchPcoFinancialStats({
    patId: process.env.PCO_PAT_ID,
    patSecret: process.env.PCO_PAT_SECRET,
  });

  const weekly = await getTemplateWeeklyEvents();

  const registrations = await fetchPcoOpenRegistrations({
    patId: process.env.PCO_PAT_ID,
    patSecret: process.env.PCO_PAT_SECRET,
  });

  const sermon = await fetchLatestSermon({
    channelId: process.env.YT_CHANNEL_ID,
    apiKey: process.env.YT_API_KEY,
  });

  const sermonOutline = await fetchPcoMessageOutline({
    patId: process.env.PCO_PAT_ID,
    patSecret: process.env.PCO_PAT_SECRET,
  });

  /* const sermonSummary = await summarizeSermon({
    transcript: sermonOutline?.description || "",
    title: sermon?.title || "This Week's Message",
  }); */

  // Begin rendering information in the HTML
  let html = fs.readFileSync("templates/base.html", "utf8");
  html = renderFinancials(html, financial);
  html = html.replaceAll("{{WEEKLY}}", renderWeeklyEvents(weekly));
  html = html.replaceAll("{{EVENTS}}", renderUpcomingEvents(registrations));
  html = html.replaceAll("{{SERMON}}", renderSermon(sermon, sermonOutline));
  html = renderRegistrations(html, registrations);

  // Setup email information
  const nextWednesday = getNextWednesday();
  const subject = `AutoWire ${nextWednesday.toFormat("DDD")}`;
  const fromName = process.env.MC_FROM_NAME || "Cana Church";
  const replyTo = process.env.MC_REPLY_TO || "cana@canachurch.com";

  if (DRY) {
    console.log("[DRY RUN] Would create Mailchimp draft with:");
    console.log({
      subject,
      financials: financial,
      registrations: registrations.length,
      videoId: sermon?.videoId,
      sermonSummary: sermonOutline,
    });
    fs.writeFileSync("test.html", html);
    return;
  }

  const mc = await createDraftWithHtml({
    listId: process.env.MAILCHIMP_LIST_ID,
    subject,
    fromName,
    replyTo,
    html,
  });

  console.log("Draft created:", mc);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
