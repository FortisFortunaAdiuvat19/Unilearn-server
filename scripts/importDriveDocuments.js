// Imports course documents from a Google Drive folder into CourseDocument
// records. Doesn't download or store file contents — each document is
// saved as a link back to Drive (source_url), which Drive itself hosts
// and serves. Safe to re-run: files already imported (matched by their
// Drive link) are skipped rather than duplicated, so adding new files to
// the folder later and re-running only imports what's new.
//
// COURSE MATCHING — this is the part that needed a real design decision,
// not just code:
//   1. Primary: organize the shared Drive folder with one SUBFOLDER per
//      course, named after its course code (e.g. "CSC 201", "csc-201",
//      "CSC201" all match — matching ignores case, spaces, and dashes).
//      Every file inside a matched subfolder is attributed to that course.
//   2. Fallback: any file sitting directly in the root folder (not inside
//      a course subfolder) is matched by looking for a course-code-shaped
//      token (e.g. "CSC 201") anywhere in its filename.
//   3. Anything that matches neither is skipped, not silently dropped —
//      the script prints exactly what it couldn't place, so you can
//      rename/move it in Drive and re-run.
// A course_id is required on every CourseDocument, so there's no concept
// of "import as unassigned" here — unmatched files just don't get
// imported until they're organized in a way the script can read.
//
// Usage (from unilearn-server/, with GOOGLE_DRIVE_CLIENT_EMAIL and
// GOOGLE_DRIVE_PRIVATE_KEY set in .env):
//   node scripts/importDriveDocuments.js <drive-folder-id>
//
// The folder ID is the string in the folder's URL:
//   https://drive.google.com/drive/folders/THIS_PART_HERE

require('dotenv').config();
const mongoose = require('mongoose');
const { google } = require('googleapis');
const connectDB = require('../config/db');
const Course = require('../models/Course');
const CourseDocument = require('../models/CourseDocument');

const rootFolderId = process.argv[2];

if (!rootFolderId) {
  console.error('Usage: node scripts/importDriveDocuments.js <drive-folder-id>');
  process.exit(1);
}
if (!process.env.GOOGLE_DRIVE_CLIENT_EMAIL || !process.env.GOOGLE_DRIVE_PRIVATE_KEY) {
  console.error('Missing GOOGLE_DRIVE_CLIENT_EMAIL / GOOGLE_DRIVE_PRIVATE_KEY in your .env.');
  process.exit(1);
}

