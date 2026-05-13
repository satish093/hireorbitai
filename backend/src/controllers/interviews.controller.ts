import { RequestHandler } from 'express';
import { supabaseAdmin } from '../config/supabase';
import { httpError } from '../types';

export const list: RequestHandler = async (req, res) => {
  const { consultant_id, from, to, is_mock } = req.query as Record<string, string | undefined>;
  let qb = supabaseAdmin
    .from('interviews')
    .select('*, consultant:consultants(*), application:applications(*)');
  if (consultant_id) qb = qb.eq('consultant_id', consultant_id);
  if (is_mock != null) qb = qb.eq('is_mock', is_mock === 'true');
  if (from) qb = qb.gte('scheduled_at', from);
  if (to) qb = qb.lte('scheduled_at', to);
  const { data, error } = await qb.order('scheduled_at', { ascending: true });
  if (error) throw httpError(500, error.message);
  res.json(data);
};

export const schedule: RequestHandler = async (req, res) => {
  if (!req.user) throw httpError(401, 'Not authenticated');
  const { data, error } = await supabaseAdmin
    .from('interviews')
    .insert({ ...req.body, created_by: req.user.id })
    .select()
    .single();
  if (error) throw httpError(500, error.message);
  res.status(201).json(data);
};

export const scheduleMock: RequestHandler = async (req, res) => {
  if (!req.user) throw httpError(401, 'Not authenticated');
  const { data, error } = await supabaseAdmin
    .from('interviews')
    .insert({ ...req.body, type: 'MOCK', is_mock: true, created_by: req.user.id })
    .select()
    .single();
  if (error) throw httpError(500, error.message);
  res.status(201).json(data);
};

export const update: RequestHandler = async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from('interviews')
    .update(req.body)
    .eq('id', req.params.id)
    .select()
    .single();
  if (error) throw httpError(500, error.message);
  res.json(data);
};

export const submitFeedback: RequestHandler = async (req, res) => {
  if (!req.user) throw httpError(401, 'Not authenticated');
  const feedback = req.body?.feedback ?? req.body;
  const { data, error } = await supabaseAdmin
    .from('interviews')
    .update({
      feedback,
      feedback_submitted_at: new Date().toISOString(),
      feedback_submitted_by: req.user.id,
      status: 'COMPLETED',
    })
    .eq('id', req.params.id)
    .select()
    .single();
  if (error) throw httpError(500, error.message);
  res.json(data);
};
