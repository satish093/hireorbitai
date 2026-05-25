import { RequestHandler } from 'express';
import { generateVendorSubmissionEmail, scoreResume, atsScore } from '../services/ai.service';
import { audit } from '../services/audit.service';
import { httpError } from '../types';

export const resumeScore: RequestHandler = async (req, res) => {
  const text = String(req.body?.text ?? '');
  if (!text) throw httpError(400, 'Missing resume text');
  try {
    const result = await scoreResume(text);
    audit({
      action: 'ai_resume_scored',
      user_id: req.user?.id,
      email: req.user?.email,
      req,
      metadata: { score: result.score },
    });
    res.json(result);
  } catch (err) {
    audit({
      action: 'ai_feature_error',
      user_id: req.user?.id,
      email: req.user?.email,
      req,
      metadata: { feature: 'resume_score', error: (err as Error).message },
    });
    throw err;
  }
};

export const ats: RequestHandler = async (req, res) => {
  const { resume_text, job_description } = req.body ?? {};
  if (!resume_text || !job_description)
    throw httpError(400, 'resume_text and job_description required');
  try {
    const result = await atsScore(resume_text, job_description);
    audit({
      action: 'ai_ats_scored',
      user_id: req.user?.id,
      email: req.user?.email,
      req,
      metadata: { score: result.score },
    });
    res.json(result);
  } catch (err) {
    audit({
      action: 'ai_feature_error',
      user_id: req.user?.id,
      email: req.user?.email,
      req,
      metadata: { feature: 'ats_score', error: (err as Error).message },
    });
    throw err;
  }
};

export const vendorEmail: RequestHandler = async (req, res) => {
  const {
    consultantName,
    consultantSkills,
    consultantExperienceYears,
    jobTitle,
    jobDescription,
    vendorName,
    recruiterName,
  } = req.body ?? {};
  if (!consultantName || !jobTitle || !recruiterName) {
    throw httpError(400, 'consultantName, jobTitle, recruiterName required');
  }
  try {
    const result = await generateVendorSubmissionEmail({
      consultantName,
      consultantSkills: consultantSkills ?? [],
      consultantExperienceYears: consultantExperienceYears ?? 0,
      jobTitle,
      jobDescription,
      vendorName,
      recruiterName,
    });
    audit({
      action: 'ai_vendor_email_generated',
      user_id: req.user?.id,
      email: req.user?.email,
      req,
      metadata: { consultantName, jobTitle, vendorName },
    });
    res.json(result);
  } catch (err) {
    audit({
      action: 'ai_feature_error',
      user_id: req.user?.id,
      email: req.user?.email,
      req,
      metadata: { feature: 'vendor_email', error: (err as Error).message },
    });
    throw err;
  }
};
