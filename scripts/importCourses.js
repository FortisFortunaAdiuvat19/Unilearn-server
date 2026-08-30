  // Imports the actual FUTO Computer Science curriculum — transcribed from
// department course-list photos — into the Course collection. Safe to
// re-run: each course is upserted by course_code, not blindly inserted, so
// running this again (e.g. after fixing a typo below) just updates the
// existing records rather than duplicating them.
//
// This intentionally does NOT invent descriptions, instructor names, or
// modules — the source photos only gave code, title, level, and semester.
// Those richer fields are left blank for now, to be filled in later
// (per-course editing, or the Gemini content generator) rather than faked.
//
// Usage (from unilearn-server/, with a real .env in place):
//   node scripts/importCourses.js <your-firebase-uid>
//
// The UID is only used for created_by_id attribution — this script does
// NOT grant admin access (unlike the original scripts/seed.js), since
// you already have an admin account at this point.

require('dotenv').config();
const mongoose = require('mongoose');
const connectDB = require('../config/db');
const Course = require('../models/Course');

const createdById = process.argv[2];

if (!createdById) {
  console.error('Usage: node scripts/importCourses.js <your-firebase-uid>');
  process.exit(1);
}

// Prefixes in the real curriculum that aren't in the Course model's
// category enum get mapped onto the closest real subject rather than
// extending the schema for one or two courses each. The course_code
// itself is untouched — only this internal grouping changes.
const CATEGORY_OVERRIDES = {
  COS: 'CSC',   // 100-level intro courses, same track as CSC 201+
  GET: 'ENG',   // Engineering Graphics
  ENS: 'GST',   // Entrepreneurship & Innovation
  IGB: 'GST',   // Igbo language elective
  FRN: 'GST',   // French language elective
  EGL: 'GST',   // Advanced Communication in English
};

const categoryFor = (code) => {
  const prefix = code.split(' ')[0];
  return CATEGORY_OVERRIDES[prefix] || prefix;
};

const difficultyFor = (level) => {
  if (level <= 200) return 'beginner';
  if (level === 300) return 'intermediate';
  return 'advanced';
};

