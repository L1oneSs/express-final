import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { createApp } from '../src/app.js';
const tokens = [randomBytes(32).toString('hex'), randomBytes(32).toString('hex')];
const author = { login: 'student', fullName: 'Автор Работы' };
const lists = new Map();
const repository = {
  getLists: async owner => [...lists.values()].filter(list => list.owner === owner).map(({ owner, ...list }) => list),
  getList: async (owner, id) => lists.get(id)?.owner === owner ? (({ owner, ...list }) => list)(lists.get(id)) : undefined,
  createList: async (owner, input) => { if ([...lists.values()].some(list => list.owner === owner && list.runId === input.runId)) return; const list = { id: randomUUID(), ...input, owner, taskCount: 0, doneCount: 0, createdAt: new Date().toISOString() }; lists.set(list.id, list); return repository.getList(owner, list.id); },
  renameList: async (owner, id, name) => { if (lists.get(id)?.owner !== owner) return; lists.get(id).name = name; return repository.getList(owner, id); },
  list: async (owner, runId, status) => [{ id: randomUUID(), ownerLogin: owner, runId, title: status, done: status === 'done', createdAt: new Date().toISOString() }],
};
let server, base;
before(async () => { server = createApp({ author, tokens, repository }).listen(0, '127.0.0.1'); await once(server, 'listening'); base = `http://127.0.0.1:${server.address().port}`; });
after(() => new Promise(resolve => server.close(resolve)));
const api = (path, method = 'GET', body, index = 0) => fetch(base + '/api/' + path, { method, headers: { Authorization: `Bearer ${tokens[index]}`, 'Content-Type': 'application/json' }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
test('session role differs from immutable coursework author', async () => {
  assert.deepEqual(await (await api('session/')).json(), { role: 'owner', displayName: author.fullName, author });
  assert.deepEqual(await (await api('session/', 'GET', undefined, 1)).json(), { role: 'reviewer', displayName: 'Преподаватель', author });
  assert.deepEqual(await (await api('author/', 'GET', undefined, 1)).json(), author);
  assert.equal((await fetch(base + '/api/lists/')).status, 401);
});
test('named lists: creation, rename, stable runId, metadata and filtering', async () => {
  const response = await api('lists/', 'POST', { name: '  Учёба  ', runId: 'course' }); assert.equal(response.status, 201);
  const list = await response.json(); assert.equal(list.name, 'Учёба'); assert.equal(list.runId, 'course');
  assert.equal((await api('lists/', 'POST', { name: 'Дубль', runId: 'course' })).status, 409);
  assert.equal((await (await api('lists/')).json())[0].name, 'Учёба');
  const renamed = await (await api(`lists/${list.id}/`, 'PATCH', { name: 'Экзамены' })).json();
  assert.equal(renamed.name, 'Экзамены'); assert.equal(renamed.runId, 'course'); assert.equal(renamed.id, list.id);
  const filtered = await (await api(`lists/${list.id}/tasks/?status=done`)).json();
  assert.equal(filtered.list.name, 'Экзамены'); assert.equal(filtered.tasks[0].runId, 'course'); assert.equal(filtered.tasks[0].done, true);
  assert.equal((await api(`lists/${list.id}/tasks/?status=wrong`)).status, 400);
  const generated = await (await api('lists/', 'POST', { name: 'Без технического ключа' })).json(); assert.match(generated.runId, /^list_[a-f0-9]{32}$/);
  const hidden = randomUUID(); lists.set(hidden, { id: hidden, owner: 'other', name: 'Чужой список', runId: 'private' });
  assert.equal((await api(`lists/${hidden}/`)).status, 404); assert.equal((await api(`lists/${hidden}/`, 'PATCH', { name: 'Подмена' })).status, 404);
});
test('list input validation rejects empty names, types, extra fields and invalid identifiers', async () => {
  for (const body of [{}, [], null, { name: '' }, { name: ' ' }, { name: 5 }, { name: 'x'.repeat(101) }, { name: 'x', runId: 'a\n' }, { name: 'x', ownerLogin: 'other' }]) assert.equal((await api('lists/', 'POST', body)).status, 400);
  const id = randomUUID();
  for (const body of [{}, { name: 'x', runId: 'new' }, { name: null }]) assert.equal((await api(`lists/${id}/`, 'PATCH', body)).status, 400);
  assert.equal((await api('lists/invalid/')).status, 400);
  assert.equal((await api(`lists/${id}/`)).status, 404);
});
