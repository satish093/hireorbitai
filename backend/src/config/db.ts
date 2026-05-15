/**
 * HireOrbit AI — self-hosted Postgres adapter.
 *
 * Exposes a `db` object whose `.from(table)` returns a small PostgREST-style
 * query builder backed by `pg`. The shape mirrors the subset of the legacy PostgREST
 * JS API we used so the controllers and services can keep their familiar
 * chained calls (`db.from('users').select('id').eq('id', x).maybeSingle()`)
 * without rewriting every callsite to raw SQL.
 *
 * The builder is intentionally minimal — it covers what the codebase needs:
 *   select / insert / update / upsert / delete
 *   eq / neq / gt / gte / lt / lte / is / in / like / ilike / or / not /
 *     filter / match / contains / overlaps
 *   order / limit / range
 *   single / maybeSingle / count
 *   foreign-key embedded selects:  '*, vendor:vendors(*)'
 *     (translates into a LATERAL json_agg per embed)
 *
 * It is NOT a full PostgREST. If you need a feature that isn't here, write
 * the SQL directly with `db.query(...)`.
 */

import { Pool, QueryResult } from 'pg';
import { env } from './env';

const sslConfig =
  env.database.ssl === 'disable'
    ? false
    : env.database.ssl === 'require'
      ? { rejectUnauthorized: true }
      : { rejectUnauthorized: false };

export const pool = new Pool({
  connectionString: env.database.url,
  ssl: sslConfig,
  max: 20,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

pool.on('error', (err) => {
  // eslint-disable-next-line no-console
  console.error('[pg-pool] idle client error:', err);
});

// ---------------------------------------------------------------------------
// Identifier quoting + value placeholder helpers
// ---------------------------------------------------------------------------

function qi(name: string): string {
  // Quote identifier (table / column / alias). Reject anything weird so we
  // can never accidentally splice user input into a SQL identifier.
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) {
    throw new Error(`db: unsafe identifier ${JSON.stringify(name)}`);
  }
  return `"${name}"`;
}

interface Args {
  text: string;
  values: unknown[];
  push: (v: unknown) => string; // returns "$N"
}
function newArgs(): Args {
  const values: unknown[] = [];
  return {
    text: '',
    values,
    push(v) {
      values.push(v);
      return '$' + values.length;
    },
  };
}

// ---------------------------------------------------------------------------
// Response shape (mirrors the legacy PostgREST client we replaced).
// ---------------------------------------------------------------------------
export interface DbResponse<T> {
  data: T | null;
  error: { message: string; code?: string } | null;
  count?: number | null;
}

// ---------------------------------------------------------------------------
// Filter representation
// ---------------------------------------------------------------------------
type FilterOp =
  | 'eq'
  | 'neq'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'is'
  | 'in'
  | 'like'
  | 'ilike'
  | 'not'
  | 'or'
  | 'contains'
  | 'overlaps';
interface Filter {
  op: FilterOp;
  col?: string;
  value?: unknown;
  /** For `or`, a free-form PostgREST OR string like "a.eq.1,b.ilike.*x*". */
  raw?: string;
  /** For `not`, holds the inner op + value. */
  notOp?: string;
}

function renderFilter(f: Filter, a: Args): string {
  switch (f.op) {
    case 'eq':
      return `${qi(f.col!)} = ${a.push(f.value)}`;
    case 'neq':
      return `${qi(f.col!)} <> ${a.push(f.value)}`;
    case 'gt':
      return `${qi(f.col!)} > ${a.push(f.value)}`;
    case 'gte':
      return `${qi(f.col!)} >= ${a.push(f.value)}`;
    case 'lt':
      return `${qi(f.col!)} < ${a.push(f.value)}`;
    case 'lte':
      return `${qi(f.col!)} <= ${a.push(f.value)}`;
    case 'is':
      // `.is('col', null)` → IS NULL; `.is('col', true)` → IS TRUE
      if (f.value === null) return `${qi(f.col!)} IS NULL`;
      if (f.value === true) return `${qi(f.col!)} IS TRUE`;
      if (f.value === false) return `${qi(f.col!)} IS FALSE`;
      return `${qi(f.col!)} IS NOT DISTINCT FROM ${a.push(f.value)}`;
    case 'in': {
      const arr = Array.isArray(f.value) ? (f.value as unknown[]) : [];
      if (arr.length === 0) return 'FALSE';
      return `${qi(f.col!)} = ANY(${a.push(arr)})`;
    }
    case 'like':
      return `${qi(f.col!)} LIKE ${a.push(f.value)}`;
    case 'ilike':
      return `${qi(f.col!)} ILIKE ${a.push(f.value)}`;
    case 'contains': {
      // For jsonb / array columns. Use Postgres @> operator.
      return `${qi(f.col!)} @> ${a.push(f.value)}`;
    }
    case 'overlaps':
      return `${qi(f.col!)} && ${a.push(f.value)}`;
    case 'not': {
      const inner: Filter = { op: f.notOp as FilterOp, col: f.col, value: f.value };
      return `NOT (${renderFilter(inner, a)})`;
    }
    case 'or':
      return `(${renderOr(f.raw!, a)})`;
  }
}

// Parse a single PostgREST condition like "name.ilike.*foo*" or "id.eq.123"
// or "is_active.is.null". Returns a SQL fragment.
function renderPostgrestCondition(cond: string, a: Args): string {
  const trimmed = cond.trim();
  // not.<op>.<value> wrapper
  if (trimmed.startsWith('not.')) {
    const rest = trimmed.slice(4);
    return `NOT (${renderPostgrestCondition(rest, a)})`;
  }
  const m = trimmed.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\.([a-z]+)\.(.*)$/s);
  if (!m) {
    throw new Error(`db: cannot parse OR/filter condition ${JSON.stringify(cond)}`);
  }
  const col = m[1]!;
  const op = m[2]!;
  let raw = m[3]!;
  let value: unknown = raw;
  // PostgREST uses '*' as the SQL '%' wildcard for like/ilike.
  if (op === 'like' || op === 'ilike') {
    value = raw.replaceAll('*', '%');
  }
  if (op === 'is') {
    if (raw === 'null') value = null;
    else if (raw === 'true') value = true;
    else if (raw === 'false') value = false;
  }
  if (op === 'in') {
    // PostgREST: in.(1,2,3)
    const inner = raw.replace(/^\(|\)$/g, '');
    value = inner.split(',').map((s) => s.trim());
  }
  return renderFilter({ op: op as FilterOp, col, value }, a);
}

