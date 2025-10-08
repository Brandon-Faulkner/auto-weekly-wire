import axios from "axios";

export async function fetchLatestSermon({ channelId, apiKey }) {
  const search = await axios.get(
    "https://www.googleapis.com/youtube/v3/search",
    {
      params: {
        part: "snippet",
        channelId,
        order: "date",
        maxResults: 1,
        type: "video",
        key: apiKey,
      },
      timeout: 10000,
    }
  );
  const item = search.data.items?.[0];
  if (!item) return null;
  const videoId = item.id.videoId;
  const title = item.snippet.title;
  const thumbnail = item.snippet.thumbnails?.medium?.url;
  const url = `https://youtu.be/${videoId}`;

  return { videoId, title, thumbnail, url };
}
