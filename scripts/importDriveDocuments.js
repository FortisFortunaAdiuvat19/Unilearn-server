// Imports course documents from a Google Drive folder into CourseDocument
// records. Doesn't download or store file contents — each document is
// saved as a link back to Drive (source_url), which Drive itself hosts
// and serves. Safe to re-run: files already imported (matched by their
// Drive link) are skipped rather than duplicated, so adding new files to
// the folder later and re-running only imports what's new.
//
// COURSE MATCHING — the part that needed a real design decision, not just
// code — walks the folder tree recursively, however deep it actually is:
//   1. At every folder encountered, check whether its NAME matches a
//      course code (e.g. "CSC 201", "csc-201", "CSC201" all match —
//      matching ignores case, spaces, and dashes). If it does, every file
//      anywhere underneath it (including in further subfolders like
//      "Lecture Notes" or "Week 1") is attributed to that course.
//   2. If a folder's name does NOT match a course (e.g. an organizational
//      folder like "200L"), it isn't treated as a course boundary — the
//      script just keeps descending into it looking for a match deeper in.
//   3. Any file that's never inside a matched course folder gets one more
//      chance: a course-code-shaped token is searched for in its filename
//      directly.
//   4. Anything that matches neither is skipped, not silently dropped —
//      the script prints exactly what it couldn't place and where, so you
//      can rename/move it in Drive and re-run.
// A course_id is required on every CourseDocument, so there's no concept
// of "import as unassigned" here — unmatched files just don't get
// imported until they're organized in a way the script can read.
//
// Usage (from unilearn-server/, with GOOGLE_DRIVE_CLIENT_EMAIL and
// GOOGLE_DRIVE_PRIVATE_KEY set in .env):
//   node scripts/importDriveDocuments.js <drive-folder-id-or-url>

require('dotenv').config();
const mongoose = require('mongoose');
const { google } = require('googleapis');
const connectDB = require('../config/db');
const Course = require('../models/Course');
const CourseDocument = require('../models/CourseDocument');

const rawFolderArg = process.argv[2];

if (!rawFolderArg) {
  console.error('Usage: node scripts/importDriveDocuments.js <drive-folder-id-or-url>');
  process.exit(1);
}
if (!process.env.GOOGLE_DRIVE_CLIENT_EMAIL || !process.env.GOOGLE_DRIVE_PRIVATE_KEY) {
  console.error('Missing GOOGLE_DRIVE_CLIENT_EMAIL / GOOGLE_DRIVE_PRIVATE_KEY in your .env.');
  process.exit(1);
}

// Accepts a bare ID, a full folder URL, or a pasted "Copy link" URL with
// its ?usp=... tracking parameter still attached.
function extractFolderId(input) {
  const withoutQuery = input.split('?')[0].replace(/\/$/, '');
  const urlMatch = withoutQuery.match(/\/folders\/([a-zA-Z0-9_-]+)/);
  if (urlMatch) return urlMatch[1];
  const parts = withoutQuery.split('/');
  return parts[parts.length - 1];
}

const rootFolderId = extractFolderId(rawFolderArg);
if (rootFolderId !== rawFolderArg) {
  console.log(`Using folder ID: ${rootFolderId} (extracted from what was pasted)`);
}

