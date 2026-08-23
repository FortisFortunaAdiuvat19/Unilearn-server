const express = require('express');
const router = express.Router();
const verifyToken = require('../middleware/auth');
const requireAdmin = require('../middleware/requireAdmin');
const Course = require('../models/Course');
const CourseDocument = require('../models/CourseDocument');
const VideoResource = require('../models/VideoResource');
const Assessment = require('../models/Assessment');
const Enrollment = require('../models/Enrollment');

// POST /api/courses
// Admin-only. Previously there was no way to create a course at all —
// the catalog had to be inserted into MongoDB by hand.
router.post('/', verifyToken, requireAdmin, async (req, res) => {
  try {
    const {
      title, course_code, description, long_description, category,
      level, semester, difficulty, image_url, instructor_name,
      instructor_bio, duration_hours, modules, outcomes, tags, is_featured
    } = req.body;

    const course = new Course({
      title, course_code, description, long_description, category,
      level, semester, difficulty, image_url, instructor_name,
      instructor_bio, duration_hours, modules, outcomes, tags, is_featured,
      created_by_id: req.user.uid
    });

    await course.save();
    res.status(201).json(course);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// PUT /api/courses/:id
// Admin-only. Same field whitelist as creation — created_by_id is never
// touched by an edit.
router.put('/:id', verifyToken, requireAdmin, async (req, res) => {
  try {
    const {
      title, course_code, description, long_description, category,
      level, semester, difficulty, image_url, instructor_name,
      instructor_bio, duration_hours, modules, outcomes, tags, is_featured
    } = req.body;

    const course = await Course.findByIdAndUpdate(
      req.params.id,
      {
        title, course_code, description, long_description, category,
        level, semester, difficulty, image_url, instructor_name,
        instructor_bio, duration_hours, modules, outcomes, tags, is_featured
      },
      { new: true, runValidators: true }
    );

    if (!course) return res.status(404).json({ message: 'Course not found' });
    res.status(200).json(course);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// DELETE /api/courses/:id
// Admin-only. Also removes the course's own documents, videos, assessments,
// and enrollments, since none of those mean anything without the course.
// Result records (past test/exam attempts) are left alone on purpose —
// a course being removed from the catalog shouldn't erase a student's
// existing academic record, even if it ends up referencing a deleted
// assessment.
router.delete('/:id', verifyToken, requireAdmin, async (req, res) => {
  try {
    const course = await Course.findByIdAndDelete(req.params.id);
    if (!course) return res.status(404).json({ message: 'Course not found' });

    await Promise.all([
      CourseDocument.deleteMany({ course_id: req.params.id }),
      VideoResource.deleteMany({ course_id: req.params.id }),
      Assessment.deleteMany({ course_id: req.params.id }),
      Enrollment.deleteMany({ course_id: req.params.id }),
    ]);

    res.status(200).json({ message: 'Course deleted' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// GET /api/courses
router.get('/', async (req, res) => {
  try {
    const { featured, limit } = req.query;
    let query = {};
    if (featured === 'true') query.is_featured = true;

    let coursesQuery = Course.find(query).sort({ createdAt: -1 });
    if (limit) coursesQuery = coursesQuery.limit(parseInt(limit));

    const courses = await coursesQuery;
    res.status(200).json(courses);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// GET /api/courses/:id
router.get('/:id', async (req, res) => {
  try {
    const course = await Course.findById(req.params.id);
    if (!course) return res.status(404).json({ message: 'Course not found' });
    res.status(200).json(course);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// GET course materials
router.get('/:id/documents', async (req, res) => {
  try {
    const documents = await CourseDocument.find({ course_id: req.params.id });
    res.status(200).json(documents);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

router.get('/:id/videos', async (req, res) => {
  try {
    const videos = await VideoResource.find({ course_id: req.params.id });
    res.status(200).json(videos);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

router.get('/:id/assessments', async (req, res) => {
  try {
    const assessments = await Assessment.find({ course_id: req.params.id });
    res.status(200).json(assessments);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// POST /api/courses/:id/generate-content
// Protected route for AI generation
router.post('/:id/generate-content', verifyToken, async (req, res) => {
  try {
    // TODO: Initialize Google Generative AI (Gemini) SDK here.
    // Fetch course details, pass them as a prompt to Gemini, and save the 
    // returned JSON into CourseDocument, VideoResource, and Assessment collections.
    
    res.status(200).json({ message: 'Content generation initiated successfully.' });
  } catch (error) {
    res.status(500).json({ message: 'Failed to generate content' });
  }
});

module.exports = router;
