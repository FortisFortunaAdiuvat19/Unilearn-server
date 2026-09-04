// Generates modules for every (course, week) pair across the catalogue,
// instead of clicking "Generate" one at a time in the admin UI. Safe to
// re-run and safe to interrupt: already-'ready' modules are skipped by
// default, and Ctrl+C marks whatever's mid-generation as 'failed' (with
// a clear reason) rather than leaving it stuck in 'generating' forever
// with no retry path in the UI.
//
// Usage (from unilearn-server/, with a real .env in place):
//   node scripts/generateAllModules.js
//   node scripts/generateAllModules.js --course=CSC305
//   node scripts/generateAllModules.js --limit=20
//   node scripts/generateAllModules.js --dry-run
//   node scripts/generateAllModules.js --skip-failed
//   node scripts/generateAllModules.js --only-failed
//   node scripts/generateAllModules.js --delay=5
//
// Flags:
//   --course=CODE    Only this course (matches course_code, e.g. CSC305 or "CSC 305").
//   --limit=N        Stop after generating N modules in this run (across
//                     however many courses it takes to reach that count).
//   --delay=N        Seconds to wait between modules. Default 2.
//   --skip-failed    Don't retry modules already marked 'failed' (default:
//                     do retry them, since most failures are transient —
//                     a bad API response, a quota hiccup — not persistent).
//   --only-failed    Only retry 'failed' modules; skip 'not_generated' ones.
//   --dry-run        Print what would be generated without calling any
//                     API or writing to the database.

require('dotenv').config();
const mongoose = require('mongoose');
const connectDB = require('../config/db');
const Course = require('../models/Course');
const Module = require('../models/Module');
const { generateModuleCards } = require('../services/moduleGeneration');

const args = process.argv.slice(2).reduce((acc, arg) => {
  const [key, value] = arg.replace(/^--/, '').split('=');
  acc[key] = value ?? true;
  return acc;
}, {});

const COURSE_FILTER = args.course ? String(args.course).replace(/\s+/g, '').toUpperCase() : null;
const LIMIT = args.limit ? parseInt(args.limit, 10) : Infinity;
const DELAY_SECONDS = args.delay ? parseInt(args.delay, 10) : 2;
const SKIP_FAILED = !!args['skip-failed'];
const ONLY_FAILED = !!args['only-failed'];
const DRY_RUN = !!args['dry-run'];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const shouldProcess = (status) => {
  if (status === 'ready') return false;
  if (status === 'generating') return true; // stuck from a prior crash — worth retrying
  if (status === 'failed') return !SKIP_FAILED;
  return !ONLY_FAILED; // 'not_generated'
};

let current = null; // { course_id, week_index } of whatever's mid-generation, for the interrupt handler

async function markInterrupted() {
  if (!current) return;
  try {
    await Module.findOneAndUpdate(
      { course_id: current.course_id, week_index: current.week_index },
      { $set: { status: 'failed', error_message: 'Interrupted by script shutdown (Ctrl+C) — safe to retry.' } },
      { upsert: true }
    );
  } catch {
    // Best effort — if this also fails, the module is left in
    // 'generating' and the next run's summary should call it out.
  }
}

process.on('SIGINT', async () => {
  console.log('\n\nInterrupted — marking the in-progress module as failed so it can be retried...');
  await markInterrupted();
  console.log('Done. Re-run the script to pick up where this left off.');
  process.exit(130);
});

const run = async () => {
  await connectDB();

  const courseQuery = COURSE_FILTER ? {} : {};
  const allCourses = await Course.find(courseQuery).select('title course_code scheme_of_work');
  const courses = COURSE_FILTER
    ? allCourses.filter((c) => c.course_code.replace(/\s+/g, '').toUpperCase() === COURSE_FILTER)
    : allCourses;

  if (COURSE_FILTER && courses.length === 0) {
    console.log(`No course found matching "${args.course}".`);
    await mongoose.connection.close();
    process.exit(1);
  }

  // One query for every existing Module document, rather than one query
  // per (course, week) pair — this could otherwise be a thousand-plus
  // round trips before a single module is even generated.
  const existingModules = await Module.find({}).select('course_id week_index status');
  const statusByKey = new Map(existingModules.map((m) => [`${m.course_id}:${m.week_index}`, m.status]));

  // Build the full worklist up front so --limit and progress counters
  // ("12/340") mean something concrete rather than an unknown total.
  const worklist = [];
  for (const course of courses) {
    (course.scheme_of_work || []).forEach((sow, weekIndex) => {
      const status = statusByKey.get(`${course._id}:${weekIndex}`) || 'not_generated';
      if (shouldProcess(status)) {
        worklist.push({ course, sow, weekIndex, previousStatus: status });
      }
    });
  }

  console.log(`Found ${worklist.length} module(s) to process${LIMIT !== Infinity ? ` (capped at ${LIMIT} this run)` : ''}.`);
  if (DRY_RUN) console.log('Dry run — no API calls or database writes will be made.\n');
  console.log('');

  const toRun = worklist.slice(0, LIMIT);
  const results = { ready: 0, failed: 0, skipped: worklist.length - toRun.length };
  const failures = [];
  const startedAt = Date.now();

  for (let i = 0; i < toRun.length; i++) {
    const { course, sow, weekIndex, previousStatus } = toRun[i];
    const label = `[${i + 1}/${toRun.length}] ${course.course_code} — ${sow.week}: ${sow.topic}`;

    if (DRY_RUN) {
      console.log(`${label} (currently: ${previousStatus})`);
      continue;
    }

    console.log(label);
    current = { course_id: course._id, week_index: weekIndex };
    const moduleStartedAt = Date.now();

    try {
      await Module.findOneAndUpdate(
        { course_id: course._id, week_index: weekIndex },
        { $set: { topic: sow.topic, status: 'generating', error_message: null } },
        { upsert: true, setDefaultsOnInsert: true }
      );

      const cards = await generateModuleCards(course, sow);

      await Module.findOneAndUpdate(
        { course_id: course._id, week_index: weekIndex },
        { $set: { cards, status: 'ready', generated_at: new Date(), error_message: null } }
      );

      const elapsed = ((Date.now() - moduleStartedAt) / 1000).toFixed(1);
      console.log(`  -> ready (${cards.length} cards, ${elapsed}s)`);
      results.ready += 1;
    } catch (error) {
      await Module.findOneAndUpdate(
        { course_id: course._id, week_index: weekIndex },
        { $set: { status: 'failed', error_message: error.message } },
        { upsert: true }
      );
      console.log(`  -> FAILED: ${error.message}`);
      results.failed += 1;
      failures.push(`${course.course_code} — ${sow.week}: ${sow.topic} (${error.message})`);
    }

    current = null;

    if (i < toRun.length - 1) {
      await sleep(DELAY_SECONDS * 1000);
    }
  }

  const totalMinutes = ((Date.now() - startedAt) / 60000).toFixed(1);
  console.log('\n' + '='.repeat(60));
  console.log(`Done in ${totalMinutes} minute(s).`);
  console.log(`  Ready:   ${results.ready}`);
  console.log(`  Failed:  ${results.failed}`);
  console.log(`  Skipped: ${results.skipped} (already ready, or excluded by --skip-failed/--only-failed)`);
  if (failures.length) {
    console.log('\nFailed modules (re-run the script to retry these automatically):');
    failures.forEach((f) => console.log(`  - ${f}`));
  }

  await mongoose.connection.close();
  process.exit(results.failed > 0 ? 1 : 0);
};

run().catch(async (error) => {
  console.error('Script failed:', error.message);
  await markInterrupted();
  process.exit(1);
});
