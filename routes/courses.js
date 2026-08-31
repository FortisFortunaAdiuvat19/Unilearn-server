const express = require('express');
const router = express.Router();
const verifyToken = require('../middleware/auth');
const requireAdmin = require('../middleware/requireAdmin');
const Course = require('../models/Course');
const CourseDocument = require('../models/CourseDocument');
const VideoResource = require('../models/VideoResource');
const Assessment = require('../models/Assessment');
const Enrollment = require('../models/Enrollment');
const gemini = require('../config/gemini');

// Overridable via env in case you want to try a newer/cheaper model later
// without touching code.
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3.6-flash';

// We deliberately never ask Gemini for direct YouTube video URLs — a
// language model has no reliable way to know a specific video ID actually
// exists, and a confident-looking dead link is worse than none. Instead we
// ask for good search topics and build a real YouTube search URL, which
// always resolves to something relevant and never 404s.
const YOUTUBE_SEARCH_BASE = 'https://www.youtube.com/results?search_query=';

const CONTENT_SCHEMA = {
  type: 'object',
  properties: {
    documents: {
      type: 'array',
      description: 'Two or three short study notes, each covering a distinct part of the course.',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          topic: { type: 'string', description: 'The specific sub-topic this note covers.' },
          content: { type: 'string', description: 'The note itself, 200-500 words, in markdown.' },
        },
        required: ['title', 'topic', 'content'],
      },
    },
    video_topics: {
      type: 'array',
      description: 'Three or four specific topics within the course worth watching a video on.',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'A short, specific topic name, suitable as a YouTube search query.' },
          description: { type: 'string' },
        },
        required: ['title', 'description'],
      },
    },
    assessment: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        objective_questions: {
          type: 'array',
          description: 'Five to eight multiple-choice questions, each with exactly 4 options.',
          items: {
            type: 'object',
            properties: {
              question: { type: 'string' },
              options: { type: 'array', items: { type: 'string' } },
              correct_index: { type: 'integer', description: '0-based index into options of the correct answer.' },
            },
            required: ['question', 'options', 'correct_index'],
          },
        },
      },
      required: ['title', 'objective_questions'],
    },
  },
  required: ['documents', 'video_topics', 'assessment'],
};

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

// POST /api/courses/:id/videos
// Admin-only. Previously the only way a VideoResource got created was the
// Gemini generator's bulk insert — no manual "add this specific video" path.
router.post('/:id/videos', verifyToken, requireAdmin, async (req, res) => {
  try {
    const { title, url, description, duration_minutes } = req.body;
    if (!title || !url) {
      return res.status(400).json({ message: 'Title and URL are required.' });
    }
    const video = await VideoResource.create({
      course_id: req.params.id,
      title,
      url,
      description: description || '',
      duration_minutes: duration_minutes || undefined,
    });
    res.status(201).json(video);
  } catch (error) {
    res.status(400).json({ message: error.message });
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
// Admin-only. Asks Gemini for study notes, video search topics, and a
// practice test scoped to this course, then saves the results into
// CourseDocument, VideoResource, and Assessment. Each run adds a new batch
// on top of whatever's already there — it doesn't replace prior content.
router.post('/:id/generate-content', verifyToken, requireAdmin, async (req, res) => {
  if (!process.env.GEMINI_API_KEY) {
    return res.status(503).json({
      message: 'Content generation is not configured. Add GEMINI_API_KEY to the server environment.'
    });
  }

  try {
    const course = await Course.findById(req.params.id);
    if (!course) return res.status(404).json({ message: 'Course not found' });

    const moduleList = (course.modules || []).map((m) => `- ${m.title}`).join('\n') || '(no modules listed yet)';
    const prompt = `You are helping build the study guide for a university course.

Course: ${course.title} (${course.course_code})
Category: ${course.category}, Level ${course.level}
Description: ${course.description || course.long_description || 'N/A'}
Existing modules:
${moduleList}

Generate supporting study material scoped to this course: a few short study
notes, a few specific video-worthy topics, and one short multiple-choice
practice test.`;

    const response = await gemini.models.generateContent({
      model: GEMINI_MODEL,
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
        responseSchema: CONTENT_SCHEMA,
      },
    });

    const parsed = JSON.parse(response.text);

    const documents = await CourseDocument.insertMany(
      (parsed.documents || []).map((d) => ({
        course_id: course._id,
        title: d.title,
        topic: d.topic,
        content: d.content,
        source_type: 'generated',
      }))
    );

    const videos = await VideoResource.insertMany(
      (parsed.video_topics || []).map((v) => ({
        course_id: course._id,
        title: v.title,
        description: v.description,
        url: `${YOUTUBE_SEARCH_BASE}${encodeURIComponent(`${v.title} ${course.title}`)}`,
      }))
    );

    let assessment = null;
    if (parsed.assessment?.objective_questions?.length) {
      assessment = await Assessment.create({
        course_id: course._id,
        title: parsed.assessment.title || `${course.title} — Practice Test`,
        type: 'test',
        objective_questions: parsed.assessment.objective_questions.map((q) => ({
          question: q.question,
          options: q.options,
          correct_option: q.correct_index,
        })),
        theory_questions: [],
      });
    }

    res.status(200).json({
      message: 'Content generated successfully.',
      documents_created: documents.length,
      videos_created: videos.length,
      assessment_created: !!assessment,
    });
  } catch (error) {
    console.error('Content generation error:', error);
    res.status(500).json({ message: 'Failed to generate content: ' + error.message });
  }
});

module.exports = router;
