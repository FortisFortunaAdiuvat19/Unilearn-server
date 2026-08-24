const express = require('express');
const router = express.Router();
const verifyToken = require('../middleware/auth');
const Result = require('../models/Result');
const Assessment = require('../models/Assessment');
const Course = require('../models/Course');
const VideoResource = require('../models/VideoResource');

// Below this objective score (%), an assessment gets flagged with
// improvement suggestions. Should match IMPROVEMENT_THRESHOLD in
// unilearn-client/src/pages/AssessmentPlayer.jsx — there's no shared code
// between the two repos, so this is duplicated on purpose.
const IMPROVEMENT_THRESHOLD = 70;

// How many weak spots to surface at once, worst-first.
const MAX_RECOMMENDATIONS = 5;

// GET /api/recommendations
// Looks at the student's own Result history, finds their most recent
// attempt on each assessment, and turns any that are still below the
// improvement threshold into concrete next steps: retake the test, watch
// a video if one exists for that course, or find classmates studying it.
// This is intentionally scoped to auto-graded objective scores only —
// theory answers aren't auto-graded (self-review only, same as the
// assessment player), so there's no reliable number to act on there.
router.get('/', verifyToken, async (req, res) => {
  try {
    const allResults = await Result.find({ student_id: req.user.uid }).sort({ createdAt: -1 });

    const latestByAssessment = new Map();
    for (const result of allResults) {
      const key = result.assessment_id.toString();
      if (!latestByAssessment.has(key)) latestByAssessment.set(key, result);
    }

    const weakResults = [...latestByAssessment.values()]
      .filter((r) => r.objective_max > 0 && r.objective_percent < IMPROVEMENT_THRESHOLD)
      .sort((a, b) => a.objective_percent - b.objective_percent)
      .slice(0, MAX_RECOMMENDATIONS);

    const recommendations = await Promise.all(
      weakResults.map(async (result) => {
        const [assessment, course, video] = await Promise.all([
          Assessment.findById(result.assessment_id),
          Course.findById(result.course_id),
          VideoResource.findOne({ course_id: result.course_id }),
        ]);

        const suggested_actions = [
          {
            type: 'retake_test',
            label: `Retake "${assessment?.title || 'this assessment'}"`,
            href: `/assessment/${result.assessment_id}`,
          },
        ];

        // Only suggested when a real video exists for the course — no
        // fabricated links, same rule as content generation.
        if (video) {
          suggested_actions.push({
            type: 'watch_video',
            label: `Watch: ${video.title}`,
            href: video.url,
          });
        }

        suggested_actions.push({
          type: 'join_study_group',
          label: `Find classmates studying ${course?.title || 'this course'}`,
          href: '/community',
        });

        return {
          course_id: result.course_id,
          course_title: course?.title || 'Unknown course',
          assessment_id: result.assessment_id,
          assessment_title: assessment?.title || 'Assessment',
          score_percent: result.objective_percent,
          attempted_at: result.createdAt,
          suggested_actions,
        };
      })
    );

    res.status(200).json({
      recommendations,
      has_results: allResults.length > 0,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;
