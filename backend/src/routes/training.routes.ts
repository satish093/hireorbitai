import { Router } from 'express';
import { requireRole } from '../middleware/auth';
import { MANAGER_TIER } from '../types';
import * as c from '../controllers/training.controller';

export const trainingRouter = Router();

// ---- Courses (manager-tier writes; everyone authed can read) ----
trainingRouter.get('/courses', c.listCourses);
trainingRouter.post('/courses', requireRole(...MANAGER_TIER), c.createCourse);
trainingRouter.get('/courses/:id', c.getCourse);
trainingRouter.put('/courses/:id', requireRole(...MANAGER_TIER), c.updateCourse);
trainingRouter.delete('/courses/:id', requireRole(...MANAGER_TIER), c.deleteCourse);

// ---- Lessons (manager-tier only) ----
trainingRouter.post('/courses/:id/lessons', requireRole(...MANAGER_TIER), c.createLesson);
trainingRouter.put('/lessons/:id', requireRole(...MANAGER_TIER), c.updateLesson);
trainingRouter.delete('/lessons/:id', requireRole(...MANAGER_TIER), c.deleteLesson);

// ---- Quizzes ----
trainingRouter.get('/courses/:id/quiz', c.listQuiz);

// ---- Assignments ----
trainingRouter.post('/assign', requireRole(...MANAGER_TIER), c.assign);
trainingRouter.get('/assignments', requireRole(...MANAGER_TIER), c.listAssignments);
trainingRouter.get('/my-training', c.myTraining); // any authed user
trainingRouter.get('/assignments/:id', c.getAssignment);
trainingRouter.put('/assignments/:id', requireRole(...MANAGER_TIER), c.updateAssignment); // I-983 attestation block
trainingRouter.put('/assignments/:id/progress', c.updateProgress);
trainingRouter.post('/assignments/:id/upload', c.recordUpload);
trainingRouter.post('/assignments/:id/feedback', requireRole(...MANAGER_TIER), c.addFeedback);
trainingRouter.post('/assignments/:id/quiz-attempt', c.submitQuizAttempt);

// ---- I-983 Evaluations (auth handled inside the controller) ----
trainingRouter.get('/assignments/:id/evaluations', c.listEvaluations);
trainingRouter.post('/assignments/:id/evaluations', c.createEvaluation);
trainingRouter.put('/evaluations/:evalId', c.updateEvaluation);
trainingRouter.delete('/evaluations/:evalId', requireRole(...MANAGER_TIER), c.deleteEvaluation);

// ---- Reports (manager-tier only) ----
trainingRouter.get('/reports', requireRole(...MANAGER_TIER), c.reports);

// ---- AI endpoints (manager-tier only — these spend Anthropic tokens) ----
trainingRouter.post('/ai/generate-plan', requireRole(...MANAGER_TIER), c.aiGeneratePlan);
trainingRouter.post(
  '/ai/generate-interview-questions',
  requireRole(...MANAGER_TIER),
  c.aiInterviewQuestions,
);
trainingRouter.post('/ai/generate-quiz', requireRole(...MANAGER_TIER), c.aiGenerateQuiz);
trainingRouter.post('/ai/skill-gap-analysis', requireRole(...MANAGER_TIER), c.aiSkillGap);
