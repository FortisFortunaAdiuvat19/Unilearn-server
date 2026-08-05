const express = require('express');
const router = express.Router();
const verifyToken = require('../middleware/auth');
const Enrollment = require('../models/Enrollment');

// GET /api/enrollments (All enrollments - used by StudyGroups to match peers)
router.get('/', verifyToken, async (req, res) => {
  try {
    const enrollments = await Enrollment.find().sort({ createdAt: -1 });
    res.status(200).json(enrollments);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// GET /api/enrollments/me (Current user's enrollments)
router.get('/me', verifyToken, async (req, res) => {
  try {
    const enrollments = await Enrollment.find({ student_id: req.user.uid }).sort({ createdAt: -1 });
    res.status(200).json(enrollments);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// GET /api/enrollments/course/:courseId (Check specific enrollment)
router.get('/course/:courseId', verifyToken, async (req, res) => {
  try {
    const enrollment = await Enrollment.findOne({ 
      student_id: req.user.uid, 
      course_id: req.params.courseId 
    });
    if (!enrollment) return res.status(404).json({ message: 'Not enrolled' });
    res.status(200).json(enrollment);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// POST /api/enrollments (Enroll in a course)
router.post('/', verifyToken, async (req, res) => {
  try {
    const { course_id } = req.body;
    
    const existing = await Enrollment.findOne({ student_id: req.user.uid, course_id });
    if (existing) return res.status(400).json({ message: 'Already enrolled' });

    const enrollment = new Enrollment({
      student_id: req.user.uid,
      course_id,
      progress: 0,
      status: 'active',
      completed_modules: []
    });

    await enrollment.save();
    res.status(201).json(enrollment);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// PUT /api/enrollments/:id (Update progress)
router.put('/:id', verifyToken, async (req, res) => {
  try {
    const { progress, completed_modules, status } = req.body;
    
    const enrollment = await Enrollment.findOneAndUpdate(
      { _id: req.params.id, student_id: req.user.uid },
      { 
        progress, 
        completed_modules, 
        status, 
        last_accessed: Date.now() 
      },
      { new: true }
    );

    if (!enrollment) return res.status(404).json({ message: 'Enrollment not found' });
    res.status(200).json(enrollment);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;
