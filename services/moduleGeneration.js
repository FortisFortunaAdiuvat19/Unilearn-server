const gemini = require('../config/gemini');
const CourseDocument = require('../models/CourseDocument');

const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3.6-flash';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Google's 429 responses carry a RetryInfo.retryDelay telling the client
// exactly how long to wait -- e.g. {"error": {"code": 429, "details": [
// {"@type": ".../RetryInfo", "retryDelay": "15.002899939s"}]}}. The
// @google/genai SDK's exact error shape isn't consistently documented,
// and in practice the useful detail sometimes ends up inside `.message`
// as a still-JSON-encoded string rather than a parsed object, so this
// tries several places rather than assuming one fixed shape.
function parseGeminiError(error) {
  let status = error?.status ?? error?.code ?? error?.response?.status ?? null;
  let retryDelaySeconds = null;

  const scan = (obj) => {
    if (!obj || typeof obj !== 'object') return;
    const inner = obj.error || obj;
    if (inner?.code && !status) status = inner.code;
    for (const d of inner?.details || []) {
      const match = typeof d?.retryDelay === 'string' && d.retryDelay.match(/([\d.]+)s/);
      if (match) retryDelaySeconds = parseFloat(match[1]);
    }
  };

  scan(error);
  if (typeof error?.message === 'string') {
    try {
      scan(JSON.parse(error.message));
    } catch {
      // Not a JSON-encoded message -- fall back to a plain-text signal.
      if (!status && /RESOURCE_EXHAUSTED|429|quota/i.test(error.message)) status = 429;
    }
  }

  return { status: Number(status) || null, retryDelaySeconds };
}

const RETRYABLE_STATUSES = new Set([429, 500, 503, 504]);
// A retryDelay longer than this most likely reflects a daily/long-term
// quota rather than a short per-minute one -- waiting that long inside a
// single run would make the script look hung with no useful feedback.
// Treated as non-retryable here so the module fails clearly instead,
// leaving it for a later run (a fresh day, or after enabling billing)
// rather than an open-ended silent wait.
const MAX_SENSIBLE_RETRY_DELAY_SECONDS = 120;

async function callGeminiWithRetry(params, { maxAttempts = 5, label = 'Gemini call' } = {}) {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await gemini.models.generateContent(params);
    } catch (error) {
      const { status, retryDelaySeconds } = parseGeminiError(error);
      const isLastAttempt = attempt === maxAttempts;
      const tooLongToWait = retryDelaySeconds !== null && retryDelaySeconds > MAX_SENSIBLE_RETRY_DELAY_SECONDS;

      if (!RETRYABLE_STATUSES.has(status) || isLastAttempt || tooLongToWait) {
        if (status === 429 && tooLongToWait) {
          throw new Error(
            `Rate limited (429) and the API's suggested wait (${retryDelaySeconds}s) looks like a longer-term ` +
            `quota, not a short per-minute one. Not waiting that long inside this run -- try again later, or on a ` +
            `fresh day if this is the daily limit.`
          );
        }
        if (status === 429) {
          throw new Error(`Rate limited (429) on ${label} after ${attempt} attempt(s): ${error.message}`);
        }
        throw error;
      }

      // Respect the API's own guidance when it gives one; otherwise fall
      // back to exponential backoff with jitter, capped at 30s.
      const waitSeconds = retryDelaySeconds ?? Math.min(2 ** attempt + Math.random() * 2, 30);
      console.log(`  ${label}: hit ${status}, waiting ${waitSeconds.toFixed(1)}s before retry (attempt ${attempt}/${maxAttempts})...`);
      await sleep(waitSeconds * 1000);
    }
  }
}

// Structuring the researched narrative into cards. Deliberately no
// `tools` here — the Gemini API doesn't support combining search
// grounding with structured-output/schema constraints in the same call,
// so this has to be a second, separate request from the research step.
const CARDS_SCHEMA = {
  type: 'object',
  properties: {
    cards: {
      type: 'array',
      description: 'Two to four info cards, each a self-contained chunk of the material, in teaching order.',
      items: {
        type: 'object',
        properties: {
          heading: { type: 'string' },
          body: { type: 'string', description: 'The narrative explanation for this card, preserved from the source text as closely as possible — not summarized or shortened.' },
          video_search_query: { type: 'string', description: 'A short, specific YouTube search query (3-6 words) for a video on this card\'s specific content.' },
          quiz: {
            type: 'array',
            description: 'Exactly 2 multiple-choice questions testing this specific card\'s content.',
            items: {
              type: 'object',
              properties: {
                question: { type: 'string' },
                options: { type: 'array', items: { type: 'string' }, description: 'Exactly 4 options.' },
                correct_index: { type: 'integer', description: '0-based index into options of the correct answer.' },
                explanation: { type: 'string', description: 'One sentence on why the correct answer is right.' },
              },
              required: ['question', 'options', 'correct_index', 'explanation'],
            },
          },
        },
        required: ['heading', 'body', 'video_search_query', 'quiz'],
      },
    },
  },
  required: ['cards'],
};

