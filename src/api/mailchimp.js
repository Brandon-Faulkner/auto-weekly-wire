import mailchimp from "@mailchimp/mailchimp_marketing";

mailchimp.setConfig({
  apiKey: process.env.MAILCHIMP_API_KEY,
  server: process.env.MAILCHIMP_API_KEY.split("-").pop(),
});

export async function getTemplateGoals({
  templateId = "10039709",
  keys = [
    "giving_goal",
    "total_gifts_goal",
    "new_givers_goal",
    "new_givers_goal",
    "unique_givers_goal",
  ],
} = {}) {
  try {
    const res = await mailchimp.templates.getDefaultContentForTemplate(
      templateId
    );
    const sections = res?.sections ?? {};

    // Build output with safe parsing + defaults
    const goals = {};
    for (const key of keys) {
      const raw = sections[key];

      if (!raw) {
        console.warn(`No ${key} section found in template.`);
        return 0;
      }

      // Strip out everything except digits or decimals
      const cleaned = raw.replace(/[^0-9.]/g, "");
      const value = parseFloat(cleaned);

      if (isNaN(value)) {
        console.warn(`Invalid value for ${key}: ${raw}`);
        return 0;
      }

      goals[key] = value;
    }

    return goals;
  } catch (err) {
    console.error("Error fetching template goals: ", err?.message || err);
    return {
      giving_goal: 0,
      total_gifts_goal: 0,
      new_givers_goal: 0,
      unique_givers_goal: 0,
    };
  }
}

export async function getTemplateWeeklyEvents() {
  try {
    const res = await mailchimp.templates.getDefaultContentForTemplate(
      "10039709"
    );
    const html = res?.sections?.weekly_events;

    if (!html) {
      console.warn("No weekly_events section found in template.");
      return 0;
    }

    return html;
  } catch (err) {
    console.error("Error fetching weekly events:", err.message || err);
    return 0;
  }
}

export async function createDraftWithHtml({
  listId,
  subject,
  fromName,
  replyTo,
  html,
}) {
  const campaign = await mailchimp.campaigns.create({
    type: "regular",
    recipients: { list_id: listId },
    settings: {
      subject_line: subject,
      from_name: fromName,
      reply_to: replyTo,
      title: subject,
      folder_id: "b3446b3d1b",
    },
  });

  await mailchimp.campaigns.setContent(campaign.id, { html });
  return { campaignId: campaign.id, web_id: campaign.web_id };
}
