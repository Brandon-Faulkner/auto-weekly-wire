import fs from "fs";
import mailchimp from "@mailchimp/mailchimp_marketing";

mailchimp.setConfig({
  apiKey: process.env.MAILCHIMP_API_KEY,
  server: process.env.MAILCHIMP_API_KEY.split("-").pop(),
});

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
      folder_id: 'b3446b3d1b',
    },
  });

  await mailchimp.campaigns.setContent(campaign.id, { html });
  return { campaignId: campaign.id, web_id: campaign.web_id };
}
