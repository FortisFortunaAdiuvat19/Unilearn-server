const express = require('express');
const router = express.Router();
const verifyToken = require('../middleware/auth');
const User = require('../models/User');

const MATRIC_NUMBER_PATTERN = /^\d{11}$/;

// Whole-day difference, ignoring time-of-day — a user active any time on
// a given UTC day counts as active "that day" for streak purposes. Being
// off by a few hours right around midnight is a normal, accepted
// imprecision in streak features generally, not something worth chasing
// exact local-timezone precision for.
const daysBetween = (a, b) => {
  const startOfDay = (d) => { const x = new Date(d); x.setUTCHours(0, 0, 0, 0); return x; };
  return Math.round((startOfDay(b) - startOfDay(a)) / 86400000);
};

// POST /api/auth/sync
router.post('/sync', verifyToken, async (req, res) => {
  try {
    // Falls back to the email's local part when Firebase has no display
    // name set (common for email/password sign-ups) — same fallback the
    // client already uses when it has to show a name.
    const displayName = req.user.name || (req.user.email ? req.user.email.split('@')[0] : 'User');

    const existing = await User.findById(req.user.uid);
    const now = new Date();

    // Streak logic: same day as last login -> unchanged (multiple logins
    // in one day don't inflate it); exactly one day later -> increments;
    // anything further -> the streak broke, restart at 1; no prior login
    // at all -> today is day 1.
    let current_streak = 1;
    if (existing?.last_login_date) {
      const diff = daysBetween(existing.last_login_date, now);
      if (diff === 0) current_streak = existing.current_streak || 1;
      else if (diff === 1) current_streak = (existing.current_streak || 0) + 1;
      // else: diff > 1, streak broken, stays at the default of 1
    }
    const longest_streak = Math.max(existing?.longest_streak || 0, current_streak);

    const setFields = {
      name: displayName,
      email: req.user.email || '',
      current_streak,
      longest_streak,
      last_login_date: now,
    };

    // matric_number is only ever sent by the registration flow, on first
    // sync — a normal login sync never includes it, so this never
    // accidentally overwrites an already-set value.
    // Optional chaining is deliberate here, not defensive habit: a normal
    // login sync (checkUserAuth/refreshUser on the client) sends this
    // request with no body at all, which leaves req.body itself as
    // undefined rather than {} — req.body.matric_number would throw in
    // that case instead of safely evaluating to undefined.
    if (req.body?.matric_number) {
      if (!MATRIC_NUMBER_PATTERN.test(req.body.matric_number)) {
        return res.status(400).json({
          message: 'Matriculation number must be exactly 11 digits — 4-digit registration year followed by 7 digits, e.g. 20211263825.'
        });
      }
      setFields.matric_number = req.body.matric_number;
    }

    const user = await User.findByIdAndUpdate(
      req.user.uid,
      {
        $set: setFields,
        $setOnInsert: { _id: req.user.uid, role: 'user' },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    res.status(200).json({ user });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({ message: 'This matriculation number is already registered to another student.' });
    }
    console.error('Auth sync error:', error);
    res.status(500).json({ message: 'Server error during user sync' });
  }
});

module.exports = router;
