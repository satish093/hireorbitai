import { db } from '../config/db';

/**
 * All DB access for the Training module lives here. Controllers + services
 * never touch db directly so the data layer can be swapped or
 * mocked without rewriting business logic.
 */

const COURSE_SELECT =
  '*, lessons:training_lessons!course_id(count), assignments:training_assignments!course_id(count)';
const LESSON_SELECT = '*';
const ASSIGNMENT_SELECT =
  '*, course:training_courses!course_id(id, title, category, thumbnail_url, difficulty, estimated_duration_hours),' +
  ' assignee:users!assigned_to_user_id(id, full_name, email, role, avatar_url),' +
  ' assigner:users!assigned_by_user_id(id, full_name, email)';

// ===== COURSES =====
export const courses = {
  async list(filter: { status?: string; category?: string } = {}) {
    let qb = db
      .from('training_courses')
      .select(COURSE_SELECT)
      .order('created_at', { ascending: false });
    if (filter.status) qb = qb.eq('status', filter.status);
    if (filter.category) qb = qb.eq('category', filter.category);
    return qb;
  },
  async get(id: string) {
    // Lessons + quizzes are fetched as separate queries rather than embedded.
    // The shim treats `lessons:training_lessons!course_id(*)` as a to-ONE embed
    // (explicit FK), which generates `WHERE training_lessons.id =
    // training_courses.course_id` — a column that doesn't exist on the parent —
    // and errors, surfacing as a 404. Separate queries sidestep that entirely.
    const courseRes = await db.from('training_courses').select('*').eq('id', id).maybeSingle();
    if (courseRes.error || !courseRes.data) return courseRes;
    const [lessonsRes, quizzesRes] = await Promise.all([
      db.from('training_lessons').select(LESSON_SELECT).eq('course_id', id).order('lesson_order'),
      db.from('training_quizzes').select('*').eq('course_id', id).order('question_order'),
    ]);
    return {
      data: {
        ...(courseRes.data as Record<string, unknown>),
        lessons: lessonsRes.data ?? [],
        quizzes: quizzesRes.data ?? [],
      },
      error: null,
    };
  },
  async create(row: any) {
    return db.from('training_courses').insert(row).select(COURSE_SELECT).single();
  },
  async update(id: string, patch: any) {
    return db.from('training_courses').update(patch).eq('id', id).select(COURSE_SELECT).single();
  },
  async remove(id: string) {
    return db.from('training_courses').delete().eq('id', id);
  },
};

// ===== COURSE VERSIONS — immutable published snapshots =====
export const courseVersions = {
  async create(row: any) {
    return db.from('training_course_versions').insert(row).select().single();
  },
  async get(id: string) {
    return db.from('training_course_versions').select('*').eq('id', id).maybeSingle();
  },
  async listForCourse(courseId: string) {
    return db
      .from('training_course_versions')
      .select('id, version_number, published_at, published_by')
      .eq('course_id', courseId)
      .order('version_number', { ascending: false });
  },
  /** Highest version_number for a course, or 0 when none exist yet. */
  async maxNumber(courseId: string): Promise<number> {
    const { data } = await db
      .from('training_course_versions')
      .select('version_number')
      .eq('course_id', courseId)
      .order('version_number', { ascending: false })
      .limit(1)
      .maybeSingle();
    return Number((data as any)?.version_number ?? 0);
  },
};

// ===== LESSONS =====
export const lessons = {
  async listByCourse(courseId: string) {
    return db
      .from('training_lessons')
      .select(LESSON_SELECT)
      .eq('course_id', courseId)
      .order('lesson_order');
  },
  async get(id: string) {
    return db.from('training_lessons').select(LESSON_SELECT).eq('id', id).single();
  },
  async create(row: any) {
    return db.from('training_lessons').insert(row).select(LESSON_SELECT).single();
  },
  async createMany(rows: any[]) {
    return db.from('training_lessons').insert(rows).select(LESSON_SELECT);
  },
  async update(id: string, patch: any) {
    return db.from('training_lessons').update(patch).eq('id', id).select(LESSON_SELECT).single();
  },
  async remove(id: string) {
    return db.from('training_lessons').delete().eq('id', id);
  },
};

// ===== ASSIGNMENTS =====
export const assignments = {
  async list(filter: { status?: string; assigned_to_user_id?: string } = {}) {
    let qb = db
      .from('training_assignments')
      .select(ASSIGNMENT_SELECT)
      .order('created_at', { ascending: false });
    if (filter.status) qb = qb.eq('status', filter.status);
    if (filter.assigned_to_user_id) qb = qb.eq('assigned_to_user_id', filter.assigned_to_user_id);
    return qb;
  },
  async listForUser(userId: string) {
    return db
      .from('training_assignments')
      .select(ASSIGNMENT_SELECT)
      .eq('assigned_to_user_id', userId)
      .order('created_at', { ascending: false });
  },
  async get(id: string) {
    return db.from('training_assignments').select(ASSIGNMENT_SELECT).eq('id', id).single();
  },
  async create(row: any) {
    return db.from('training_assignments').insert(row).select(ASSIGNMENT_SELECT).single();
  },
  async update(id: string, patch: any) {
    return db
      .from('training_assignments')
      .update(patch)
      .eq('id', id)
      .select(ASSIGNMENT_SELECT)
      .single();
  },
};