function renderOr(orString: string, a: Args): string {
  // PostgREST OR: comma-separated list, but commas inside parens (for in.()) must be preserved.
  const parts: string[] = [];
  let depth = 0;
  let buf = '';
  for (const ch of orString) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) {
      parts.push(buf);
      buf = '';
    } else {
      buf += ch;
    }
  }
  if (buf.length) parts.push(buf);
  return parts.map((p) => renderPostgrestCondition(p, a)).join(' OR ');
}

// ---------------------------------------------------------------------------
// Select-clause parsing for embedded FK joins ("*, vendor:vendors(*)").
// ---------------------------------------------------------------------------
interface EmbedSpec {
  alias: string; // result key on parent row
  table: string; // child table
  fkColumn?: string; // explicit FK like users!user_id (parent column name)
  fields: string; // child field list ("*" or "id,full_name")
}

interface ParsedSelect {
  /** Column expressions on the parent row (raw, will be inserted as-is — only used for "*" or simple "col,col"). */
  parentCols: string;
  embeds: EmbedSpec[];
}

function parseSelect(input: string): ParsedSelect {
  if (!input || input.trim() === '') return { parentCols: '*', embeds: [] };
  // Tokenize at top-level commas (commas inside parens belong to embeds).
  const tokens: string[] = [];
  let depth = 0;
  let buf = '';
  for (const ch of input) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) {
      tokens.push(buf.trim());
      buf = '';
    } else {
      buf += ch;
    }
  }
  if (buf.trim()) tokens.push(buf.trim());

  const parentCols: string[] = [];
  const embeds: EmbedSpec[] = [];
  for (const t of tokens) {
    const m = t.match(
      /^(?:([a-zA-Z_][a-zA-Z0-9_]*):)?([a-zA-Z_][a-zA-Z0-9_]*)(?:!([a-zA-Z_][a-zA-Z0-9_]*))?\((.*)\)$/s,
    );
    if (m) {
      embeds.push({
        alias: m[1] ?? m[2]!,
        table: m[2]!,
        fkColumn: m[3] ?? undefined,
        fields: m[4]!.trim() || '*',
      });
    } else {
      parentCols.push(t);
    }
  }
  return {
    parentCols:
      parentCols.length === 0
        ? '*'
        : parentCols.map((c) => (c === '*' ? '*' : qi(c.trim()))).join(', '),
    embeds,
  };
}

