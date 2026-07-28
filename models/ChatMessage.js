const mongoose = require('mongoose');

const chatMessageSchema = new mongoose.Schema({
  room_id: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'ChatRoom', 
    required: true 
  },
  content: { type: String, required: true },
  author_name: { type: String, required: true },
  // Links the message to the Firebase user who sent it
  author_id: { 
    type: String, 
    ref: 'User', 
    required: true 
  }
}, { timestamps: true });

module.exports = mongoose.model('ChatMessage', chatMessageSchema);