// ===== LESSON PROGRESS =====
export const progress = {
  async listForAssignment(assignmentId: string) {
    return db.from('training_lesson_progress').select('*').eq('assignment_id', assignmentId);
  },
  async upsert(row: any) {
    return db
      .from('training_lesson_progress')
      .upsert(row, { onConflict: 'assignment_id,lesson_id' })
      .select()
      .single();
  },
  /** Count completed lessons for an assignment + total lessons in the course. */
  async countsFor(assignmentId: string, courseId: string) {
    const [{ count: completed }, { count: total }] = await Promise.all([
      db
        .from('training_lesson_progress')
        .select('*', { count: 'exact', head: true })
        .eq('assignment_id', assignmentId)
        .eq('completed', true),
      db
        .from('training_lessons')
        .select('*', { count: 'exact', head: true })
        .eq('course_id', courseId),
    ]);
    return { completed: completed ?? 0, total: total ?? 0 };
  },
};

// ===== QUIZZES =====
// `correct_answer` + `explanation` are answer-key columns — they must NOT be
// sent to a student before they submit. STUDENT_QUIZ_SELECT omits them; the
// full select is reserved for the manager-only course-detail embed and for
// server-side grading (quizzes.get).
const STUDENT_QUIZ_SELECT = 'id, lesson_id, question, options, points, question_order';
export const quizzes = {
  /** includeAnswers defaults FALSE — callers must opt in to the answer key. */
  async listByCourse(courseId: string, opts: { includeAnswers?: boolean } = {}) {
    return db
      .from('training_quizzes')
      .select(opts.includeAnswers ? '*' : STUDENT_QUIZ_SELECT)
      .eq('course_id', courseId)
      .order('question_order');
  },
  async listByLesson(lessonId: string, opts: { includeAnswers?: boolean } = {}) {
    return db
      .from('training_quizzes')
      .select(opts.includeAnswers ? '*' : STUDENT_QUIZ_SELECT)
      .eq('lesson_id', lessonId)
      .order('question_order');
  },
  async create(row: any) {
    return db.from('training_quizzes').insert(row).select().single();
  },
  async createMany(rows: any[]) {
    return db.from('training_quizzes').insert(rows).select();
  },
  /** Drop a lesson's generated questions before re-generating its content. */
  async removeForLesson(lessonId: string) {
    return db.from('training_quizzes').delete().eq('lesson_id', lessonId);
  },
  async get(id: string) {
    return db.from('training_quizzes').select('*').eq('id', id).single();
  },
  async update(id: string, patch: any) {
    return db.from('training_quizzes').update(patch).eq('id', id).select().single();
  },
  async remove(id: string) {
    return db.from('training_quizzes').delete().eq('id', id);
  },
};

// ===== QUIZ ATTEMPTS =====
export const quizAttempts = {
  async record(row: any) {
    return db.from('training_quiz_attempts').insert(row).select().single();
  },
  async listForAssignment(assignmentId: string) {
    return db
      .from('training_quiz_attempts')
      .select('*')
      .eq('assignment_id', assignmentId)
      .order('attempted_at', { ascending: false });
  },
};

// ===== UPLOADS =====
export const uploads = {
  async listForAssignment(assignmentId: string) {
    return db
      .from('training_assignment_uploads')
      .select('*')
      .eq('assignment_id', assignmentId)
      .order('uploaded_at', { ascending: false });
  },
  async create(row: any) {
    return db.from('training_assignment_uploads').insert(row).select().single();
  },
};

// ===== FEEDBACK =====
export const feedback = {
  async listForAssignment(assignmentId: string) {
    return db
      .from('training_feedback')
      .select('*, author:users!created_by(id, full_name, email)')
      .eq('assignment_id', assignmentId)
      .order('created_at', { ascending: false });
  },
  async create(row: any) {
    return db.from('training_feedback').insert(row).select().single();
  },
};

// ===== FINAL ASSESSMENT — one row per assignment =====
export const finalAssessments = {
  async getForAssignment(assignmentId: string) {
    return db
      .from('training_final_assessments')
      .select('*')
      .eq('assignment_id', assignmentId)
      .maybeSingle();
  },
  async upsert(row: any) {
    return db
      .from('training_final_assessments')
      .upsert(row, { onConflict: 'assignment_id' })
      .select()
      .single();
  },
  async update(id: string, patch: any) {
    return db.from('training_final_assessments').update(patch).eq('id', id).select().single();
  },
};

// ===== ACKNOWLEDGEMENT — one row per assignment =====
export const acknowledgements = {
  async getForAssignment(assignmentId: string) {
    return db
      .from('training_acknowledgements')
      .select('*')
      .eq('assignment_id', assignmentId)
      .maybeSingle();
  },
  async create(row: any) {
    return db.from('training_acknowledgements').insert(row).select().single();
  },
};

// ===== SUPERVISION NOTES — weekly trainer journal =====
export const supervisionNotes = {
  async listForAssignment(assignmentId: string) {
    return db
      .from('training_supervision_notes')
      .select('*, trainer:users!trainer_user_id(id, full_name, email)')
      .eq('assignment_id', assignmentId)
      .order('observed_on', { ascending: false });
  },
  async create(row: any) {
    return db.from('training_supervision_notes').insert(row).select().single();
  },
  async update(id: string, patch: any) {
    return db.from('training_supervision_notes').update(patch).eq('id', id).select().single();
  },
  async remove(id: string) {
    return db.from('training_supervision_notes').delete().eq('id', id);
  },
};

// ===== I-983 EVALUATIONS =====
export const evaluations = {
  async listForAssignment(assignmentId: string) {
    return db
      .from('training_evaluations')
      .select('*')
      .eq('assignment_id', assignmentId)
      .order('evaluation_date', { ascending: false });
  },
  async get(id: string) {
    return db.from('training_evaluations').select('*').eq('id', id).single();
  },
  async create(row: any) {
    return db.from('training_evaluations').insert(row).select().single();
  },
  async update(id: string, patch: any) {
    return db.from('training_evaluations').update(patch).eq('id', id).select().single();
  },
  async remove(id: string) {
    return db.from('training_evaluations').delete().eq('id', id);
  },
};
