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
  '*, course:training_courses(id, title, category, thumbnail_url, difficulty, estimated_duration_hours),' +
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
    return db
      .from('training_courses')
      .select('*, lessons:training_lessons!course_id(*), quizzes:training_quizzes!course_id(*)')
      .eq('id', id)
      .single();
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

// ===== LESSONS =====
export const lessons = {
  async listByCourse(courseId: string) {
    return db
      .from('training_lessons')
      .select(LESSON_SELECT)
      .eq('course_id', courseId)
      .order('lesson_order');
  },
  async create(row: any) {
    return db.from('training_lessons').insert(row).select(LESSON_SELECT).single();
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
export const quizzes = {
  async listByCourse(courseId: string) {
    return db
      .from('training_quizzes')
      .select('*')
      .eq('course_id', courseId)
      .order('question_order');
  },
  async create(row: any) {
    return db.from('training_quizzes').insert(row).select().single();
  },
  async createMany(rows: any[]) {
    return db.from('training_quizzes').insert(rows).select();
  },
  async get(id: string) {
    return db.from('training_quizzes').select('*').eq('id', id).single();
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
