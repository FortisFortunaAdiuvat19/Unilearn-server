const express = require('express');
const router = express.Router();
const verifyToken = require('../middleware/auth');
const User = require('../models/User');

// POST /api/auth/sync
router.post('/sync', verifyToken, async (req, res) => {
  try {
    // Falls back to the email's local part when Firebase has no display
    // name set (common for email/password sign-ups) — same fallback the
    // client already uses when it has to show a name.
    const displayName = req.user.name || (req.user.email ? req.user.email.split('@')[0] : 'User');

    const user = await User.findByIdAndUpdate(
      req.user.uid,
      {
        $set: { name: displayName, email: req.user.email || '' },
        $setOnInsert: { _id: req.user.uid, role: 'user' },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    res.status(200).json({ user });
  } catch (error) {
    console.error('Auth sync error:', error);
    res.status(500).json({ message: 'Server error during user sync' });
  }
});

module.exports = router;
