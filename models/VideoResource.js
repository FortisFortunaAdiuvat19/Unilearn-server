const mongoose = require('mongoose');

const videoResourceSchema = new mongoose.Schema({
  course_id: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'Course', 
    required: true 
  },
  title: { type: String, required: true },
  url: { type: String, required: true },
  description: String,
  duration_minutes: Number
}, { timestamps: true });

module.exports = mongoose.model('VideoResource', videoResourceSchema);
