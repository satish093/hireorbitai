import { RequestHandler } from 'express';
import { supabaseAdmin } from '../config/supabase';
import { httpError } from '../types';

export const list: RequestHandler = async (req, res) => {
  if (!req.user) throw httpError(401, 'Not authenticated');
  const status = req.query.status as string | undefined;
  let qb = supabaseAdmin.from('reminders').select('*').eq('owner_id', req.user.id);
  if (status) qb = qb.eq('status', status);
  const { data, error } = await qb.order('due_at', { ascending: true });
  if (error) throw httpError(500, error.message);
  res.json(data);
};

export const create: RequestHandler = async (req, res) => {
  if (!req.user) throw httpError(401, 'Not authenticated');
  const { data, error } = await supabaseAdmin
    .from('reminders')
    .insert({ ...req.body, owner_id: req.user.id })
    .select()
    .single();
  if (error) throw httpError(500, error.message);
  res.status(201).json(data);
};

export const update: RequestHandler = async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from('reminders')
    .update(req.body)
    .eq('id', req.params.id)
    .select()
    .single();
  if (error) throw httpError(500, error.message);
  res.json(data);
};

export const complete: RequestHandler = async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from('reminders')
    .update({ status: 'DONE', completed_at: new Date().toISOString() })
    .eq('id', req.params.id)
    .select()
    .single();
  if (error) throw httpError(500, error.message);
  res.json(data);
};

export const remove: RequestHandler = async (req, res) => {
  const { error } = await supabaseAdmin.from('reminders').delete().eq('id', req.params.id);
  if (error) throw httpError(500, error.message);
  res.json({ ok: true });
};
