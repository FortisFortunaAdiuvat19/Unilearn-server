// One-time / re-runnable script to get a usable local database:
//   1. Promotes a given Firebase UID to 'admin' (creating the User record
//      if it doesn't exist yet), so you can actually reach /admin/create-course.
//   2. Upserts a handful of sample courses so there's something to browse,
//      enroll in, and chat about.
//   3. Upserts two sample assessments so the test/exam flow has something
//      real to submit against.
//
// Usage (from unilearn-server/, with a real .env in place):
//   node scripts/seed.js <your-firebase-uid>
//
// Safe to re-run — courses/assessments are upserted by a stable key, not
// blindly re-inserted.

require('dotenv').config();
const mongoose = require('mongoose');
const connectDB = require('../config/db');
const User = require('../models/User');
const Course = require('../models/Course');
const Assessment = require('../models/Assessment');

const adminUid = process.argv[2];

if (!adminUid) {
  console.error('Usage: node scripts/seed.js <your-firebase-uid>');
  console.error('Find your UID in the Firebase console, or log in once and check the User collection.');
  process.exit(1);
}

const courses = [
  {
    course_code: 'CSC 101',
    title: 'Introduction to Computer Science',
    category: 'CSC',
    level: 100,
    semester: 1,
    difficulty: 'beginner',
    description: 'Foundations of computing: how computers represent and process information.',
    long_description: 'Covers number systems, basic logic gates, an introduction to algorithms, and a first look at a programming language. No prior programming experience assumed.',
    instructor_name: 'Dr. A. Okafor',
    duration_hours: 30,
    outcomes: ['Explain how a computer represents data', 'Write and trace simple algorithms', 'Recognize basic logic gate behavior'],
    tags: ['fundamentals', 'intro'],
    is_featured: true,
    modules: [
      { title: 'Number Systems', description: 'Binary, octal, and hexadecimal representation.', duration_minutes: 45, content_type: 'video' },
      { title: 'Intro to Algorithms', description: 'What an algorithm is, and how to describe one with pseudocode.', duration_minutes: 40, content_type: 'text' },
      { title: 'Logic Gates', description: 'AND, OR, NOT, and how they combine.', duration_minutes: 35, content_type: 'video' },
    ],
  },
  {
    course_code: 'CSC 201',
    title: 'Data Structures and Algorithms',
    category: 'CSC',
    level: 200,
    semester: 1,
    difficulty: 'intermediate',
    description: 'Core data structures and the algorithms that operate on them.',
    long_description: 'Arrays, linked lists, stacks, queues, trees, and an introduction to Big-O analysis, with implementation exercises.',
    instructor_name: 'Dr. C. Nwosu',
    duration_hours: 45,
    outcomes: ['Implement common data structures', 'Analyze time complexity with Big-O', 'Choose the right structure for a problem'],
    tags: ['data structures', 'algorithms'],
    is_featured: true,
    modules: [
      { title: 'Arrays & Complexity', description: 'Array operations and an intro to Big-O notation.', duration_minutes: 50, content_type: 'video' },
      { title: 'Linked Lists', description: 'Singly and doubly linked lists.', duration_minutes: 45, content_type: 'exercise' },
      { title: 'Stacks & Queues', description: 'LIFO/FIFO structures and where each is used.', duration_minutes: 40, content_type: 'video' },
      { title: 'Trees', description: 'Binary trees and traversal.', duration_minutes: 55, content_type: 'text' },
    ],
  },
  {
    course_code: 'CSC 205',
    title: 'Object-Oriented Programming',
    category: 'CSC',
    level: 200,
    semester: 2,
    difficulty: 'intermediate',
    description: 'OOP principles through a modern language: classes, inheritance, polymorphism.',
    long_description: 'Builds on CSC 101/201 to introduce object-oriented design: encapsulation, inheritance, polymorphism, and interfaces, with a small project.',
    instructor_name: 'Dr. A. Okafor',
    duration_hours: 40,
    outcomes: ['Design classes with clear responsibilities', 'Apply inheritance and polymorphism correctly', 'Build a small OOP project'],
    tags: ['oop', 'software design'],
    modules: [
      { title: 'Classes & Objects', description: 'Encapsulation and constructors.', duration_minutes: 40, content_type: 'video' },
      { title: 'Inheritance', description: 'Extending classes and overriding behavior.', duration_minutes: 45, content_type: 'text' },
      { title: 'Polymorphism & Interfaces', description: 'Designing around shared behavior.', duration_minutes: 40, content_type: 'exercise' },
    ],
  },
  {
    course_code: 'CSC 301',
    title: 'Database Management Systems',
    category: 'CSC',
    level: 300,
    semester: 1,
    difficulty: 'intermediate',
    description: 'Relational database design, SQL, and normalization.',
    long_description: 'Entity-relationship modeling, relational algebra, SQL from basics through joins and subqueries, and normalization up to 3NF.',
    instructor_name: 'Dr. F. Balogun',
    duration_hours: 42,
    outcomes: ['Design a normalized relational schema', 'Write SQL queries with joins and aggregation', 'Explain ACID properties'],
    tags: ['databases', 'sql'],
    is_featured: true,
    modules: [
      { title: 'ER Modeling', description: 'Entities, relationships, and cardinality.', duration_minutes: 40, content_type: 'video' },
      { title: 'SQL Fundamentals', description: 'SELECT, INSERT, UPDATE, DELETE, and joins.', duration_minutes: 60, content_type: 'exercise' },
      { title: 'Normalization', description: '1NF through 3NF, with worked examples.', duration_minutes: 45, content_type: 'text' },
    ],
  },
  {
    course_code: 'CSC 307',
    title: 'Web Technologies',
    category: 'CSC',
    level: 300,
    semester: 2,
    difficulty: 'intermediate',
    description: 'Client-server architecture, HTTP, and building web applications.',
    long_description: 'HTML/CSS/JS fundamentals, the HTTP request/response cycle, REST APIs, and an introduction to a modern frontend framework.',
    instructor_name: 'Dr. C. Nwosu',
    duration_hours: 48,
    outcomes: ['Explain the HTTP request/response cycle', 'Build a REST API', 'Build a basic frontend that consumes it'],
    tags: ['web', 'rest', 'javascript'],
    modules: [
      { title: 'HTTP & Client-Server Basics', description: 'Requests, responses, status codes.', duration_minutes: 35, content_type: 'video' },
      { title: 'Building a REST API', description: 'Routes, controllers, and JSON responses.', duration_minutes: 55, content_type: 'exercise' },
      { title: 'Consuming APIs from the Frontend', description: 'Fetching and rendering data.', duration_minutes: 45, content_type: 'exercise' },
    ],
  },
  {
    course_code: 'MTH 201',
    title: 'Discrete Mathematics',
    category: 'MTH',
    level: 200,
    semester: 1,
    difficulty: 'intermediate',
    description: 'The mathematical foundations behind algorithms and computer science.',
    long_description: 'Set theory, logic and proofs, combinatorics, and an introduction to graph theory, with an emphasis on applications to computing.',
    instructor_name: 'Dr. I. Eze',
    duration_hours: 36,
    outcomes: ['Construct basic mathematical proofs', 'Apply combinatorics to counting problems', 'Reason about graphs and trees'],
    tags: ['mathematics', 'theory'],
    modules: [
      { title: 'Sets & Logic', description: 'Set operations, propositional logic.', duration_minutes: 40, content_type: 'text' },
      { title: 'Proof Techniques', description: 'Direct proof, contradiction, and induction.', duration_minutes: 45, content_type: 'video' },
      { title: 'Graph Theory Basics', description: 'Vertices, edges, and common graph problems.', duration_minutes: 40, content_type: 'text' },
    ],
  },
];