// Build a LATERAL subquery for an embed, returning either a single object
// (when fkColumn references parent) or an array.
//
// Strategy:
//   - If `fkColumn` is provided (e.g. "user:users!user_id"), treat as a
//     to-one relationship: parent.<fkColumn> = child.id. Result is a single
//     object or null.
//   - Otherwise, infer by table name: try `child.<parent_singular>_id =
//     parent.id` (to-many) OR `parent.<child_singular>_id = child.id`
//     (to-one). We can't introspect at runtime, so we go to-one by default
//     (parent.<table_singular>_id = child.id), which matches every usage in
//     this codebase. If you need to-many, write the SQL by hand.
function buildEmbedSubquery(parentTable: string, e: EmbedSpec, a: Args): string {
  const fk = e.fkColumn ?? `${singularize(e.table)}_id`;
  const childPK = 'id';
  const fields =
    e.fields === '*'
      ? `${qi(e.table)}.*`
      : e.fields
          .split(',')
          .map((c) => `${qi(e.table)}.${qi(c.trim())}`)
          .join(', ');
  return `(
    SELECT row_to_json(emb) FROM (
      SELECT ${fields}
      FROM ${qi(e.table)}
      WHERE ${qi(e.table)}.${qi(childPK)} = ${qi(parentTable)}.${qi(fk)}
      LIMIT 1
    ) AS emb
  ) AS ${qi(e.alias)}`;
}

function singularize(t: string): string {
  // Naive English singularization. Good enough for our table names.
  if (t.endsWith('ies')) return t.slice(0, -3) + 'y';
  if (t.endsWith('ses')) return t.slice(0, -2);
  if (t.endsWith('s')) return t.slice(0, -1);
  return t;
}

// ---------------------------------------------------------------------------
// QUERY BUILDER
// ---------------------------------------------------------------------------

type Mode = 'select' | 'insert' | 'update' | 'upsert' | 'delete';

class QueryBuilder<T = any> implements PromiseLike<DbResponse<T>> {
  private mode: Mode = 'select';
  private table: string;
  private selectExpr = '*';
  private filters: Filter[] = [];
  private orders: { col: string; ascending: boolean; nullsFirst?: boolean }[] = [];
  private limitN: number | null = null;
  private offsetN: number | null = null;
  private rangeFrom: number | null = null;
  private rangeTo: number | null = null;
  private wantSingle = false;
  private wantMaybeSingle = false;
  private wantCount: 'exact' | 'planned' | 'estimated' | null = null;
  private writePayload: Record<string, unknown> | Record<string, unknown>[] | null = null;
  private upsertConflict: string | null = null;
  private upsertIgnoreDuplicates = false;
  private hasReturning = false;
  private headOnly = false;

  constructor(table: string) {
    this.table = table;
  }

  // --- select / write entry points -----------------------------------------

