const mongoose = require('mongoose');

const resultSchema = new mongoose.Schema({
  assessment_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Assessment',
    required: true
  },
  // Denormalized from the assessment so results can be queried per-course
  // (e.g. for progress tracking / recommendations) without a extra lookup.
  course_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Course',
    required: true
  },
  // Firebase UID of the student who took the assessment
  student_id: {
    type: String,
    ref: 'User',
    required: true
  },
  type: {
    type: String,
    enum: ['test', 'exam'],
    required: true
  },
  // Both arrays are aligned by index with the assessment's question arrays.
  // null / '' means that question was left unanswered.
  objective_answers: { type: [Number], default: [] },
  theory_answers: { type: [String], default: [] },
  // Objective section is auto-graded server-side against the assessment's
  // answer key. Theory answers are stored for self-review only, same as
  // the existing player UI — no auto-grading for those.
  objective_score: { type: Number, default: 0 },
  objective_max: { type: Number, default: 0 },
  objective_percent: { type: Number, default: 0 }
}, { timestamps: true });

// Multiple attempts per student/assessment are allowed (retakes), so this
// is an index for fast lookups, not a uniqueness constraint.
resultSchema.index({ student_id: 1, assessment_id: 1 });
resultSchema.index({ student_id: 1, course_id: 1 });

module.exports = mongoose.model('Result', resultSchema);
