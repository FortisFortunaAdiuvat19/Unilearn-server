const mongoose = require('mongoose');

const enrollmentSchema = new mongoose.Schema({
  student_id: { 
    type: String, // Firebase UID
    ref: 'User', 
    required: true 
  },
  course_id: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'Course', 
    required: true 
  },
  progress: { type: Number, default: 0 },
  completed_modules: [Number],
  status: { type: String, enum: ['active', 'completed', 'paused'], default: 'active' },
  last_accessed: Date
}, { timestamps: true });

// Ensure a student can only enroll in a specific course once
enrollmentSchema.index({ student_id: 1, course_id: 1 }, { unique: true });

module.exports = mongoose.model('Enrollment', enrollmentSchema);