  select(
    expr?: string,
    opts?: { count?: 'exact' | 'planned' | 'estimated'; head?: boolean },
  ): this {
    if (this.mode === 'select') {
      this.selectExpr = expr ?? '*';
    } else {
      // .insert/.update/.delete followed by .select() means RETURNING.
      this.hasReturning = true;
      this.selectExpr = expr ?? '*';
    }
    if (opts?.count) this.wantCount = opts.count;
    if (opts?.head) this.headOnly = true;
    return this;
  }

  insert(
    payload: Record<string, unknown> | Record<string, unknown>[],
    opts?: { count?: 'exact' | 'planned' | 'estimated' },
  ): this {
    this.mode = 'insert';
    this.writePayload = payload;
    if (opts?.count) this.wantCount = opts.count;
    return this;
  }

  update(
    payload: Record<string, unknown>,
    opts?: { count?: 'exact' | 'planned' | 'estimated' },
  ): this {
    this.mode = 'update';
    this.writePayload = payload;
    if (opts?.count) this.wantCount = opts.count;
    return this;
  }

  upsert(
    payload: Record<string, unknown> | Record<string, unknown>[],
    opts?: {
      onConflict?: string;
      ignoreDuplicates?: boolean;
      count?: 'exact' | 'planned' | 'estimated';
    },
  ): this {
    this.mode = 'upsert';
    this.writePayload = payload;
    this.upsertConflict = opts?.onConflict ?? null;
    this.upsertIgnoreDuplicates = !!opts?.ignoreDuplicates;
    if (opts?.count) this.wantCount = opts.count;
    return this;
  }

  delete(opts?: { count?: 'exact' | 'planned' | 'estimated' }): this {
    this.mode = 'delete';
    if (opts?.count) this.wantCount = opts.count;
    return this;
  }

  // --- filters --------------------------------------------------------------

  eq(col: string, value: unknown) {
    this.filters.push({ op: 'eq', col, value });
    return this;
  }
  neq(col: string, value: unknown) {
    this.filters.push({ op: 'neq', col, value });
    return this;
  }
  gt(col: string, value: unknown) {
    this.filters.push({ op: 'gt', col, value });
    return this;
  }
  gte(col: string, value: unknown) {
    this.filters.push({ op: 'gte', col, value });
    return this;
  }
  lt(col: string, value: unknown) {
    this.filters.push({ op: 'lt', col, value });
    return this;
  }
  lte(col: string, value: unknown) {
    this.filters.push({ op: 'lte', col, value });
    return this;
  }
  is(col: string, value: unknown) {
    this.filters.push({ op: 'is', col, value });
    return this;
  }
  in(col: string, value: unknown[]) {
    this.filters.push({ op: 'in', col, value });
    return this;
  }
  like(col: string, value: string) {
    this.filters.push({ op: 'like', col, value });
    return this;
  }
  ilike(col: string, value: string) {
    this.filters.push({ op: 'ilike', col, value });
    return this;
  }
  contains(col: string, value: unknown) {
    this.filters.push({ op: 'contains', col, value });
    return this;
  }
  overlaps(col: string, value: unknown) {
    this.filters.push({ op: 'overlaps', col, value });
    return this;
  }
  not(col: string, op: string, value: unknown) {
    this.filters.push({ op: 'not', notOp: op, col, value });
    return this;
  }
  or(expr: string) {
    this.filters.push({ op: 'or', raw: expr });
    return this;
  }
  filter(col: string, op: string, value: unknown) {
    // PostgREST's escape hatch — treat just like the named ops.
    this.filters.push({ op: op as FilterOp, col, value });
    return this;
  }
  match(obj: Record<string, unknown>) {
    for (const [k, v] of Object.entries(obj)) {
      this.filters.push({ op: 'eq', col: k, value: v });
    }
    return this;
  }

  // --- order / pagination ---------------------------------------------------

  order(col: string, opts?: { ascending?: boolean; nullsFirst?: boolean }) {
    this.orders.push({ col, ascending: opts?.ascending !== false, nullsFirst: opts?.nullsFirst });
    return this;
  }
  limit(n: number) {
    this.limitN = n;
    return this;
  }
  range(from: number, to: number) {
    this.rangeFrom = from;
    this.rangeTo = to;
    return this;
  }

