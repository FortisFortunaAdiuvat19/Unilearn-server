const mongoose = require('mongoose');

// Cards are stored as a single flat, ordered array rather than separate
// info/quiz collections, because presentation order IS the data: info
// card, then its two quiz cards, repeated for each sub-topic. Splitting
// this into separate arrays would mean reconstructing that interleaving
// on every read for no benefit — nothing ever queries info and quiz
// cards independently of each other.
const cardSchema = new mongoose.Schema({
  type: { type: String, enum: ['info', 'quiz'], required: true },

  // info cards
  heading: String,
  body: String,               // narrative, teacher-to-student prose
  video_id: String,           // YouTube video ID, if a match was found
  video_title: String,
  sources: [{ title: String, url: String }],  // from Gemini's search grounding

  // quiz cards
  question: String,
  options: [String],
  correct_index: Number,
  explanation: String,
}, { _id: true });

const moduleSchema = new mongoose.Schema({
  course_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Course', required: true },
  // Index into course.scheme_of_work — this is how a module maps back to
  // "one week's worth of topics" rather than duplicating week/topic text
  // here and risking the two drifting apart if the scheme of work is
  // ever edited.
  week_index: { type: Number, required: true },
  topic: { type: String, required: true },  // snapshot of scheme_of_work[week_index].topic at generation time
  cards: [cardSchema],
  status: { type: String, enum: ['not_generated', 'generating', 'ready', 'failed'], default: 'not_generated' },
  error_message: String,      // populated only when status is 'failed'
  generated_at: Date,
}, { timestamps: true });

// One module per course per week — regenerating overwrites the existing
// document rather than creating a duplicate.
moduleSchema.index({ course_id: 1, week_index: 1 }, { unique: true });

module.exports = mongoose.model('Module', moduleSchema);