const buildAssessments = (courseIdByCode) => [
  {
    course_id: courseIdByCode['CSC 201'],
    title: 'Data Structures Midterm Test',
    type: 'test',
    description: 'Covers arrays, linked lists, stacks, and queues.',
    objective_questions: [
      { question: 'What is the time complexity of accessing an element by index in an array?', options: ['O(1)', 'O(n)', 'O(log n)', 'O(n^2)'], correct_option: 0 },
      { question: 'Which structure follows Last-In-First-Out (LIFO) order?', options: ['Queue', 'Stack', 'Linked List', 'Array'], correct_option: 1 },
      { question: 'What is the main advantage of a linked list over an array for insertion?', options: ['Faster indexing', 'No insertion cost', 'No need to shift elements', 'Uses less memory always'], correct_option: 2 },
      { question: 'Which structure follows First-In-First-Out (FIFO) order?', options: ['Stack', 'Queue', 'Tree', 'Graph'], correct_option: 1 },
    ],
    theory_questions: [],
  },
  {
    course_id: courseIdByCode['CSC 301'],
    title: 'Database Systems Final Exam',
    type: 'exam',
    description: 'Covers SQL, normalization, and relational design.',
    objective_questions: [
      { question: 'Which SQL clause is used to filter rows before grouping?', options: ['HAVING', 'WHERE', 'GROUP BY', 'ORDER BY'], correct_option: 1 },
      { question: 'A table in Third Normal Form (3NF) has no...', options: ['Primary key', 'Transitive dependencies', 'Foreign keys', 'Indexes'], correct_option: 1 },
      { question: 'Which SQL join returns only matching rows from both tables?', options: ['LEFT JOIN', 'RIGHT JOIN', 'INNER JOIN', 'FULL OUTER JOIN'], correct_option: 2 },
    ],
    theory_questions: [
      { question: 'Explain the difference between a primary key and a foreign key, with an example.', sample_answer: 'A primary key uniquely identifies each row in its own table; a foreign key is a column that references a primary key in another table to establish a relationship, e.g. a student_id column in an Enrollments table referencing the Students table.', max_marks: 10 },
      { question: 'Describe one real-world scenario where denormalizing a database might be a reasonable trade-off.', sample_answer: 'A read-heavy reporting dashboard might denormalize to avoid expensive joins on every query, trading some redundancy and update complexity for faster reads.', max_marks: 10 },
    ],
  },
];

const run = async () => {
  await connectDB();

  const user = await User.findByIdAndUpdate(
    adminUid,
    { $set: { role: 'admin' } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
  console.log(`Admin ready: ${user._id} (role: ${user.role})`);

  const courseIdByCode = {};
  for (const c of courses) {
    const saved = await Course.findOneAndUpdate(
      { course_code: c.course_code },
      { $set: { ...c, created_by_id: adminUid } },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    courseIdByCode[c.course_code] = saved._id;
    console.log(`Course ready: ${saved.course_code} — ${saved.title} (${saved._id})`);
  }

  const assessments = buildAssessments(courseIdByCode);
  for (const a of assessments) {
    const saved = await Assessment.findOneAndUpdate(
      { course_id: a.course_id, title: a.title },
      { $set: a },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    console.log(`Assessment ready: ${saved.title} (${saved._id})`);
  }

  console.log('\nSeed complete.');
  await mongoose.connection.close();
  process.exit(0);
};

run().catch((error) => {
  console.error('Seed failed:', error);
  process.exit(1);
});
