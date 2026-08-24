const mongoose = require('mongoose');

const tutorProfileSchema = new mongoose.Schema({
  // One profile per user, keyed by their Firebase UID — same pattern as User.
  _id: { type: String, required: true },
  bio: { type: String, default: '' },
  is_available: { type: Boolean, default: true },
  weekly_availability: [{
    day: { type: String, enum: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'], required: true },
    start_time: { type: String, required: true }, // "14:00"
    end_time: { type: String, required: true },   // "16:00"
  }],
  // One entry per course this person is qualified to tutor. knowledge_percent
  // is their best objective_percent across their own Result history for that
  // course's assessments; knowledge_rating is that converted to 1-5 stars.
  // Both are set when they register/refresh for a course (see routes/tutors.js)
  // rather than recomputed on every read.
  courses: [{
    course_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Course', required: true },
    knowledge_percent: { type: Number, required: true },
    knowledge_rating: { type: Number, required: true, min: 1, max: 5 },
  }],
}, { timestamps: true });

module.exports = mongoose.model('TutorProfile', tutorProfileSchema);
