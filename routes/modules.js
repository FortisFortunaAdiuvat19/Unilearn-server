const express = require('express');
const router = express.Router({ mergeParams: true });
const verifyToken = require('../middleware/auth');
const requireAdmin = require('../middleware/requireAdmin');
const Course = require('../models/Course');
const Module = require('../models/Module');
const { generateModuleCards } = require('../services/moduleGeneration');

// GET /api/courses/:courseId/modules
// Lightweight list for the module-overview page: merges the course's
// scheme of work with whatever Module documents already exist, so weeks
// that haven't been generated yet still show up (as not_generated)
// rather than being invisible.
router.get('/', verifyToken, async (req, res) => {
  try {
    const course = await Course.findById(req.params.courseId);
    if (!course) return res.status(404).json({ message: 'Course not found' });

    const existing = await Module.find({ course_id: course._id }).select('week_index topic status cards');
    const byWeek = new Map(existing.map((m) => [m.week_index, m]));

    const modules = (course.scheme_of_work || []).map((sow, i) => {
      const m = byWeek.get(i);
      return {
        week_index: i,
        week: sow.week,
        topic: sow.topic,
        status: m?.status || 'not_generated',
        card_count: m?.cards?.length || 0,
      };
    });

    res.status(200).json({ modules });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// GET /api/courses/:courseId/modules/:weekIndex
// Full card content for the actual viewer.
router.get('/:weekIndex', verifyToken, async (req, res) => {
  try {
    const weekIndex = parseInt(req.params.weekIndex, 10);
    const courseModule = await Module.findOne({ course_id: req.params.courseId, week_index: weekIndex });
    if (!courseModule || courseModule.status !== 'ready') {
      return res.status(404).json({ message: 'This module has not been generated yet.' });
    }
    res.status(200).json(courseModule);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// POST /api/courses/:courseId/modules/:weekIndex/generate
// Admin-only. The actual pipeline: research with search grounding,
// structure into cards, attach a video per card, save.
router.post('/:weekIndex/generate', verifyToken, requireAdmin, async (req, res) => {
  if (!process.env.GEMINI_API_KEY) {
    return res.status(503).json({
      message: 'Content generation is not configured. Add GEMINI_API_KEY to the server environment.'
    });
  }

  try {
    const weekIndex = parseInt(req.params.weekIndex, 10);
    const course = await Course.findById(req.params.courseId);
    if (!course) return res.status(404).json({ message: 'Course not found' });

    const sow = (course.scheme_of_work || [])[weekIndex];
    if (!sow) return res.status(400).json({ message: 'No scheme-of-work entry at that week index.' });

    // Upsert into 'generating' immediately so the overview page can show
    // real progress rather than looking identical to not-yet-started.
    let courseModule = await Module.findOneAndUpdate(
      { course_id: course._id, week_index: weekIndex },
      { $set: { topic: sow.topic, status: 'generating', error_message: null } },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    // Existing course documents are real source material, not just
    // web-researched content — folded into the research prompt so the
    // model builds on what's already been curated for this course.
    const finalCards = await generateModuleCards(course, sow);

    courseModule = await Module.findOneAndUpdate(
      { course_id: course._id, week_index: weekIndex },
      { $set: { cards: finalCards, status: 'ready', generated_at: new Date(), error_message: null } },
      { new: true }
    );

    res.status(200).json(courseModule);
  } catch (error) {
    await Module.findOneAndUpdate(
      { course_id: req.params.courseId, week_index: parseInt(req.params.weekIndex, 10) },
      { $set: { status: 'failed', error_message: error.message } },
      { upsert: true }
    );
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;
