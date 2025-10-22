import { GoogleGenerativeAI } from "@google/generative-ai";
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

export async function summarizeSermon({ transcript, title }) {
  if (!transcript || transcript.length < 100) {
    return "Listen to this week's message on our YouTube channel, our website, or even through our Apple or Spotify Podcast channels!";
  }
  const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
  const prompt = `Summarize the sermon for a church newsletter.
- 180-220 words, warm pastoral tone.`;
  const res = await model.generateContent([
    {
      text: `${prompt}\n\nTitle: ${title}\nTranscript:\n${transcript.slice(
        0,
        12000
      )}`,
    },
  ]);
  const text = res.response.text().trim();
  return text;
}