// [course_code, title, level, semester, is_elective]
// semester: 1 = Harmattan, 2 = Rain
const CURRICULUM = [
  // ---- 100 Level — Harmattan ----
  ['COS 101', 'Introduction to Computing Sciences', 100, 1, false],
  ['GST 111', 'Communication in English', 100, 1, false],
  ['MTH 101', 'Elementary Mathematics I', 100, 1, false],
  ['PHY 101', 'General Physics I', 100, 1, false],
  ['PHY 107', 'General Practical Physics I', 100, 1, false],
  ['STA 111', 'Descriptive Statistics', 100, 1, false],
  ['CHM 101', 'General Chemistry I', 100, 1, false],
  ['CHM 107', 'General Chemistry Practical I', 100, 1, false],
  ['GST 103', 'Humanities', 100, 1, false],
  ['IGB 101', 'Introduction to Igbo Grammar, Composition and Comprehension', 100, 1, true],
  ['FRN 101', 'Communication in French I', 100, 1, true],

  // ---- 100 Level — Rain ----
  ['COS 102', 'Problem Solving', 100, 2, false],
  ['GST 112', 'Nigerian Peoples and Culture', 100, 2, false],
  ['MTH 102', 'Elementary Mathematics II', 100, 2, false],
  ['PHY 102', 'General Physics II', 100, 2, false],
  ['PHY 108', 'General Practical Physics II', 100, 2, false],
  ['GET 102', 'Engineering Graphics and Solid Modelling I', 100, 2, false],
  ['CHM 102', 'General Chemistry II', 100, 2, false],
  ['CHM 108', 'General Chemistry Practical II', 100, 2, false],
  ['STA 112', 'Probability I', 100, 2, false],
  ['EGL 102', 'Advanced Communication in English', 100, 2, false],
  ['IGB 102', 'Communication in Igbo Language', 100, 2, true],
  ['FRN 102', 'Communication in French II', 100, 2, true],

  // ---- 200 Level — Harmattan ----
  ['CSC 201', 'Computer and Applications I', 200, 1, false],
  ['CSC 203', 'Fundamentals of Cyber Security I', 200, 1, false],
  ['MTH 201', 'Mathematical Methods I', 200, 1, false],
  ['MTH 203', 'Elementary Differential Equations I', 200, 1, false],
  ['STA 211', 'Introduction to Statistics and Probability', 200, 1, false],
  ['PHY 201', 'Applied Electricity I', 200, 1, false],
  ['ENG 201', 'Workshop Practice III', 200, 1, false],
  ['GST 201', 'Social Science II', 200, 1, false],

  // ---- 200 Level — Rain ----
  ['CSC 202', 'Computer and Applications II', 200, 2, false],
  ['CIT 204', 'Computer Architecture and Organization I', 200, 2, false],
  ['CIT 202', 'Computer Programming I', 200, 2, false],
  ['MTH 202', 'Mathematical Methods II', 200, 2, false],
  ['CSC 204', 'Fundamentals of Cyber Security II', 200, 2, false],
  ['CSC 208', 'Introduction to Database Design and Applications', 200, 2, false],
  ['MTH 222', 'Numerical Methods', 200, 2, false],
  ['STA 212', 'Probability and Random Variables', 200, 2, false],

  // ---- 200 Level — SIWES ----
  ['SIW 200', 'SIWES', 200, 1, false],

  // ---- 300 Level — Harmattan ----
  ['CIT 301', 'Operating Systems I', 300, 1, false],
  ['CIT 303', 'System Analysis and Design', 300, 1, false],
  ['CSC 303', 'Computer Systems Laboratory', 300, 1, false],
  ['CSC 305', 'Data Structures and Algorithms', 300, 1, false],
  ['CSC 307', 'Structured Programming', 300, 1, false],
  ['CSC 309', 'Discrete Structures', 300, 1, false],
  ['PHY 303', 'Applied Electronics', 300, 1, false],
  ['CIT 305', 'Introduction to Software Engineering', 300, 1, false],
  ['ENS 301', 'Introduction to Entrepreneurship & Innovation I', 300, 1, false],
  ['MTH 303', 'Real Analysis I', 300, 1, true],
  ['STA 311', 'Introduction to Statistical Inference', 300, 1, true],
  ['CSC 311', 'Statistical Computing', 300, 1, true],

  // ---- 300 Level — Rain ----
  ['CSC 310', 'Operating System II', 300, 2, false],
  ['CSC 302', 'Computer Architecture and Organization II', 300, 2, false],
  ['CIT 304', 'Database Management Systems Design I', 300, 2, false],
  ['CIT 302', 'Computer Programming II', 300, 2, false],
  ['CIT 306', 'Web Design and Programming I', 300, 2, false],
  ['CSC 304', 'Compiler Construction I', 300, 2, false],
  ['CSC 306', 'Assembly and Machine Language Programming', 300, 2, false],
  ['ENS 302', 'Introduction to Entrepreneurship & Innovation II', 300, 2, false],
  ['CSC 308', 'Introduction to Theory of Computing', 300, 2, true],
  ['MTH 304', 'Real Analysis II', 300, 2, true],
  ['CSC 312', 'Object-Oriented Programming', 300, 2, true],

  // ---- 400 Level — Harmattan ----
  ['CSC 401', 'Survey of Programming Languages', 400, 1, false],
  ['CIT 401', 'Database Management Systems Design II', 400, 1, false],
  ['CSC 403', 'Computer Hardware Systems Design', 400, 1, false],
  ['CSC 405', 'Algorithms and Complexity Analysis', 400, 1, false],
  ['CSC 407', 'Computer and Society', 400, 1, false],
  ['CSC 409', 'Human Computer Interface Design', 400, 1, false],
  ['CSC 411', 'Computer Applications in Operations Research', 400, 1, false],
  ['CSC 415', 'Mobile Computing Systems Design', 400, 1, false],
  ['IFT 405', 'Research Methodology & Capstone Management', 400, 1, false],
  ['CSC 417', 'Embedded Systems and Firmware Design', 400, 1, true],
  ['CSC 419', 'Compiler Construction II', 400, 1, true],
  ['CSC 421', 'Database Systems Programming', 400, 1, true],
  ['CSC 423', 'Concurrent Systems Programming', 400, 1, true],
  ['CSC 413', 'Numerical Computations', 400, 1, true],
  ['STA 451', 'Design and Analysis of Experiments I', 400, 1, true],

  // ---- 400 Level — SIWES ----
  // No 400L Rain-semester course table was visible in the source photos —
  // only Harmattan, its electives, and SIWES were captured.
  ['SIW 400', 'Student Industrial Attachment', 400, 1, false],

  // ---- 500 Level — Harmattan ----
  ['CSC 501', 'Software Engineering', 500, 1, false],
  ['CSC 503', 'Information Systems Management', 500, 1, false],
  ['CSC 505', 'Algorithmic Techniques for Smart Systems', 500, 1, false],
  ['CSC 507', 'Data Communication Systems', 500, 1, false],
  ['CSC 509', 'Net-Centric Computing and Data Security', 500, 1, false],
  ['CSC 511', 'Artificial Intelligence', 500, 1, false],
  ['CSC 513', 'Data Mining & Big Data Analysis', 500, 1, false],
  ['CSC 555', 'Final Year Project', 500, 1, false],
  ['CSC 515', 'Microprocessor Architecture', 500, 1, true],
  ['CSC 517', 'Distributed Computing Systems Design', 500, 1, true],
  ['CSC 519', 'Special Topics in Information Technology', 500, 1, true],
  ['CSC 521', 'Organization of Programming Languages', 500, 1, true],
  ['STA 513', 'Sampling Theory and Survey Methods II', 500, 1, true],

  // ---- 500 Level — Rain ----
  ['CSC 502', 'Formal Models of Computation', 500, 2, false],
  ['CSC 504', 'Computer Graphics and Visualization', 500, 2, false],
  ['CSC 506', 'Computer Networks and Communications', 500, 2, false],
  ['CSC 508', 'System Performance Evaluation', 500, 2, false],
  ['CSC 510', 'Computer Modeling and Simulation', 500, 2, false],
  ['CSC 514', 'Special Topics in Software Engineering', 500, 2, false],
  ['CSC 512', 'The Internet of Things', 500, 2, false],
  ['CSC 556', 'Final Year Project', 500, 2, false],
];

const run = async () => {
  await connectDB();

  let created = 0;
  let updated = 0;

  for (const [course_code, title, level, semester, is_elective] of CURRICULUM) {
    const existing = await Course.findOne({ course_code });

    await Course.findOneAndUpdate(
      { course_code },
      {
        $set: {
          title,
          level,
          semester,
          category: categoryFor(course_code),
          difficulty: difficultyFor(level),
          tags: is_elective ? ['elective'] : [],
        },
        $setOnInsert: { created_by_id: createdById },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    if (existing) updated += 1;
    else created += 1;
  }

  console.log(`\nDone. ${created} course(s) created, ${updated} course(s) updated.`);
  console.log(`Total in curriculum list: ${CURRICULUM.length}`);

  await mongoose.connection.close();
  process.exit(0);
};

run().catch((error) => {
  console.error('Import failed:', error);
  process.exit(1);
});
