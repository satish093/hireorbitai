import { RequestHandler } from 'express';
import { generateVendorSubmissionEmail, scoreResume, atsScore } from '../services/ai.service';
import { httpError } from '../types';

export const resumeScore: RequestHandler = async (req, res) => {
  const text = String(req.body?.text ?? '');
  if (!text) throw httpError(400, 'Missing resume text');
  res.json(await scoreResume(text));
};

export const ats: RequestHandler = async (req, res) => {
  const { resume_text, job_description } = req.body ?? {};
  if (!resume_text || !job_description)
    throw httpError(400, 'resume_text and job_description required');
  res.json(await atsScore(resume_text, job_description));
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
  const result = await generateVendorSubmissionEmail({
    consultantName,
    consultantSkills: consultantSkills ?? [],
    consultantExperienceYears: consultantExperienceYears ?? 0,
    jobTitle,
    jobDescription,
    vendorName,
    recruiterName,
  });
  res.json(result);
};
