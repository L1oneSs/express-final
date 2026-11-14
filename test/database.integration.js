import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { createApp } from '../src/app.js';
import { readConfig } from '../src/config.js';
import { createPool, createTaskRepository } from '../src/database.js';

test('real PostgreSQL: API writes, independent reviewer CRUD, restart persistence and permissions', { timeout: 60000 }, async () => {
  const config = readConfig();
  assert.ok(process.env.REVIEWER_DATABASE_URL, 'Нужна REVIEWER_DATABASE_URL');
  const pool = createPool(config);
  const reviewer = createPool(config, process.env.REVIEWER_DATABASE_URL);
  const repository = createTaskRepository(pool);
  const runId = `check_${randomUUID().replaceAll('-', '')}`;
  let server;
  async function start() { server = createApp({ ...config, repository }).listen(0, '127.0.0.1'); await once(server, 'listening'); return `http://127.0.0.1:${server.address().port}`; }
  let base = await start();
  const headers = { Authorization: `Bearer ${config.tokens[0]}`, 'Content-Type': 'application/json' };
  const api = (path, method = 'GET', body) => fetch(base + '/api/' + path, { method, headers, ...(body ? { body: JSON.stringify(body) } : {}) });
  try {
    const roles = await reviewer.query('SELECT current_user, rolsuper, rolcreatedb, rolcreaterole, rolbypassrls FROM pg_roles WHERE rolname=current_user');
    assert.equal(roles.rows[0].current_user, 'todo_reviewer');
    for (const key of ['rolsuper', 'rolcreatedb', 'rolcreaterole', 'rolbypassrls']) assert.equal(roles.rows[0][key], false);
    await assert.rejects(reviewer.query('SELECT * FROM auth.users LIMIT 1'), e => e.code === '42501');
    await assert.rejects(reviewer.query('TRUNCATE public.tasks'), e => e.code === '42501');
    const created = await api('tasks/', 'POST', { title: 'Проверка через API', runId }); assert.equal(created.status, 201);
    const task = await created.json();
    const stored = await reviewer.query('SELECT title, owner_login, done FROM public.tasks WHERE id=$1', [task.id]);
    assert.equal(stored.rows[0].title, task.title); assert.equal(stored.rows[0].owner_login, config.author.login); assert.equal(stored.rows[0].done, false);
    const patched = await api(`tasks/${task.id}/`, 'PATCH', { done: true }); assert.equal(patched.status, 200);
    assert.equal((await reviewer.query('SELECT done FROM public.tasks WHERE id=$1', [task.id])).rows[0].done, true);
    await reviewer.query('UPDATE public.tasks SET title=$1, done=false WHERE id=$2', ['Изменено независимо в БД', task.id]);
    assert.equal((await (await api(`tasks/${task.id}/`)).json()).title, 'Изменено независимо в БД');
    await new Promise(resolve => server.close(resolve)); base = await start();
    assert.equal((await (await api(`tasks/${task.id}/`)).json()).title, 'Изменено независимо в БД');
    const inserted = await reviewer.query('INSERT INTO public.tasks(owner_login,title,run_id) VALUES($1,$2,$3) RETURNING id', [config.author.login, 'Добавлено напрямую в БД', runId]);
    const dbId = inserted.rows[0].id;
    assert.equal((await (await api('tasks/?runId=' + runId)).json()).length, 2);
    await reviewer.query('DELETE FROM public.tasks WHERE id=$1', [task.id]); assert.equal((await api(`tasks/${task.id}/`)).status, 404);
    assert.equal((await api(`tasks/${dbId}/`, 'DELETE')).status, 204);
    assert.equal((await reviewer.query('SELECT id FROM public.tasks WHERE id=$1', [dbId])).rowCount, 0);
    await assert.rejects(reviewer.query('INSERT INTO public.tasks(owner_login,title,run_id) VALUES($1,$2,$3)', [config.author.login, '', runId]), e => e.code === '23514');
    await pool.end();
    assert.equal((await api('tasks/?runId=' + runId)).status, 503);
  } finally {
    try {
      await reviewer.query('DELETE FROM public.tasks WHERE owner_login=$1 AND run_id=$2', [config.author.login, runId]);
    } finally {
      await new Promise(resolve => server.close(resolve));
      await Promise.all([pool.ended ? Promise.resolve() : pool.end(), reviewer.end()]);
    }
  }
});
