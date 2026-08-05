const express = require('express');
const router = express.Router();
const verifyToken = require('../middleware/auth');
const Course = require('../models/Course');
const CourseDocument = require('../models/CourseDocument');
const VideoResource = require('../models/VideoResource');
const Assessment = require('../models/Assessment');

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