// One video.list call per query, keeping just the top embeddable result —
// this is a lighter-weight need than the full admin search-and-browse UI
// in routes/youtube.js, so it isn't reusing that route directly.
async function findVideoForQuery(query) {
  if (!process.env.YOUTUBE_API_KEY) return null;
  try {
    const params = new URLSearchParams({
      key: process.env.YOUTUBE_API_KEY,
      part: 'snippet',
      type: 'video',
      maxResults: '1',
      q: query,
      safeSearch: 'moderate',
      videoEmbeddable: 'true',
    });
    const res = await fetch(`https://www.googleapis.com/youtube/v3/search?${params}`);
    const data = await res.json();
    const item = data.items?.[0];
    if (!item?.id?.videoId) return null;
    return { video_id: item.id.videoId, video_title: item.snippet?.title || query };
  } catch {
    // A missing video is a degraded card, not a failed module — the info
    // and quiz content still stands on its own without it.
    return null;
  }
}

// The full two-step pipeline for one module: research with search
// grounding, structure into cards, attach a video per card. Takes plain
// course/sow data (not a live Mongoose query) so callers — the route,
// which already has `course` loaded, and the bulk script, which is
// iterating over many at once — don't each re-fetch it.
async function generateModuleCards(course, sow) {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error(
      'GEMINI_API_KEY is not set in this environment. If it\'s already configured on Render for the ' +
      'deployed app, that\'s a separate environment — add it to your local .env file too, since ' +
      'scripts run on your own machine and read your local environment, not Render\'s.'
    );
  }

  // Existing course documents are real source material, not just
  // web-researched content — folded into the research prompt so the
  // model builds on what's already been curated for this course.
  const existingDocs = await CourseDocument.find({ course_id: course._id }).limit(5).select('title content');
  const docsContext = existingDocs.length
    ? `\n\nThe following notes already exist for this course and may be useful background:\n${existingDocs.map((d) => `- ${d.title}: ${d.content.slice(0, 500)}`).join('\n')}`
    : '';

  // Step 1: research + narrative draft, with search grounding.
  const researchPrompt = `You are an expert university lecturer preparing teaching material for a specific course topic.

Course: ${course.title} (${course.course_code})
${sow.week}: ${sow.topic}
Curriculum detail for this week: ${sow.details || 'N/A'}
${docsContext}

Research this topic using current, reputable sources and write a thorough, narrative explanation of it as if you are personally teaching a university student. Speak to the student directly, build the ideas up step by step, use concrete examples, and explain why the material matters, not just what it is. Write in flowing prose paragraphs — do not use bullet points or numbered lists. If the topic naturally splits into two to four distinct sub-parts, structure your explanation around each of them in turn with clear paragraph breaks between them. Write approximately 900-1400 words in total.`;

  const researchResponse = await callGeminiWithRetry({
    model: GEMINI_MODEL,
    contents: researchPrompt,
    config: { tools: [{ googleSearch: {} }] },
  }, { label: 'research call' });

  const narrative = researchResponse.text;
  if (!narrative) throw new Error('Research step returned no content.');

  const sources = (researchResponse.candidates?.[0]?.groundingMetadata?.groundingChunks || [])
    .map((c) => ({ title: c.web?.title, url: c.web?.uri }))
    .filter((s) => s.url);

  // Step 2: structure the narrative into cards. Separate call —
  // combining search grounding with a schema-constrained response in one
  // request isn't supported by the API.
  const structurePrompt = `Below is a narrative teaching explanation of a university course topic:\n\n${narrative}\n\nSplit this into two to four self-contained info cards for a card-based learning app, following the instructions in the response schema. Preserve the original wording and teaching tone as closely as possible — distribute the actual text across the cards rather than summarizing it.`;

  // A small proactive gap before the second call, on top of the reactive
  // retry logic above -- at very low per-minute limits (free-tier limits
  // were cut significantly across the board in December 2025), spacing
  // calls out reduces how often a 429 gets hit in the first place, rather
  // than relying entirely on catching and retrying after the fact.
  await sleep(3000);

  const structureResponse = await callGeminiWithRetry({
    model: GEMINI_MODEL,
    contents: structurePrompt,
    config: { responseMimeType: 'application/json', responseSchema: CARDS_SCHEMA },
  }, { label: 'structuring call' });

  const parsed = JSON.parse(structureResponse.text);
  if (!parsed.cards?.length) throw new Error('Structuring step returned no cards.');

  // Attach a video to each info card, then flatten into the final
  // presentation sequence: info, quiz, quiz, info, quiz, quiz, ...
  const finalCards = [];
  for (const card of parsed.cards) {
    const video = await findVideoForQuery(card.video_search_query);
    finalCards.push({
      type: 'info',
      heading: card.heading,
      body: card.body,
      video_id: video?.video_id,
      video_title: video?.video_title,
      sources,
    });
    for (const q of (card.quiz || []).slice(0, 2)) {
      finalCards.push({
        type: 'quiz',
        question: q.question,
        options: q.options,
        correct_index: q.correct_index,
        explanation: q.explanation,
      });
    }
  }

  return finalCards;
}

module.exports = { generateModuleCards };
