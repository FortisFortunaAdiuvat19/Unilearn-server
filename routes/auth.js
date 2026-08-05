const express = require('express');
const router = express.Router();
const verifyToken = require('../middleware/auth');
const User = require('../models/User');

// POST /api/auth/sync
router.post('/sync', verifyToken, async (req, res) => {
  try {
    // Check if the user already exists in MongoDB
    let user = await User.findById(req.user.uid);

    if (!user) {
      // If not, create a new user record using their Firebase UID
      user = new User({
        _id: req.user.uid,
        role: 'user'
      });
      await user.save();
    }

    res.status(200).json({ user });
  } catch (error) {
    console.error('Auth sync error:', error);
    res.status(500).json({ message: 'Server error during user sync' });
  }
});

module.exports = router;