const auth = new google.auth.JWT({
  email: process.env.GOOGLE_DRIVE_CLIENT_EMAIL,
  key: (process.env.GOOGLE_DRIVE_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
  scopes: ['https://www.googleapis.com/auth/drive.readonly'],
});
const drive = google.drive({ version: 'v3', auth });

// "CSC 201", "csc-201", "CSC201" all normalize to the same key.
const normalize = (s) => (s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

const CODE_PATTERN = /([A-Z]{2,4})\s*-?\s*(\d{3})/i;
const extractCode = (s) => {
  const m = (s || '').match(CODE_PATTERN);
  return m ? normalize(`${m[1]}${m[2]}`) : null;
};

// Handles pagination so a folder with more files than one page (100)
// doesn't silently lose anything past the first page.
async function listAll(query, fields) {
  let files = [];
  let pageToken;
  do {
    const res = await drive.files.list({
      q: query,
      fields: `nextPageToken, files(${fields})`,
      pageToken,
      pageSize: 100,
    });
    files = files.concat(res.data.files || []);
    pageToken = res.data.nextPageToken;
  } while (pageToken);
  return files;
}

// A Drive "shortcut" (e.g. one added via "Add shortcut to Drive" from
// someone else's shared folder) is its own file with its own ID — it is
// NOT the real folder, and has no children of its own, so listing "files
// in parents = <shortcut id>" silently returns nothing. This resolves a
// shortcut to whatever it actually points to (shortcutDetails.targetId),
// so it doesn't matter whether the ID you pass in is the shortcut's own
// ID or the real folder's — both work the same way.
async function resolveToRealId(fileId, label) {
  const res = await drive.files.get({
    fileId,
    fields: 'id, name, mimeType, shortcutDetails',
  });
  if (res.data.mimeType === 'application/vnd.google-apps.shortcut') {
    const targetId = res.data.shortcutDetails?.targetId;
    if (!targetId) {
      throw new Error(`"${res.data.name}" is a shortcut, but Drive didn't return what it points to.`);
    }
    console.log(`"${res.data.name}" (${label}) is a shortcut — following it to the real folder.`);
    return targetId;
  }
  return fileId;
}

// A shortcut is its own object (mimeType application/vnd.google-apps.shortcut)
// with no children of its own — querying its ID as if it were the real
// folder silently returns nothing. This resolves a shortcut to the real
// folder it points to (shortcutDetails.targetId) before anything else runs,
// so pointing this script at a shortcut just works instead of quietly
// finding zero files.
async function resolveFolderId(id) {
  let file;
  try {
    file = (await drive.files.get({
      fileId: id,
      fields: 'id, name, mimeType, shortcutDetails',
    })).data;
  } catch (error) {
    throw new Error(
      `Couldn't read folder ${id} (${error.message}). Usually means the service ` +
      `account doesn't have access to it yet — see the sharing step in the setup guide.`
    );
  }

  if (file.mimeType === 'application/vnd.google-apps.shortcut') {
    const target = file.shortcutDetails;
    if (!target || target.targetMimeType !== 'application/vnd.google-apps.folder') {
      throw new Error(`"${file.name}" is a shortcut, but it doesn't point to a folder.`);
    }
    console.log(
      `"${id}" is a shortcut named "${file.name}", pointing to a folder that isn't in your ` +
      `own Drive (real folder ID: ${target.targetId}). Using the real folder instead.`
    );
    console.log(
      `Note: resolving the shortcut only tells the script where to look — the service ` +
      `account still needs to be separately given access to that real folder, by whoever ` +
      `owns it, for this to actually work.\n`
    );
    return target.targetId;
  }

  if (file.mimeType !== 'application/vnd.google-apps.folder') {
    throw new Error(`"${file.name}" isn't a folder or a shortcut to one (it's ${file.mimeType}).`);
  }

  return id;
}

const run = async () => {
  await connectDB();

  let folderId;
  try {
    folderId = await resolveFolderId(rootFolderId);
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }


  const courses = await Course.find({}, 'course_code title');
  const courseByCode = new Map();
  for (const c of courses) courseByCode.set(normalize(c.course_code), c);
  console.log(`Loaded ${courses.length} courses from the database.\n`);

  const resolvedRootId = await resolveToRealId(rootFolderId, 'root folder');

  const matched = [];
  const skipped = [];

  // Step 1: subfolders of the root — one course each.
  const subfolders = await listAll(
    `'${resolvedRootId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`,
    'id, name'
  );
  console.log(`Found ${subfolders.length} subfolder(s) in the shared folder.`);

  for (const folder of subfolders) {
    const course = courseByCode.get(normalize(folder.name)) || courseByCode.get(extractCode(folder.name));
    if (!course) {
      skipped.push(`Folder "${folder.name}" doesn't match any course code.`);
      continue;
    }
    // Defensive: in case a course "subfolder" is itself another shortcut
    // rather than a real folder.
    const resolvedFolderId = await resolveToRealId(folder.id, folder.name);
    const files = await listAll(
      `'${resolvedFolderId}' in parents and mimeType!='application/vnd.google-apps.folder' and trashed=false`,
      'id, name, webViewLink'
    );
    for (const file of files) matched.push({ file, course });
  }

  // Step 2: files sitting directly in the root — match by filename.
  const rootFiles = await listAll(
    `'${resolvedRootId}' in parents and mimeType!='application/vnd.google-apps.folder' and trashed=false`,
    'id, name, webViewLink'
  );
  for (const file of rootFiles) {
    const course = courseByCode.get(extractCode(file.name));
    if (!course) {
      skipped.push(`File "${file.name}" (in the root folder) has no recognizable course code in its name.`);
      continue;
    }
    matched.push({ file, course });
  }

  // Step 3: import, skipping files already imported (by Drive link).
  let imported = 0;
  let alreadyPresent = 0;

  for (const { file, course } of matched) {
    const existing = await CourseDocument.findOne({ source_url: file.webViewLink });
    if (existing) {
      alreadyPresent += 1;
      continue;
    }

    await CourseDocument.create({
      course_id: course._id,
      title: file.name.replace(/\.[^/.]+$/, ''),
      content: `Imported from Google Drive — click "View on Google Drive" to open "${file.name}".`,
      source_type: 'google_drive',
      source_url: file.webViewLink,
    });
    imported += 1;
    console.log(`Imported: "${file.name}" -> ${course.course_code}`);
  }

  console.log(`\nDone. ${imported} document(s) imported, ${alreadyPresent} already present (skipped as duplicates).`);
  if (skipped.length) {
    console.log(`\n${skipped.length} item(s) could not be matched to a course:`);
    skipped.forEach((s) => console.log('  - ' + s));
  }

  await mongoose.connection.close();
  process.exit(0);
};

run().catch((error) => {
  console.error('Import failed:', error.message);
  process.exit(1);
});