const auth = new google.auth.JWT({
  email: process.env.GOOGLE_DRIVE_CLIENT_EMAIL,
  key: (process.env.GOOGLE_DRIVE_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
  scopes: ['https://www.googleapis.com/auth/drive.readonly'],
});
const drive = google.drive({ version: 'v3', auth });

const FOLDER_MIME = 'application/vnd.google-apps.folder';
const SHORTCUT_MIME = 'application/vnd.google-apps.shortcut';

// "CSC 201", "csc-201", "CSC201" all normalize to the same key.
const normalize = (s) => (s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

const CODE_PATTERN = /([A-Z]{2,4})[\s_.-]*(\d{3})/i;
const extractCode = (s) => {
  const m = (s || '').match(CODE_PATTERN);
  return m ? normalize(`${m[1]}${m[2]}`) : null;
};

// Handles pagination so a folder with more items than one page (100)
// doesn't silently lose anything past the first page.
async function listChildren(folderId) {
  let items = [];
  let pageToken;
  do {
    const res = await drive.files.list({
      q: `'${folderId}' in parents and trashed=false`,
      fields: 'nextPageToken, files(id, name, mimeType, webViewLink, shortcutDetails)',
      pageToken,
      pageSize: 100,
    });
    items = items.concat(res.data.files || []);
    pageToken = res.data.nextPageToken;
  } while (pageToken);
  return items;
}

// A Drive "shortcut" (e.g. one added via "Add shortcut to Drive" from
// someone else's shared folder) is its own object with no children of its
// own — querying its ID as if it were the real folder silently returns
// nothing. This follows a shortcut to whatever it actually points to, so
// it doesn't matter whether an ID encountered anywhere in the tree is a
// shortcut or the real thing.
async function resolveId(fileId, label) {
  let file;
  try {
    file = (await drive.files.get({
      fileId,
      fields: 'id, name, mimeType, shortcutDetails',
    })).data;
  } catch (error) {
    throw new Error(
      `Couldn't read "${label}" (ID: ${fileId}) — ${error.message}. If this is the root ` +
      `folder, double check the service account's email has been added to its sharing settings.`
    );
  }
  if (file.mimeType === SHORTCUT_MIME) {
    const targetId = file.shortcutDetails?.targetId;
    if (!targetId) throw new Error(`"${file.name}" is a shortcut, but Drive didn't return what it points to.`);
    console.log(`"${file.name}" (${label}) is a shortcut — following it to the real item.`);
    return targetId;
  }
  return fileId;
}

// Once inside a folder that matched a course, every file underneath it —
// at any depth, through as many further subfolders as it takes — belongs
// to that course. No need for "Lecture Notes" or "Week 3" to match
// anything themselves.
async function collectAllFiles(folderId, course, path, matched, depth = 0) {
  if (depth > 8) return; // safety net against pathological nesting, not expected to ever hit
  const resolvedId = await resolveId(folderId, path);
  const children = await listChildren(resolvedId);
  for (const child of children) {
    if (child.mimeType === FOLDER_MIME || child.mimeType === SHORTCUT_MIME) {
      await collectAllFiles(child.id, course, `${path}/${child.name}`, matched, depth + 1);
    } else {
      matched.push({ file: child, course });
    }
  }
}

// The main search: walks down through folders that don't match a course
// yet, and once one does, hands off to collectAllFiles for everything
// below it.
async function walk(folderId, courseByCode, path, matched, skipped, depth = 0) {
  if (depth > 8) return; // safety net against pathological nesting
  const resolvedId = await resolveId(folderId, path);
  const children = await listChildren(resolvedId);

  for (const child of children) {
    const isFolder = child.mimeType === FOLDER_MIME || child.mimeType === SHORTCUT_MIME;
    const childPath = `${path}/${child.name}`;

    if (isFolder) {
      const course = courseByCode.get(normalize(child.name)) || courseByCode.get(extractCode(child.name));
      if (course) {
        await collectAllFiles(child.id, course, childPath, matched);
      } else {
        await walk(child.id, courseByCode, childPath, matched, skipped, depth + 1);
      }
    } else {
      const course = courseByCode.get(extractCode(child.name));
      if (course) {
        matched.push({ file: child, course });
      } else {
        skipped.push(`File "${child.name}" (in "${path}") has no recognizable course code.`);
      }
    }
  }
}

const run = async () => {
  await connectDB();

  const courses = await Course.find({}, 'course_code title');
  const courseByCode = new Map();
  for (const c of courses) courseByCode.set(normalize(c.course_code), c);
  console.log(`Loaded ${courses.length} courses from the database.\n`);

  const matched = [];
  const skipped = [];
  await walk(rootFolderId, courseByCode, 'root', matched, skipped);

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
