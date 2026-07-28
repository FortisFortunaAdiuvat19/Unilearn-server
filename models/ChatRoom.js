const mongoose = require('mongoose');

const chatRoomSchema = new mongoose.Schema({
  name: { type: String, required: true },
  type: { 
    type: String, 
    enum: ['group', 'individual'], 
    required: true 
  },
  description: String,
  course_id: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'Course' // Optional: only present if the room is specific to a course
  }
}, { timestamps: true });

module.exports = mongoose.model('ChatRoom', chatRoomSchema);
