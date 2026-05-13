import { RequestHandler } from 'express';
import { supabaseAdmin } from '../config/supabase';
import { httpError, MANAGER_TIER } from '../types';

function isManagerLike(role: string): boolean {
  return (MANAGER_TIER as string[]).includes(role);
}

const BUCKET = 'task-attachments';

async function canAccessTask(taskId: string, userId: string, role: string): Promise<boolean> {
  if (isManagerLike(role)) return true;
  const { data } = await supabaseAdmin.from('tasks').select('assignee_id').eq('id', taskId).single();
  return data?.assignee_id === userId;
}

/** List attachments. Each entry includes a short-lived signed download URL. */
export const list: RequestHandler = async (req, res) => {
  if (!req.user) throw httpError(401, 'Not authenticated');
  const taskId = req.params.taskId;
  if (!(await canAccessTask(taskId, req.user.id, req.user.role))) throw httpError(403, 'Forbidden');

  const { data, error } = await supabaseAdmin
    .from('task_attachments')
    .select(`*, uploader:users!uploaded_by ( id, email, full_name )`)
    .eq('task_id', taskId)
    .order('created_at', { ascending: false });
  if (error) throw httpError(500, error.message);

  const withUrls = await Promise.all((data ?? []).map(async (a: any) => {
    const { data: signed } = await supabaseAdmin.storage.from(BUCKET).createSignedUrl(a.storage_path, 3600);
    return { ...a, download_url: signed?.signedUrl ?? null };
  }));
  res.json(withUrls);
};

/** Upload an attachment. multipart/form-data: { file }. */
export const upload: RequestHandler = async (req, res) => {
  if (!req.user) throw httpError(401, 'Not authenticated');
  const taskId = req.params.taskId;
  if (!(await canAccessTask(taskId, req.user.id, req.user.role))) throw httpError(403, 'Forbidden');

  const file = (req as any).file as Express.Multer.File | undefined;
  if (!file) throw httpError(400, 'Missing file');

  const safeName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
  const path = `${taskId}/${Date.now()}-${safeName}`;
  const { error: upErr } = await supabaseAdmin.storage
    .from(BUCKET).upload(path, file.buffer, { contentType: file.mimetype, upsert: false });
  if (upErr) throw httpError(500, `Storage upload failed: ${upErr.message}`);

  const { data, error } = await supabaseAdmin
    .from('task_attachments')
    .insert({
      task_id: taskId,
      uploaded_by: req.user.id,
      file_name: file.originalname,
      storage_path: path,
      mime_type: file.mimetype,
      size_bytes: file.buffer.length,
    })
    .select()
    .single();
  if (error) throw httpError(500, error.message);
  res.status(201).json(data);
};

/** Delete an attachment (DB row + object). Uploader or manager. */
export const remove: RequestHandler = async (req, res) => {
  if (!req.user) throw httpError(401, 'Not authenticated');
  const { data: row } = await supabaseAdmin
    .from('task_attachments').select('*').eq('id', req.params.id).single();
  if (!row) throw httpError(404, 'Attachment not found');
  const canDelete = isManagerLike(req.user.role) || row.uploaded_by === req.user.id;
  if (!canDelete) throw httpError(403, 'Forbidden');

  await supabaseAdmin.storage.from(BUCKET).remove([row.storage_path]);
  const { error } = await supabaseAdmin.from('task_attachments').delete().eq('id', row.id);
  if (error) throw httpError(500, error.message);
  res.json({ ok: true });
};
