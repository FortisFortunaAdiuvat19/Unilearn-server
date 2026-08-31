const express = require('express');
const router = express.Router();
const verifyToken = require('../middleware/auth');
const requireAdmin = require('../middleware/requireAdmin');

// search.list costs 100 quota units per call against YouTube's default
// 10,000/day quota — i.e. ~100 searches/day by default. Gating this to
// admins isn't just a UX choice, it's what keeps that quota from being
// burned through by anyone who happens to be signed in.
router.get('/search', verifyToken, requireAdmin, async (req, res) => {
  if (!process.env.YOUTUBE_API_KEY) {
    return res.status(503).json({
      message: 'YouTube search is not configured. Add YOUTUBE_API_KEY to the server environment.'
    });
  }

  const q = (req.query.q || '').trim();
  if (!q) {
    return res.status(400).json({ message: 'A search query is required.' });
  }

  try {
    const searchParams = new URLSearchParams({
      key: process.env.YOUTUBE_API_KEY,
      part: 'snippet',
      type: 'video',
      maxResults: '8',
      q,
      safeSearch: 'moderate',
      videoEmbeddable: 'true',
    });
    const searchRes = await fetch(`https://www.googleapis.com/youtube/v3/search?${searchParams}`);
    const searchData = await searchRes.json();

    if (!searchRes.ok) {
      return res.status(searchRes.status).json({
        message: searchData.error?.message || 'YouTube search failed.'
      });
    }

    const videoIds = (searchData.items || []).map((item) => item.id?.videoId).filter(Boolean);
    if (videoIds.length === 0) {
      return res.status(200).json({ results: [] });
    }

    // A second call for duration/view count — search.list alone doesn't
    // include these. One batched call for all results, not one per video.
    const detailsParams = new URLSearchParams({
      key: process.env.YOUTUBE_API_KEY,
      part: 'contentDetails,statistics',
      id: videoIds.join(','),
    });
    const detailsRes = await fetch(`https://www.googleapis.com/youtube/v3/videos?${detailsParams}`);
    const detailsData = await detailsRes.json();
    const detailsById = new Map((detailsData.items || []).map((d) => [d.id, d]));

    const results = (searchData.items || [])
      .filter((item) => item.id?.videoId)
      .map((item) => {
        const details = detailsById.get(item.id.videoId);
        const duration = details ? parseDuration(details.contentDetails.duration) : { minutes: null, display: null };
        return {
          video_id: item.id.videoId,
          title: item.snippet.title,
          channel: item.snippet.channelTitle,
          thumbnail: item.snippet.thumbnails?.medium?.url || item.snippet.thumbnails?.default?.url || null,
          published_at: item.snippet.publishedAt,
          duration_minutes: duration.minutes,
          duration_display: duration.display,
          view_count: details ? Number(details.statistics.viewCount) || null : null,
          url: `https://www.youtube.com/watch?v=${item.id.videoId}`,
        };
      });

    res.status(200).json({ results });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// YouTube durations come back as ISO 8601 (e.g. "PT15M33S"). Returns both
// a numeric minute count (for storage, matching VideoResource's
// duration_minutes field) and a "15:33" style string (for display).
function parseDuration(iso) {
  const match = (iso || '').match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!match) return { minutes: null, display: null };
  const hours = parseInt(match[1] || '0', 10);
  const minutes = parseInt(match[2] || '0', 10);
  const seconds = parseInt(match[3] || '0', 10);

  const totalMinutes = Math.round(hours * 60 + minutes + seconds / 60);

  const displayParts = [];
  if (hours) displayParts.push(String(hours));
  displayParts.push(hours ? String(minutes).padStart(2, '0') : String(minutes));
  displayParts.push(String(seconds).padStart(2, '0'));

  return { minutes: totalMinutes, display: displayParts.join(':') };
}

module.exports = router;
