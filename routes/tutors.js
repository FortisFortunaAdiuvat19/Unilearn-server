const express = require('express');
const router = express.Router();
const verifyToken = require('../middleware/auth');
const TutorProfile = require('../models/TutorProfile');
const TutorReview = require('../models/TutorReview');
const Result = require('../models/Result');
const User = require('../models/User');
const Course = require('../models/Course');
const ChatRoom = require('../models/ChatRoom');

// Must score at least this well on one of a course's assessments before
// you're allowed to register as a tutor for it.
const MIN_TUTOR_KNOWLEDGE_PERCENT = 70;
// Floor for showing up in a course's tutor listing at all (3 stars = 60%+).
const MIN_KNOWLEDGE_RATING_TO_LIST = 3;
// Neutral starting point for a tutor with no reviews yet, so a new tutor
// isn't unfairly ranked at the bottom just for lack of history.
const DEFAULT_REVIEW_RATING = 3;

// Weighted blend for the overall match score. Knowledge counts most since
// it's the most direct, course-specific signal; reviews next; availability
// least — it's already used as a hard filter (only tutors with
// is_available: true are listed at all), so its star here just
// differentiates by how much schedule they've actually shared.
const KNOWLEDGE_WEIGHT = 0.45;
const REVIEW_WEIGHT = 0.35;
const AVAILABILITY_WEIGHT = 0.20;

const percentToStars = (percent) => Math.max(1, Math.min(5, Math.round(percent / 20)));

const availabilityStars = (weeklyAvailability) => {
  const slots = (weeklyAvailability || []).length;
  if (slots >= 3) return 5;
  if (slots >= 1) return 4;
  return 3;
};

// Shared by the route below and by routes/recommendations.js, so the
// "connect with a tutor" suggestion there uses the exact same ranking.
const getRankedTutors = async (courseId) => {
  const profiles = await TutorProfile.find({
    is_available: true,
    courses: { $elemMatch: { course_id: courseId, knowledge_rating: { $gte: MIN_KNOWLEDGE_RATING_TO_LIST } } },
  });

  if (profiles.length === 0) return [];

  const tutorIds = profiles.map((p) => p._id);
  const [users, reviews] = await Promise.all([
    User.find({ _id: { $in: tutorIds } }),
    TutorReview.find({ tutor_id: { $in: tutorIds } }),
  ]);
  const userById = new Map(users.map((u) => [u._id, u]));

  const tutors = profiles.map((profile) => {
    const courseEntry = profile.courses.find((c) => c.course_id.toString() === courseId);
    const tutorReviews = reviews.filter((r) => r.tutor_id === profile._id);
    const review_rating = tutorReviews.length
      ? tutorReviews.reduce((sum, r) => sum + r.rating, 0) / tutorReviews.length
      : DEFAULT_REVIEW_RATING;
    const availability_rating = availabilityStars(profile.weekly_availability);

    const overall_rating =
      courseEntry.knowledge_rating * KNOWLEDGE_WEIGHT +
      review_rating * REVIEW_WEIGHT +
      availability_rating * AVAILABILITY_WEIGHT;

    const user = userById.get(profile._id);

    return {
      tutor_id: profile._id,
      name: user?.name || 'A tutor',
      bio: profile.bio,
      weekly_availability: profile.weekly_availability,
      knowledge_rating: courseEntry.knowledge_rating,
      review_rating: Math.round(review_rating * 10) / 10,
      review_count: tutorReviews.length,
      availability_rating,
      overall_rating: Math.round(overall_rating * 10) / 10,
    };
  });

  tutors.sort((a, b) => b.overall_rating - a.overall_rating);
  return tutors;
};

