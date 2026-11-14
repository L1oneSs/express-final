import pg from 'pg';
import { readFileSync } from 'node:fs';

export function createPool(config, connectionString = config.databaseUrl) {
  const pool = new pg.Pool({
    connectionString,
    ssl: config.ssl ? {
      rejectUnauthorized: true,
      ...(config.sslServername ? { servername: config.sslServername } : {}),
      ...(config.caFile ? { ca: readFileSync(config.caFile, 'utf8') } : {}),
    } : false,
    max: 5, connectionTimeoutMillis: 8000, idleTimeoutMillis: 10000,
    statement_timeout: 8000, application_name: 'express-final-tasks',
  });
  // Do not print connection strings, request bodies, or database error details.
  pool.on('error', () => console.error('Соединение с БД прервано'));
  return pool;
}

const fields = 'id, owner_login, title, done, run_id, created_at';
function task(row) {
  return row && {
    id: row.id, ownerLogin: row.owner_login, title: row.title, done: row.done,
    runId: row.run_id, createdAt: new Date(row.created_at).toISOString(),
  };
}
const listFields = `l.id,l.run_id,l.name,l.created_at,
  (SELECT count(*)::int FROM public.tasks t WHERE t.owner_login=l.owner_login AND t.run_id=l.run_id) AS task_count,
  (SELECT count(*)::int FROM public.tasks t WHERE t.owner_login=l.owner_login AND t.run_id=l.run_id AND t.done) AS done_count`;
function taskList(row) {
  return row && { id: row.id, runId: row.run_id, name: row.name, taskCount: row.task_count ?? 0, doneCount: row.done_count ?? 0, createdAt: new Date(row.created_at).toISOString() };
}

export function createTaskRepository(pool) {
  return {
    async list(owner, runId, status = 'all') {
      const result = await pool.query(`SELECT ${fields} FROM public.tasks WHERE owner_login=$1 AND run_id=$2 AND ($3::boolean IS NULL OR done=$3) ORDER BY created_at, id`, [owner, runId, status === 'all' ? null : status === 'done']);
      return result.rows.map(task);
    },
    async getLists(owner) {
      const result = await pool.query(`SELECT ${listFields} FROM public.task_lists l WHERE l.owner_login=$1 ORDER BY (l.run_id='manual') DESC,l.created_at,l.id`, [owner]);
      return result.rows.map(taskList);
    },
    async getList(owner, id) {
      const result = await pool.query(`SELECT ${listFields} FROM public.task_lists l WHERE l.owner_login=$1 AND l.id=$2`, [owner, id]);
      return taskList(result.rows[0]);
    },
    async createList(owner, { name, runId }) {
      const result = await pool.query('INSERT INTO public.task_lists(owner_login,run_id,name) VALUES($1,$2,$3) ON CONFLICT (owner_login,run_id) DO NOTHING RETURNING *', [owner, runId, name]);
      return taskList(result.rows[0]);
    },
    async renameList(owner, id, name) {
      const result = await pool.query('UPDATE public.task_lists SET name=$3 WHERE owner_login=$1 AND id=$2 RETURNING id', [owner, id, name]);
      return result.rowCount ? this.getList(owner, id) : undefined;
    },
    async removeList(owner, id) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await client.query('SELECT run_id FROM public.task_lists WHERE owner_login=$1 AND id=$2 FOR UPDATE', [owner, id]);
        if (!result.rowCount) { await client.query('ROLLBACK'); return false; }
        await client.query('DELETE FROM public.tasks WHERE owner_login=$1 AND run_id=$2', [owner, result.rows[0].run_id]);
        await client.query('DELETE FROM public.task_lists WHERE owner_login=$1 AND id=$2', [owner, id]);
        await client.query('COMMIT');
        return true;
      } catch (error) { await client.query('ROLLBACK'); throw error; }
      finally { client.release(); }
    },
    async get(owner, id) {
      const result = await pool.query(`SELECT ${fields} FROM public.tasks WHERE owner_login=$1 AND id=$2`, [owner, id]);
      return task(result.rows[0]);
    },
    async create(owner, input) {
      const result = await pool.query(`INSERT INTO public.tasks (owner_login, title, run_id) VALUES ($1,$2,$3) RETURNING ${fields}`, [owner, input.title, input.runId]);
      return task(result.rows[0]);
    },
    async update(owner, id, input) {
      const result = await pool.query(`UPDATE public.tasks SET title=COALESCE($3,title), done=COALESCE($4,done) WHERE owner_login=$1 AND id=$2 RETURNING ${fields}`, [owner, id, input.title ?? null, input.done ?? null]);
      return task(result.rows[0]);
    },
    async remove(owner, id) {
      const result = await pool.query('DELETE FROM public.tasks WHERE owner_login=$1 AND id=$2 RETURNING id', [owner, id]);
      return result.rowCount > 0;
    },
  };
}