  // --- terminators ----------------------------------------------------------

  single(): this {
    this.wantSingle = true;
    return this;
  }
  maybeSingle(): this {
    this.wantMaybeSingle = true;
    return this;
  }

  // --- SQL builder ----------------------------------------------------------

  private buildWhere(a: Args): string {
    if (this.filters.length === 0) return '';
    const parts = this.filters.map((f) => renderFilter(f, a));
    return ' WHERE ' + parts.join(' AND ');
  }

  private buildOrderLimit(a: Args): string {
    let s = '';
    if (this.orders.length) {
      s +=
        ' ORDER BY ' +
        this.orders
          .map(
            (o) =>
              `${qi(o.col)} ${o.ascending ? 'ASC' : 'DESC'}${o.nullsFirst !== undefined ? (o.nullsFirst ? ' NULLS FIRST' : ' NULLS LAST') : ''}`,
          )
          .join(', ');
    }
    if (this.limitN !== null) {
      s += ' LIMIT ' + a.push(this.limitN);
    }
    if (this.offsetN !== null) {
      s += ' OFFSET ' + a.push(this.offsetN);
    }
    if (this.rangeFrom !== null && this.rangeTo !== null) {
      // PostgREST range is inclusive on both ends.
      const count = this.rangeTo - this.rangeFrom + 1;
      s += ' LIMIT ' + a.push(count) + ' OFFSET ' + a.push(this.rangeFrom);
    }
    return s;
  }

  private buildSelectSQL(a: Args): string {
    const parsed = parseSelect(this.selectExpr);
    const cols: string[] = [];
    if (parsed.parentCols === '*') {
      cols.push(`${qi(this.table)}.*`);
    } else {
      cols.push(parsed.parentCols);
    }
    for (const e of parsed.embeds) {
      cols.push(buildEmbedSubquery(this.table, e, a));
    }
    let sql = `SELECT ${cols.join(', ')} FROM ${qi(this.table)}`;
    sql += this.buildWhere(a);
    sql += this.buildOrderLimit(a);
    return sql;
  }

  private buildInsertSQL(a: Args): string {
    const rows = Array.isArray(this.writePayload)
      ? this.writePayload
      : [this.writePayload as Record<string, unknown>];
    if (rows.length === 0 || !rows[0]) throw new Error('db: insert with empty payload');
    const cols = Object.keys(rows[0]);
    const placeholders = rows
      .map((r) => '(' + cols.map((c) => a.push(r[c])).join(', ') + ')')
      .join(', ');
    let sql = `INSERT INTO ${qi(this.table)} (${cols.map(qi).join(', ')}) VALUES ${placeholders}`;
    if (this.mode === 'upsert') {
      const conflictCols = (this.upsertConflict ?? 'id')
        .split(',')
        .map((s) => qi(s.trim()))
        .join(', ');
      if (this.upsertIgnoreDuplicates) {
        sql += ` ON CONFLICT (${conflictCols}) DO NOTHING`;
      } else {
        const updateCols = cols.filter(
          (c) =>
            !this.upsertConflict
              ?.split(',')
              .map((s) => s.trim())
              .includes(c),
        );
        if (updateCols.length === 0) {
          sql += ` ON CONFLICT (${conflictCols}) DO NOTHING`;
        } else {
          sql +=
            ` ON CONFLICT (${conflictCols}) DO UPDATE SET ` +
            updateCols.map((c) => `${qi(c)} = EXCLUDED.${qi(c)}`).join(', ');
        }
      }
    }
    if (this.hasReturning) sql += ` RETURNING ${this.selectExpr === '*' ? '*' : this.selectExpr}`;
    else sql += ` RETURNING *`;
    return sql;
  }

