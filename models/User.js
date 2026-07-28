const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  // We use the Firebase UID as the primary identifier (_id)
  _id: { type: String, required: true }, 
  role: { 
    type: String, 
    enum: ['admin', 'user'], 
    default: 'user',
    required: true 
  },
  // You can add other fields here later (name, email) populated from Firebase
}, { timestamps: true });

module.exports = mongoose.model('User', userSchema);