// GET /api/tutors/course/:courseId
// The ranked-matching endpoint: every currently-available tutor qualified
// for this course, sorted best-match first.
router.get('/course/:courseId', async (req, res) => {
  try {
    const tutors = await getRankedTutors(req.params.courseId);
    res.status(200).json({ tutors });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});
// GET /api/tutors/me
router.get('/me', verifyToken, async (req, res) => {
  try {
    const profile = await TutorProfile.findById(req.user.uid);
    res.status(200).json(profile || null);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// POST /api/tutors/me
// Registers or updates the caller's own tutor profile. General fields
// (bio, is_available, weekly_availability) are updated whenever sent.
// If course_id is also sent, this adds/refreshes eligibility for that one
// course, gated on having actually demonstrated knowledge of it — pulled
// from the caller's own Result history, not self-reported.
router.post('/me', verifyToken, async (req, res) => {
  try {
    const { bio, is_available, weekly_availability, course_id } = req.body;

    let profile = await TutorProfile.findById(req.user.uid);
    if (!profile) {
      profile = new TutorProfile({ _id: req.user.uid, courses: [] });
    }

    if (bio !== undefined) profile.bio = bio;
    if (is_available !== undefined) profile.is_available = is_available;
    if (weekly_availability !== undefined) profile.weekly_availability = weekly_availability;

    if (course_id) {
      const [bestResult] = await Result.find({ student_id: req.user.uid, course_id })
        .sort({ objective_percent: -1 })
        .limit(1);

      if (!bestResult || bestResult.objective_percent < MIN_TUTOR_KNOWLEDGE_PERCENT) {
        return res.status(400).json({
          message: `You need at least ${MIN_TUTOR_KNOWLEDGE_PERCENT}% on an assessment for this course before you can tutor it — take a test first.`
        });
      }

      const entry = {
        course_id,
        knowledge_percent: bestResult.objective_percent,
        knowledge_rating: percentToStars(bestResult.objective_percent),
      };
      const existingIndex = profile.courses.findIndex((c) => c.course_id.toString() === course_id);
      if (existingIndex >= 0) profile.courses[existingIndex] = entry;
      else profile.courses.push(entry);
    }

    await profile.save();
    res.status(200).json(profile);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// POST /api/tutors/:tutorId/reviews
router.post('/:tutorId/reviews', verifyToken, async (req, res) => {
  try {
    const { tutorId } = req.params;
    const { rating, comment, course_id } = req.body;

    if (tutorId === req.user.uid) {
      return res.status(400).json({ message: "You can't review yourself." });
    }
    if (!rating || rating < 1 || rating > 5) {
      return res.status(400).json({ message: 'Rating must be between 1 and 5.' });
    }

    const review = await TutorReview.create({
      tutor_id: tutorId,
      student_id: req.user.uid,
      course_id: course_id || undefined,
      rating,
      comment: comment || '',
    });

    res.status(201).json(review);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// POST /api/tutors/:tutorId/connect
// Finds or creates a single individual chat room for this tutor/student/
// course combination, so repeated clicks don't spawn duplicate rooms.
router.post('/:tutorId/connect', verifyToken, async (req, res) => {
  try {
    const { tutorId } = req.params;
    const { course_id } = req.body;
    const studentId = req.user.uid;

    if (tutorId === studentId) {
      return res.status(400).json({ message: "You can't connect with yourself." });
    }

    const tutorProfile = await TutorProfile.findById(tutorId);
    if (!tutorProfile) return res.status(404).json({ message: 'Tutor not found' });

    let room = await ChatRoom.findOne({
      type: 'individual',
      course_id: course_id || null,
      participants: { $all: [tutorId, studentId], $size: 2 },
    });

    if (!room) {
      const [tutorUser, studentUser, course] = await Promise.all([
        User.findById(tutorId),
        User.findById(studentId),
        course_id ? Course.findById(course_id) : null,
      ]);

      room = await ChatRoom.create({
        name: `${tutorUser?.name || 'Tutor'} & ${studentUser?.name || 'Student'}${course ? ` — ${course.course_code}` : ''}`,
        type: 'individual',
        description: course ? `Tutoring: ${course.title}` : 'Tutoring session',
        course_id: course_id || undefined,
        participants: [tutorId, studentId],
      });
    }

    res.status(200).json(room);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;
module.exports.getRankedTutors = getRankedTutors;
