// Promotes a Firebase UID to admin. This is the ONLY thing this script
// does — replaces the admin-promotion half of the old scripts/seed.js,
// which also seeded sample courses and is no longer safe to run now that
// the catalog is real (it would overwrite real courses that happen to
// share a code with the old placeholder data). This script has no such
// side effect, so it's safe to run any time, including to promote a
// second admin later.
//
// Usage (from unilearn-server/, with a real .env in place):
//   node scripts/makeAdmin.js <firebase-uid>
//
// Find a UID: Firebase Console -> Authentication -> Users tab -> the
// "User UID" column.

require('dotenv').config();
const mongoose = require('mongoose');
const connectDB = require('../config/db');
const User = require('../models/User');

const uid = process.argv[2];

if (!uid) {
  console.error('Usage: node scripts/makeAdmin.js <firebase-uid>');
  process.exit(1);
}

const run = async () => {
  await connectDB();

  const user = await User.findByIdAndUpdate(
    uid,
    { $set: { role: 'admin' } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  console.log(`Done. ${user._id} is now role: ${user.role}.`);
  if (!user.name && !user.email) {
    console.log(
      'Note: this user has no name/email on record yet — that gets filled in ' +
      'automatically the next time they log in, so make sure they sign in at least once.'
    );
  }

  await mongoose.connection.close();
  process.exit(0);
};

run().catch((error) => {
  console.error('Failed:', error.message);
  process.exit(1);
});
