const mongoose = require('mongoose');

const skillPostSchema = new mongoose.Schema({
  title: { type: String, required: true },
  content: { type: String, required: true },
  category: { 
    type: String, 
    enum: ['tutorial', 'question', 'discussion', 'resource', 'project'],
    required: true 
  },
  tags: [{ type: String }],
  upvotes: { type: Number, default: 0 },
  author_name: { type: String, required: true },
  // Links the post to the Firebase user who created it
  author_id: { 
    type: String, 
    ref: 'User', 
    required: true 
  }
}, { timestamps: true });

module.exports = mongoose.model('SkillPost', skillPostSchema);