  private buildUpdateSQL(a: Args): string {
    const payload = this.writePayload as Record<string, unknown>;
    const cols = Object.keys(payload);
    if (cols.length === 0) throw new Error('db: update with empty payload');
    const sets = cols.map((c) => `${qi(c)} = ${a.push(payload[c])}`).join(', ');
    let sql = `UPDATE ${qi(this.table)} SET ${sets}`;
    sql += this.buildWhere(a);
    sql += ` RETURNING ${this.hasReturning ? (this.selectExpr === '*' ? '*' : this.selectExpr) : '*'}`;
    return sql;
  }

  private buildDeleteSQL(a: Args): string {
    let sql = `DELETE FROM ${qi(this.table)}`;
    sql += this.buildWhere(a);
    sql += ` RETURNING ${this.hasReturning ? (this.selectExpr === '*' ? '*' : this.selectExpr) : '*'}`;
    return sql;
  }

  private buildCountSQL(a: Args): string {
    let sql = `SELECT COUNT(*)::int AS count FROM ${qi(this.table)}`;
    sql += this.buildWhere(a);
    return sql;
  }

  // --- execution -----------------------------------------------------------

  private async exec(): Promise<DbResponse<T>> {
    const a = newArgs();
    let result: QueryResult = { rows: [] } as unknown as QueryResult;
    let countResult: number | null = null;
    try {
      // head:true is a count-only request — skip the data SELECT entirely.
      if (this.headOnly && this.mode === 'select') {
        // No-op: result.rows stays empty; we just compute count below.
      } else {
        let sql: string;
        switch (this.mode) {
          case 'select':
            sql = this.buildSelectSQL(a);
            break;
          case 'insert':
          case 'upsert':
            sql = this.buildInsertSQL(a);
            break;
          case 'update':
            sql = this.buildUpdateSQL(a);
            break;
          case 'delete':
            sql = this.buildDeleteSQL(a);
            break;
        }
        result = await pool.query(sql, a.values);
      }
      if (this.wantCount) {
        if (this.mode === 'select') {
          const cArgs = newArgs();
          const cSql = this.buildCountSQL(cArgs);
          const cRes = await pool.query(cSql, cArgs.values);
          countResult = Number(cRes.rows[0]?.count ?? 0);
        } else {
          // For write modes, count = rows affected (RETURNING * gives them).
          countResult = result.rowCount ?? result.rows.length;
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const code = (err as { code?: string })?.code;
      return { data: null, error: { message: msg, code } };
    }

    if (this.wantSingle) {
      if (result.rows.length !== 1) {
        return {
          data: null,
          error: {
            message:
              result.rows.length === 0
                ? 'JSON object requested, multiple (or no) rows returned'
                : 'JSON object requested, multiple (or no) rows returned',
            code: result.rows.length === 0 ? 'PGRST116' : 'PGRST117',
          },
        };
      }
      return { data: result.rows[0] as T, error: null };
    }
    if (this.wantMaybeSingle) {
      if (result.rows.length > 1) {
        return {
          data: null,
          error: { message: 'maybeSingle: more than one row returned', code: 'PGRST117' },
        };
      }
      return { data: (result.rows[0] ?? null) as T | null, error: null };
    }
    return { data: result.rows as unknown as T, error: null, count: countResult };
  }

  // PromiseLike — awaiting the builder triggers exec().
  then<TResult1 = DbResponse<T>, TResult2 = never>(
    onfulfilled?: ((v: DbResponse<T>) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return this.exec().then(onfulfilled ?? undefined, onrejected ?? undefined);
  }
}

// ---------------------------------------------------------------------------
// Top-level db API
// ---------------------------------------------------------------------------

import * as auth from './auth.local';
import * as storage from './storage.local';

export const db = {
  /** Run a raw parameterized SQL query against the pool. */
  query: (text: string, values?: unknown[]) => pool.query(text, values),

  /** Builder entry. Chain like the legacy PostgREST client. */
  from<T = any>(table: string): QueryBuilder<T> {
    return new QueryBuilder<T>(table);
  },

  auth,
  storage,
};
