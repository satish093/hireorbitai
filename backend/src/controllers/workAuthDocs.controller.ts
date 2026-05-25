import { RequestHandler } from 'express';
import { z } from 'zod';
import { db } from '../config/db';
import { httpError, MANAGER_TIER } from '../types';
import { audit } from '../services/audit.service';

const WORK_AUTH_BUCKET = 'work-auth-docs';

function isManagerTier(role?: string): boolean {
  return !!role && (MANAGER_TIER as string[]).includes(role);
}

// ---------------------------------------------------------------------------
// Authorization helper — mirrors resumes.controller.ts authorizeConsultantAccess.
//
//   MANAGER_TIER+ : unrestricted
//   RECRUITER     : only their assigned consultants
//   CONSULTANT    : only themselves
// ---------------------------------------------------------------------------
interface ConsultantOwnerRow {
  id: string;
  user_id: string;
  recruiter_id: string | null;
}

async function authorizeConsultantAccess(
  consultantId: string,
  caller: { id: string; role: string },
): Promise<ConsultantOwnerRow> {
  const { data: cons, error } = await db
    .from('consultants')
    .select('id, user_id, recruiter_id')
    .eq('id', consultantId)
    .maybeSingle();
  if (error) throw httpError(500, 'Database error');
  if (!cons) throw httpError(404, 'Not found');
  const row = cons as ConsultantOwnerRow;

  if (isManagerTier(caller.role)) return row;

  if (caller.role === 'CONSULTANT') {
    if (row.user_id !== caller.id) throw httpError(404, 'Not found');
    return row;
  }

  if (caller.role === 'RECRUITER') {
    const { data: rec } = await db
      .from('recruiters')
      .select('id')
      .eq('user_id', caller.id)
      .maybeSingle();
    if (!rec || row.recruiter_id !== (rec as { id: string }).id) throw httpError(404, 'Not found');
    return row;
  }

  throw httpError(404, 'Not found');
}

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

const uploadBodySchema = z
  .object({
    doc_type: z.enum(['H1B', 'EAD', 'I20', 'PASSPORT', 'OFFER_LETTER', 'I797', 'OTHER']),
    label: z.string().max(100).optional(),
    issue_date: z.string().date().optional().nullable(),
    expiry_date: z.string().date().optional().nullable(),
  })
  .strict();

// ---------------------------------------------------------------------------
// GET /work-auth-docs/:consultantId
// ---------------------------------------------------------------------------
export const list: RequestHandler = async (req, res) => {
  if (!req.user) throw httpError(401, 'Not authenticated');
  await authorizeConsultantAccess(req.params.consultantId, req.user);

  const { data, error } = await db
    .from('work_auth_documents')
    .select(
      'id, doc_type, label, issue_date, expiry_date, file_name, mime_type, size_bytes, uploaded_by, created_at',
    )
    .eq('consultant_id', req.params.consultantId)
    .order('created_at', { ascending: false });
  if (error) {
    if (/relation .* does not exist|schema cache/i.test(error.message)) {
      res.json([]);
      return;
    }
    throw httpError(500, 'Database error');
  }
  res.json(data ?? []);
};

// ---------------------------------------------------------------------------
// POST /work-auth-docs/:consultantId  (multipart/form-data)
// ---------------------------------------------------------------------------
export const upload: RequestHandler = async (req, res) => {
  if (!req.user) throw httpError(401, 'Not authenticated');
  await authorizeConsultantAccess(req.params.consultantId, req.user);

  const file = (req as any).file as Express.Multer.File | undefined;
  if (!file) throw httpError(400, 'Missing file');

  const parsed = uploadBodySchema.safeParse(req.body);
  if (!parsed.success) throw httpError(400, 'Invalid input', parsed.error.flatten());
  const { doc_type, label, issue_date, expiry_date } = parsed.data;

  const safeName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
  const storagePath = `${req.params.consultantId}/${Date.now()}-${safeName}`;

  const { error: uploadErr } = await db.storage
    .from(WORK_AUTH_BUCKET)
    .upload(storagePath, file.buffer, { contentType: file.mimetype, upsert: false });
  if (uploadErr) throw httpError(500, `Storage upload failed: ${uploadErr.message}`);

  const { data, error } = await db
    .from('work_auth_documents')
    .insert({
      consultant_id: req.params.consultantId,
      doc_type,
      label: label ?? null,
      issue_date: issue_date ?? null,
      expiry_date: expiry_date ?? null,
      file_name: file.originalname,
      storage_path: storagePath,
      mime_type: file.mimetype,
      size_bytes: file.buffer.length,
      uploaded_by: req.user.id,
    })
    .select()
    .single();
  if (error) {
    // Roll back the file if the DB insert fails.
    await db.storage
      .from(WORK_AUTH_BUCKET)
      .remove([storagePath])
      .catch(() => {});
    throw httpError(500, 'Database error');
  }

  audit({
    action: 'work_auth_doc_uploaded',
    user_id: req.user.id,
    email: req.user.email,
    req,
    metadata: { consultant_id: req.params.consultantId, doc_type },
  });

  res.status(201).json(data);
};

// ---------------------------------------------------------------------------
// GET /work-auth-docs/:consultantId/:docId/download
// ---------------------------------------------------------------------------
export const downloadUrl: RequestHandler = async (req, res) => {
  if (!req.user) throw httpError(401, 'Not authenticated');
  await authorizeConsultantAccess(req.params.consultantId, req.user);

  const { data: doc, error } = await db
    .from('work_auth_documents')
    .select('storage_path')
    .eq('id', req.params.docId)
    .eq('consultant_id', req.params.consultantId)
    .maybeSingle();
  if (error) throw httpError(500, 'Database error');
  if (!doc) throw httpError(404, 'Not found');

  const { data: urlData, error: urlErr } = await db.storage
    .from(WORK_AUTH_BUCKET)
    .createSignedUrl((doc as { storage_path: string }).storage_path, 60 * 60);
  if (urlErr || !urlData) throw httpError(500, `Signed URL failed: ${urlErr?.message}`);

  res.json({ url: urlData.signedUrl });
};

// ---------------------------------------------------------------------------
// DELETE /work-auth-docs/:consultantId/:docId
// ---------------------------------------------------------------------------
export const remove: RequestHandler = async (req, res) => {
  if (!req.user) throw httpError(401, 'Not authenticated');
  await authorizeConsultantAccess(req.params.consultantId, req.user);

  const { data: doc, error } = await db
    .from('work_auth_documents')
    .select('id, storage_path, doc_type')
    .eq('id', req.params.docId)
    .eq('consultant_id', req.params.consultantId)
    .maybeSingle();
  if (error) throw httpError(500, 'Database error');
  if (!doc) throw httpError(404, 'Not found');
  const row = doc as { id: string; storage_path: string; doc_type: string };

  await db.storage
    .from(WORK_AUTH_BUCKET)
    .remove([row.storage_path])
    .catch(() => {});

  const { error: delErr } = await db
    .from('work_auth_documents')
    .delete()
    .eq('id', row.id)
    .eq('consultant_id', req.params.consultantId);
  if (delErr) throw httpError(500, delErr.message);

  audit({
    action: 'work_auth_doc_deleted',
    user_id: req.user.id,
    email: req.user.email,
    req,
    metadata: { consultant_id: req.params.consultantId, doc_type: row.doc_type },
  });

  res.status(204).send();
};
