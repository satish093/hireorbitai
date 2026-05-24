import { Router } from 'express';
import { requireRole } from '../middleware/auth';
import { MANAGER_TIER, ADMIN_TIER } from '../types';
import * as c from '../controllers/training.controller';
import * as w from '../controllers/trainingWorkspace.controller';
import * as adminAI from '../controllers/adminAI.controller';

export const trainingRouter = Router();

// ---- Learning workspace (any authed user; reads degrade gracefully) ----
trainingRouter.get('/catalog', w.getCatalog);
trainingRouter.get('/continue', w.getContinue);
trainingRouter.get('/compliance', w.getCompliance);
trainingRouter.get('/activity', w.getActivity);
trainingRouter.get('/achievements', w.getAchievements);
trainingRouter.get('/plans/active', w.getActivePlan);
trainingRouter.post('/plans/generate', w.generatePlan);
trainingRouter.patch('/plans/items/:id', w.togglePlanItem);
trainingRouter.post('/enroll', w.enroll);
trainingRouter.post('/courses/:id/rate', w.rateCourse);

// ---- Courses (manager-tier writes; everyone authed can read) ----
trainingRouter.get('/courses', c.listCourses);
trainingRouter.post('/courses', requireRole(...MANAGER_TIER), c.createCourse);
// Full-course AI generation is ADMIN-tier only (SUPER_ADMIN/CEO/CTO/DIRECTOR).
// Regular managers can still author courses + lessons by hand, but not invoke
// the AI generators.
trainingRouter.post('/courses/generate', requireRole(...ADMIN_TIER), c.generateCourse);
// Non-destructive enrich/backfill (structure only) — admin-tier.
trainingRouter.post('/courses/backfill', requireRole(...ADMIN_TIER), c.backfillCourses);
trainingRouter.get('/courses/:id', c.getCourse);
trainingRouter.put('/courses/:id', requireRole(...MANAGER_TIER), c.updateCourse);
trainingRouter.delete('/courses/:id', requireRole(...MANAGER_TIER), c.deleteCourse);
trainingRouter.post('/courses/:id/generate-outline', requireRole(...ADMIN_TIER), c.generateOutline);
trainingRouter.post(
  '/courses/:id/generate-capstone',
  requireRole(...ADMIN_TIER),
  c.generateCapstone,
);
trainingRouter.post('/courses/:id/enrich', requireRole(...ADMIN_TIER), c.enrichCourse);
trainingRouter.post('/courses/:id/review', requireRole(...MANAGER_TIER), c.reviewCourse);
trainingRouter.post('/courses/:id/publish', requireRole(...MANAGER_TIER), c.publishCourse);

// ---- Lessons (manager-tier only) ----
trainingRouter.post('/courses/:id/lessons', requireRole(...MANAGER_TIER), c.createLesson);
trainingRouter.put('/lessons/:id', requireRole(...MANAGER_TIER), c.updateLesson);
trainingRouter.delete('/lessons/:id', requireRole(...MANAGER_TIER), c.deleteLesson);
// AI lesson-content generation is ADMIN-tier only.
trainingRouter.post(
  '/lessons/:id/generate-content',
  requireRole(...ADMIN_TIER),
  c.generateLessonContent,
);

// ---- Quizzes ----
trainingRouter.get('/courses/:id/quiz', c.listQuiz);
trainingRouter.get('/lessons/:id/quiz', c.listLessonQuiz); // any authed user, answer-stripped
// Manual quiz-question CRUD for the inline editor (manager-tier).
trainingRouter.post('/lessons/:id/quiz', requireRole(...MANAGER_TIER), c.createLessonQuizQuestion);
trainingRouter.put('/quizzes/:id', requireRole(...MANAGER_TIER), c.updateQuizQuestion);
trainingRouter.delete('/quizzes/:id', requireRole(...MANAGER_TIER), c.deleteQuizQuestion);

// ---- Assignments ----
trainingRouter.post('/assign', requireRole(...MANAGER_TIER), c.assign);
trainingRouter.get('/assignments', requireRole(...MANAGER_TIER), c.listAssignments);
trainingRouter.get('/my-training', c.myTraining); // any authed user
trainingRouter.get('/assignments/:id', c.getAssignment);
trainingRouter.put('/assignments/:id', requireRole(...MANAGER_TIER), c.updateAssignment); // I-983 attestation block
trainingRouter.put('/assignments/:id/progress', c.updateProgress);
trainingRouter.put('/assignments/:id/viewed', c.markLessonViewed);
trainingRouter.post('/assignments/:id/upload', c.recordUpload);
trainingRouter.post('/assignments/:id/feedback', requireRole(...MANAGER_TIER), c.addFeedback);
trainingRouter.post('/assignments/:id/quiz-attempt', c.submitQuizAttempt);

