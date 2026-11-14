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

export function createTaskRepository(pool) {
  return {
    async list(owner, runId) {
      const result = await pool.query(`SELECT ${fields} FROM public.tasks WHERE owner_login=$1 AND run_id=$2 ORDER BY created_at, id`, [owner, runId]);
      return result.rows.map(task);
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
