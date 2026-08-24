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
  // Populated from the Firebase token at sync time (see routes/auth.js).
  // Needed anywhere we have to show one user's identity to another user —
  // e.g. a tutor's name in a tutor listing — since nothing else in this
  // app stores that server-side.
  name: { type: String, default: '' },
  email: { type: String, default: '' },
}, { timestamps: true });

module.exports = mongoose.model('User', userSchema);
