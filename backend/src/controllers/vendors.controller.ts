import { RequestHandler } from 'express';
import { supabaseAdmin } from '../config/supabase';
import { httpError } from '../types';

export const list: RequestHandler = async (req, res) => {
  const q = (req.query.q as string) ?? '';
  let qb = supabaseAdmin.from('vendors').select('*');
  if (q) qb = qb.ilike('company_name', `%${q}%`);
  const { data, error } = await qb.order('created_at', { ascending: false });
  if (error) throw httpError(500, error.message);
  res.json(data);
};

export const get: RequestHandler = async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from('vendors')
    .select('*')
    .eq('id', req.params.id)
    .single();
  if (error) throw httpError(404, error.message);
  res.json(data);
};

export const create: RequestHandler = async (req, res) => {
  if (!req.user) throw httpError(401, 'Not authenticated');
  const { data, error } = await supabaseAdmin
    .from('vendors')
    .insert({ ...req.body, created_by: req.user.id })
    .select()
    .single();
  if (error) throw httpError(500, error.message);
  res.status(201).json(data);
};

export const update: RequestHandler = async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from('vendors')
    .update(req.body)
    .eq('id', req.params.id)
    .select()
    .single();
  if (error) throw httpError(500, error.message);
  res.json(data);
};

export const remove: RequestHandler = async (req, res) => {
  const { error } = await supabaseAdmin.from('vendors').delete().eq('id', req.params.id);
  if (error) throw httpError(500, error.message);
  res.json({ ok: true });
};
