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
  },
  // Optional. Only set on rooms created through the tutor "Connect" flow,
  // so that flow can find-or-create a single room per tutor/student/course
  // pair instead of spawning a new one on every click. Rooms created the
  // normal way (via the Community "New Room" form) leave this empty and
  // remain open to anyone, same as before.
  participants: [{ type: String, ref: 'User' }],
}, { timestamps: true });

module.exports = mongoose.model('ChatRoom', chatRoomSchema);
