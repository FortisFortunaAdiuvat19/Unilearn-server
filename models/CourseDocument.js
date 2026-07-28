const mongoose = require('mongoose');

const courseDocumentSchema = new mongoose.Schema({
  course_id: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'Course', 
    required: true 
  },
  title: { type: String, required: true },
  topic: String,
  content: { type: String, required: true },
  source_type: { 
    type: String, 
    enum: ['google_drive', 'generated', 'web_search', 'manual'], 
    default: 'manual' 
  },
  source_url: String
}, { timestamps: true });

module.exports = mongoose.model('CourseDocument', courseDocumentSchema);