// ---- I-983 Evaluations (auth handled inside the controller) ----
trainingRouter.get('/assignments/:id/evaluations', c.listEvaluations);
trainingRouter.post('/assignments/:id/evaluations', c.createEvaluation);
trainingRouter.put('/evaluations/:evalId', c.updateEvaluation);
trainingRouter.delete('/evaluations/:evalId', requireRole(...MANAGER_TIER), c.deleteEvaluation);

// ---- Completion gates (server-side multi-gate check) ----
trainingRouter.get('/assignments/:id/gates', c.getCompletionGates);

// ---- Acknowledgement (consultant-only insert; both can read) ----
trainingRouter.get('/assignments/:id/acknowledgement', c.getAcknowledgement);
trainingRouter.post('/assignments/:id/acknowledgement', c.acknowledge);

// ---- Final assessment (manager authors + grades, consultant submits) ----
trainingRouter.get('/assignments/:id/final-assessment', c.getFinalAssessment);
trainingRouter.post(
  '/assignments/:id/final-assessment',
  requireRole(...MANAGER_TIER),
  c.authorFinalAssessment,
);
trainingRouter.post('/assignments/:id/final-assessment/submit', c.submitFinalAssessment);
trainingRouter.post(
  '/assignments/:id/final-assessment/grade',
  requireRole(...MANAGER_TIER),
  c.gradeFinalAssessment,
);

// ---- Supervision notes (trainer/manager journal) ----
trainingRouter.get('/assignments/:id/supervision-notes', c.listSupervisionNotes);
trainingRouter.post(
  '/assignments/:id/supervision-notes',
  requireRole(...MANAGER_TIER),
  c.addSupervisionNote,
);
trainingRouter.put(
  '/supervision-notes/:noteId',
  requireRole(...MANAGER_TIER),
  c.updateSupervisionNote,
);
trainingRouter.delete(
  '/supervision-notes/:noteId',
  requireRole(...MANAGER_TIER),
  c.deleteSupervisionNote,
);

// ---- Training Compliance Report (JSON + CSV via ?format=csv) ----
trainingRouter.get('/assignments/:id/compliance-report', c.complianceReport);

// ---- Reports (manager-tier only) ----
trainingRouter.get('/reports', requireRole(...MANAGER_TIER), c.reports);

// ---- AI provider info (any authed user, no token spend) ----
// Returns which server-side AI credential is active so the frontend can skip
// the "choose provider" modal when the server is already configured.
trainingRouter.get('/ai/provider', c.aiProviderInfo);

// ---- AI generation status — live activity feed (manager-tier) ----
trainingRouter.get('/ai/generation-status', requireRole(...MANAGER_TIER), c.aiGenerationStatus);

// ---- Admin-only: validate an AI token before using it for generation ----
trainingRouter.post('/ai/check-token', requireRole(...ADMIN_TIER), adminAI.checkAiToken);

// ---- Claude CLI auth management (admin-tier only) ----
// Refresh: runs `claude setup-token` — works when CLI is already logged in.
trainingRouter.post(
  '/ai/claude-auth/refresh',
  requireRole(...ADMIN_TIER),
  adminAI.refreshClaudeToken,
);
// Re-login: spawns `claude auth login`, returns the auth URL to show in the UI.
trainingRouter.post('/ai/claude-auth/start', requireRole(...ADMIN_TIER), adminAI.startClaudeLogin);
// Poll for completion of a pending login session.
trainingRouter.get(
  '/ai/claude-auth/:sessionId/status',
  requireRole(...ADMIN_TIER),
  adminAI.getLoginStatus,
);

// ---- AI endpoints (manager-tier only — these spend Anthropic tokens) ----
trainingRouter.post('/ai/generate-plan', requireRole(...MANAGER_TIER), c.aiGeneratePlan);
trainingRouter.post(
  '/ai/generate-interview-questions',
  requireRole(...MANAGER_TIER),
  c.aiInterviewQuestions,
);
trainingRouter.post('/ai/generate-quiz', requireRole(...MANAGER_TIER), c.aiGenerateQuiz);
trainingRouter.post('/ai/skill-gap-analysis', requireRole(...MANAGER_TIER), c.aiSkillGap);
