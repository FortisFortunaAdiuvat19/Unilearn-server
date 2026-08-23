const User = require('../models/User');

// Run this AFTER verifyToken — it relies on req.user.uid being set.
// verifyToken only decodes the Firebase token, which has no concept of
// our Mongo-only `role` field, so this looks the user up separately.
const requireAdmin = async (req, res, next) => {
  try {
    const user = await User.findById(req.user.uid);
    if (!user || user.role !== 'admin') {
      return res.status(403).json({ message: 'Admin access required' });
    }
    next();
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

module.exports = requireAdmin;
