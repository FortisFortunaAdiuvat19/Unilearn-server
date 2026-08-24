const mongoose = require('mongoose');

const tutorReviewSchema = new mongoose.Schema({
  tutor_id: { type: String, ref: 'User', required: true },
  student_id: { type: String, ref: 'User', required: true },
  course_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Course' },
  rating: { type: Number, required: true, min: 1, max: 5 },
  comment: { type: String, default: '' },
}, { timestamps: true });

module.exports = mongoose.model('TutorReview', tutorReviewSchema);
