const { GoogleGenAI } = require('@google/genai');

// Constructing the client doesn't make a network call, so this is safe
// even if GEMINI_API_KEY isn't set yet — routes that use it check for the
// key explicitly first and return a clear error instead of a cryptic one
// from the SDK.
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

module.exports = ai;
