import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { createApp } from '../src/app.js';
import { readConfig } from '../src/config.js';
import { createPool, createTaskRepository } from '../src/database.js';

const remoteBase = process.env.APP_URL?.trim().replace(/\/$/, '');
test(remoteBase ? 'deployed HTTPS API: independent PostgreSQL CRUD and permissions' : 'real PostgreSQL: API writes, independent reviewer CRUD, restart persistence and permissions', { timeout: 60000 }, async () => {
  const config = readConfig();
  assert.ok(process.env.REVIEWER_DATABASE_URL, 'Нужна REVIEWER_DATABASE_URL');
  const pool = createPool(config);
  const reviewer = createPool(config, process.env.REVIEWER_DATABASE_URL);
  const repository = createTaskRepository(pool);
  const runId = `check_${randomUUID().replaceAll('-', '')}`;
  const folderRunId = runId + '_folder';
  let server;
  async function start() { server = createApp({ ...config, repository }).listen(0, '127.0.0.1'); await once(server, 'listening'); return `http://127.0.0.1:${server.address().port}`; }
  if (remoteBase) assert.match(remoteBase, /^https:\/\//, 'Размещённый API должен использовать HTTPS');
  let base = remoteBase || await start();
  const headers = { Authorization: `Bearer ${config.tokens[0]}`, 'Content-Type': 'application/json' };
  const api = (path, method = 'GET', body) => fetch(base + '/api/' + path, { method, headers, ...(body ? { body: JSON.stringify(body) } : {}) });
  try {
    const login = await fetch(base + '/login/');
    assert.equal(login.status, 200); assert.match(login.headers.get('content-type'), /^text\/plain/); assert.equal(await login.text(), config.author.login);
    assert.equal((await fetch(base + '/api/author/')).status, 401);
    assert.deepEqual(await (await api('author/')).json(), config.author);
    assert.equal((await api('tasks/')).status, 400);
    assert.equal((await api('tasks/invalid/')).status, 400);
    assert.equal((await fetch(base + '/api/tasks/', { method: 'POST', headers, body: '{' })).status, 400);
    const roles = await reviewer.query('SELECT current_user, rolsuper, rolcreatedb, rolcreaterole, rolbypassrls FROM pg_roles WHERE rolname=current_user');
    assert.equal(roles.rows[0].current_user, 'todo_reviewer');
    for (const key of ['rolsuper', 'rolcreatedb', 'rolcreaterole', 'rolbypassrls']) assert.equal(roles.rows[0][key], false);
    await assert.rejects(reviewer.query('SELECT * FROM auth.users LIMIT 1'), e => e.code === '42501');
    await assert.rejects(reviewer.query('TRUNCATE public.tasks'), e => e.code === '42501');
    const created = await api('tasks/', 'POST', { title: 'Проверка через API', runId }); assert.equal(created.status, 201);
    const task = await created.json();
    assert.deepEqual(Object.keys(task).sort(), ['id','ownerLogin','title','done','runId','createdAt'].sort());
    const registered = (await (await api('lists/')).json()).find(list => list.runId === runId);
    assert.ok(registered, 'Обязательный POST с произвольным runId автоматически регистрирует список');
    const folderResponse = await api('lists/', 'POST', { name: 'Отдельный список', runId: folderRunId }); assert.equal(folderResponse.status, 201);
    const folder = await folderResponse.json();
    assert.equal((await api(`lists/${folder.id}/`, 'PATCH', { name: 'Новое название' })).status, 200);
    const folderPayload = await (await api(`lists/${folder.id}/tasks/`)).json();
    assert.equal(folderPayload.list.name, 'Новое название'); assert.equal(folderPayload.list.runId, folderRunId); assert.deepEqual(folderPayload.tasks, []);
    assert.equal((await api(`lists/${folder.id}/`, 'PATCH', { name: 'x', runId: 'forbidden' })).status, 400);
    const folderTask = await (await api('tasks/', 'POST', { title: 'Удаляется со списком', runId: folderRunId })).json();
    assert.equal((await api(`lists/${folder.id}/`, 'DELETE')).status, 204);
    assert.equal((await api(`lists/${folder.id}/`)).status, 404);
    assert.equal((await api(`tasks/${folderTask.id}/`)).status, 404);
    assert.equal((await reviewer.query('SELECT id FROM public.tasks WHERE id=$1', [folderTask.id])).rowCount, 0);
    assert.equal((await api(`tasks/${task.id}/`)).status, 200, 'Другие списки не затронуты');
    const reviewerSession = await fetch(base + '/api/session/', { headers: { Authorization: `Bearer ${process.env.REVIEWER_API_TOKEN}` } });
    assert.equal((await reviewerSession.json()).displayName, 'Преподаватель');
    const stored = await reviewer.query('SELECT title, owner_login, done FROM public.tasks WHERE id=$1', [task.id]);
    assert.equal(stored.rows[0].title, task.title); assert.equal(stored.rows[0].owner_login, config.author.login); assert.equal(stored.rows[0].done, false);
    const patched = await api(`tasks/${task.id}/`, 'PATCH', { done: true }); assert.equal(patched.status, 200);
    assert.equal((await reviewer.query('SELECT done FROM public.tasks WHERE id=$1', [task.id])).rows[0].done, true);
    const donePayload = await (await api(`lists/${registered.id}/tasks/?status=done`)).json();
    assert.equal(donePayload.tasks.length, 1); assert.equal(donePayload.list.doneCount, 1);
    await reviewer.query('UPDATE public.tasks SET title=$1, done=false WHERE id=$2', ['Изменено независимо в БД', task.id]);
    assert.equal((await (await api(`tasks/${task.id}/`)).json()).title, 'Изменено независимо в БД');
    if (!remoteBase) { await new Promise(resolve => server.close(resolve)); base = await start(); }
    assert.equal((await (await api(`tasks/${task.id}/`)).json()).title, 'Изменено независимо в БД');
    const inserted = await reviewer.query('INSERT INTO public.tasks(owner_login,title,run_id) VALUES($1,$2,$3) RETURNING id', [config.author.login, 'Добавлено напрямую в БД', runId]);
    const dbId = inserted.rows[0].id;
    assert.equal((await (await api('tasks/?runId=' + runId)).json()).length, 2);
    await reviewer.query('DELETE FROM public.tasks WHERE id=$1', [task.id]); assert.equal((await api(`tasks/${task.id}/`)).status, 404);
    assert.equal((await api(`tasks/${dbId}/`, 'DELETE')).status, 204);
    assert.equal((await reviewer.query('SELECT id FROM public.tasks WHERE id=$1', [dbId])).rowCount, 0);
    await assert.rejects(reviewer.query('INSERT INTO public.tasks(owner_login,title,run_id) VALUES($1,$2,$3)', [config.author.login, '', runId]), e => e.code === '23514');
    await pool.end();
    // A remote service owns its own pool; do not simulate downtime in production.
    if (!remoteBase) assert.equal((await api('tasks/?runId=' + runId)).status, 503);
  } finally {
    try {
      await reviewer.query('DELETE FROM public.tasks WHERE owner_login=$1 AND run_id=ANY($2::text[])', [config.author.login, [runId, folderRunId]]);
      await reviewer.query('DELETE FROM public.task_lists WHERE owner_login=$1 AND run_id=ANY($2::text[])', [config.author.login, [runId, folderRunId]]);
    } finally {
      if (server) await new Promise(resolve => server.close(resolve));
      await Promise.all([pool.ended ? Promise.resolve() : pool.end(), reviewer.end()]);
    }
  }
});
