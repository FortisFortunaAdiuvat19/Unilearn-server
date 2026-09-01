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
  // The university's real-world student identifier — required at
  // registration, enforced unique. `sparse` means multiple documents can
  // have no value at all (older accounts predating this field, or an
  // admin created directly via scripts/makeAdmin.js) without that
  // colliding with each other; the uniqueness constraint only applies
  // once a real value is actually set.
  matric_number: { type: String, unique: true, sparse: true },
  // Login-streak tracking, updated on every /auth/sync call (i.e. every
  // login/app load) rather than needing a separate client-side trigger.
  current_streak: { type: Number, default: 0 },
  longest_streak: { type: Number, default: 0 },
  last_login_date: { type: Date },
}, { timestamps: true });

module.exports = mongoose.model('User', userSchema);
