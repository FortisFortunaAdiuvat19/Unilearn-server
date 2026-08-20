const express = require('express');
const router = express.Router();
const verifyToken = require('../middleware/auth');
const Assessment = require('../models/Assessment');
const Result = require('../models/Result');

// GET /api/assessments/:id
// Previously missing entirely — this is what AssessmentPlayer.jsx has been
// calling all along, so every test/exam 404'd before this route existed.
router.get('/:id', verifyToken, async (req, res) => {
  try {
    const assessment = await Assessment.findById(req.params.id);
    if (!assessment) return res.status(404).json({ message: 'Assessment not found' });
    res.status(200).json(assessment);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// POST /api/assessments/:id/submit
// Grades the objective section server-side against the assessment's own
// answer key (never trusts a score computed by the client) and persists
// a Result document. Theory answers are stored as-is for self-review,
// matching the existing player UI.
router.post('/:id/submit', verifyToken, async (req, res) => {
  try {
    const assessment = await Assessment.findById(req.params.id);
    if (!assessment) return res.status(404).json({ message: 'Assessment not found' });

    const objectiveQuestions = assessment.objective_questions || [];
    const theoryQuestions = assessment.theory_questions || [];

    const submittedObjective = Array.isArray(req.body.objective_answers)
      ? req.body.objective_answers
      : [];
    const submittedTheory = Array.isArray(req.body.theory_answers)
      ? req.body.theory_answers
      : [];

    let objective_score = 0;
    const objective_answers = objectiveQuestions.map((q, i) => {
      const selected = submittedObjective[i];
      const answer = typeof selected === 'number' ? selected : null;
      if (answer !== null && answer === q.correct_option) objective_score += 1;
      return answer;
    });

    const theory_answers = theoryQuestions.map((q, i) => submittedTheory[i] || '');

    const objective_max = objectiveQuestions.length;
    const objective_percent = objective_max > 0
      ? Math.round((objective_score / objective_max) * 100)
      : 0;

    const result = new Result({
      assessment_id: assessment._id,
      course_id: assessment.course_id,
      student_id: req.user.uid,
      type: assessment.type,
      objective_answers,
      theory_answers,
      objective_score,
      objective_max,
      objective_percent
    });

    await result.save();
    res.status(201).json(result);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// GET /api/assessments/:id/results
// The current student's own past attempts at this assessment, most recent
// first. Not wired into the UI yet, but the data's there for a "past
// attempts" view or the recommendation engine later.
router.get('/:id/results', verifyToken, async (req, res) => {
  try {
    const results = await Result.find({
      assessment_id: req.params.id,
      student_id: req.user.uid
    }).sort({ createdAt: -1 });
    res.status(200).json(results);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;
