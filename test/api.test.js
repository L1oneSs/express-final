import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomBytes, randomUUID } from 'node:crypto';
import { createApp } from '../src/app.js';

const author = { login: 'test_author', fullName: 'Тестовый Автор' };
const token = randomBytes(32).toString('hex');
const tasks = new Map();
let unavailable = false;
const repository = {
  list: async (owner, runId) => { if (unavailable) throw new Error('Database offline'); return [...tasks.values()].filter(t => t.ownerLogin === owner && t.runId === runId); },
  get: async (owner, id) => { const row = tasks.get(id); return row?.ownerLogin === owner ? row : undefined; },
  create: async (ownerLogin, input) => { const row = { id: randomUUID(), ownerLogin, ...input, done: false, createdAt: new Date().toISOString() }; tasks.set(row.id, row); return row; },
  update: async (owner, id, input) => { const row = await repository.get(owner, id); if (row) Object.assign(row, input); return row; },
  remove: async (owner, id) => !!await repository.get(owner, id) && tasks.delete(id),
};
let server, base;
before(async () => { server = createApp({ author, tokens: [token], repository }).listen(0, '127.0.0.1'); await once(server, 'listening'); base = `http://127.0.0.1:${server.address().port}`; });
after(() => new Promise(resolve => server.close(resolve)));
function request(path, method = 'GET', body, authenticated = true) {
  return fetch(base + path, { method, headers: { ...(authenticated ? { Authorization: `Bearer ${token}` } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) }, ...(body !== undefined ? { body: typeof body === 'string' ? body : JSON.stringify(body) } : {}) });
}
async function expected(response, code) {
  assert.equal(response.status, code);
  if (code === 204) { assert.equal(await response.text(), ''); return; }
  assert.match(response.headers.get('content-type'), /^application\/json/);
  const value = await response.json();
  if (code >= 400) { assert.deepEqual(Object.keys(value), ['error']); assert.equal(typeof value.error, 'string'); }
  return value;
}
test('public login, actual interface and protected author', async () => {
  const login = await request('/login/', 'GET', undefined, false);
  assert.equal(login.status, 200); assert.match(login.headers.get('content-type'), /^text\/plain/); assert.equal(await login.text(), author.login);
  const page = await request('/', 'GET', undefined, false); assert.equal(page.status, 200); assert.match(await page.text(), /id="login-form"/);
  assert.deepEqual(await expected(await request('/api/author/'), 200), author);
});
test('every API request requires bearer authentication before JSON parsing', async () => {
  for (const path of ['/api/author/', '/api/tasks/?runId=x', `/api/tasks/${randomUUID()}/`, '/api/unknown/', '/api']) await expected(await request(path, 'GET', undefined, false), 401);
  await expected(await request('/api/tasks/', 'POST', '{', false), 401);
  await expected(await fetch(base + '/api/tasks/?runId=x', { headers: { Authorization: 'Bearer wrong' } }), 401);
});
test('complete CRUD contract, defaults, timestamps, and run isolation', async () => {
  assert.deepEqual(await expected(await request('/api/tasks/?runId=crud'), 200), []);
  const row = await expected(await request('/api/tasks/', 'POST', { title: '  Тест  ', runId: 'crud' }), 201);
  assert.deepEqual(Object.keys(row).sort(), ['id', 'ownerLogin', 'title', 'done', 'runId', 'createdAt'].sort());
  assert.equal(row.title, 'Тест'); assert.equal(row.done, false); assert.equal(row.ownerLogin, author.login); assert.match(row.createdAt, /Z$/); assert.equal(new Date(row.createdAt).toISOString(), row.createdAt);
  assert.deepEqual(await expected(await request(`/api/tasks/${row.id}/`), 200), row);
  assert.equal((await expected(await request('/api/tasks/?runId=crud'), 200)).length, 1);
  assert.deepEqual(await expected(await request('/api/tasks/?runId=other'), 200), []);
  let changed = await expected(await request(`/api/tasks/${row.id}/`, 'PATCH', { title: ' Новое ', done: true }), 200);
  assert.equal(changed.title, 'Новое'); assert.equal(changed.done, true); assert.equal(changed.createdAt, row.createdAt);
  changed = await expected(await request(`/api/tasks/${row.id}/`, 'PATCH', { done: false }), 200); assert.equal(changed.done, false);
  await expected(await request(`/api/tasks/${row.id}/`, 'DELETE'), 204);
  for (const method of ['GET', 'PATCH', 'DELETE']) await expected(await request(`/api/tasks/${row.id}/`, method, method === 'PATCH' ? { done: true } : undefined), 404);
});
test('reject invalid JSON, wrong types, empty/extra/server-controlled fields', async () => {
  for (const body of ['{', 'null', 'true', '42', '[]', '{}', { title: 'a' }, { runId: 'x' }, { title: 1, runId: 'x' }, { title: ' ', runId: 'x' }, { title: 'a'.repeat(201), runId: 'x' }, { title: 'a', runId: '' }, { title: 'a', runId: 'a'.repeat(65) }, { title: 'a', runId: 'неверно' }, { title: 'a', runId: 1 }, { title: 'a', runId: 'x', done: false }, { title: 'a', runId: 'x', ownerLogin: 'attacker' }, { title: 'a', runId: 'x', id: randomUUID() }, { title: 'a', runId: 'x', createdAt: new Date().toISOString() }, { title: 'a', runId: 'x', __proto_test: 'x' }]) await expected(await request('/api/tasks/', 'POST', body), 400);
  const id = randomUUID();
  for (const body of [{}, [], { done: 'true' }, { done: 1 }, { done: null }, { title: false }, { title: '' }, { runId: 'x' }, { title: 'valid', extra: true }, { ownerLogin: 'x' }]) await expected(await request(`/api/tasks/${id}/`, 'PATCH', body), 400);
  for (const query of ['', '?runId=', '?runId=bad%20id', '?runId=x&runId=y', '?runId[]=x']) await expected(await request('/api/tasks/' + query), 400);
  for (const method of ['GET', 'PATCH', 'DELETE']) await expected(await request('/api/tasks/invalid/', method, method === 'PATCH' ? { done: true } : undefined), 400);
});
test('unicode title length, strict slashes, unknown API and missing content-type', async () => {
  const row = await expected(await request('/api/tasks/', 'POST', { title: '😀'.repeat(200), runId: 'unicode' }), 201);
  await expected(await request(`/api/tasks/${row.id}/`, 'DELETE'), 204);
  await expected(await request('/api/tasks/', 'POST', { title: '😀'.repeat(201), runId: 'unicode' }), 400);
  await expected(await request('/api/tasks'), 404);
  await expected(await request('/api/author'), 404);
  await expected(await request('/api/not-found/'), 404);
  await expected(await fetch(base + '/api/tasks/', { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: JSON.stringify({ title: 'a', runId: 'x' }) }), 400);
});
test('database failure is a JSON 503 without internal details', async () => {
  unavailable = true;
  const result = await expected(await request('/api/tasks/?runId=offline'), 503);
  assert.doesNotMatch(result.error, /Database offline/);
  unavailable = false;
});
test('reject encoded line endings and invalid URL encoding', async () => {
  await expected(await request('/api/tasks/', 'POST', { title: 'Valid', runId: 'x\n' }), 400);
  await expected(await request('/api/tasks/?runId=x%0A'), 400);
  await expected(await request(`/api/tasks/${randomUUID()}%0A/`), 400);
  await expected(await request('/api/tasks/%ZZ/'), 400);
});
