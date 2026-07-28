const mongoose = require('mongoose');

const courseSchema = new mongoose.Schema({
  title: { type: String, required: true },
  course_code: { type: String, required: true },
  description: String,
  long_description: String,
  category: { 
    type: String, 
    enum: ['CSC', 'CIT', 'MTH', 'PHY', 'CHM', 'BIO', 'ENG', 'GST', 'STA', 'IFT', 'SIW'],
    required: true
  },
  level: { type: Number, enum: [100, 200, 300, 400, 500], required: true },
  semester: { type: Number, enum: [1, 2], required: true },
  difficulty: { type: String, enum: ['beginner', 'intermediate', 'advanced'], default: 'beginner' },
  image_url: String,
  instructor_name: String,
  instructor_bio: String,
  duration_hours: Number,
  modules: [{
    title: String,
    description: String,
    duration_minutes: Number,
    content_type: { type: String, enum: ['video', 'text', 'quiz', 'exercise'] }
  }],
  outcomes: [String],
  tags: [String],
  enrollment_count: { type: Number, default: 0 },
  rating: { type: Number, default: 0 },
  is_featured: { type: Boolean, default: false },
  // Replaces Base44's RLS created_by_id with a reference to the Firebase UID
  created_by_id: { type: String, ref: 'User', required: true } 
}, { timestamps: true });

module.exports = mongoose.model('Course', courseSchema);
