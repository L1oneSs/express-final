import express from 'express';
import { createHash, timingSafeEqual, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const validRunId = value => typeof value === 'string' && value.length >= 1 && value.length <= 64 && !/[^A-Za-z0-9_-]/.test(value);
const publicDirectory = fileURLToPath(new URL('../public/', import.meta.url));
const hash = value => createHash('sha256').update(value).digest();
class InputError extends Error {}
function validateBody(body, patch = false) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new InputError('Ожидается JSON-объект');
  const allowed = patch ? ['title', 'done'] : ['title', 'runId'];
  const keys = Object.keys(body);
  if (!keys.length || keys.some(key => !allowed.includes(key))) throw new InputError('Недопустимые или отсутствующие поля');
  if (!patch && (!Object.hasOwn(body, 'title') || !Object.hasOwn(body, 'runId'))) throw new InputError('Нужны title и runId');
  const result = {};
  if (Object.hasOwn(body, 'title')) {
    if (typeof body.title !== 'string') throw new InputError('title должен быть строкой');
    result.title = body.title.trim();
    const length = Array.from(result.title).length;
    if (length < 1 || length > 200) throw new InputError('title: от 1 до 200 символов');
  }
  if (Object.hasOwn(body, 'runId')) {
    if (!validRunId(body.runId)) throw new InputError('Некорректный runId');
    result.runId = body.runId;
  }
  if (Object.hasOwn(body, 'done')) {
    if (typeof body.done !== 'boolean') throw new InputError('done должен быть boolean');
    result.done = body.done;
  }
  return result;
}
function validateList(body, patch = false) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new InputError('Ожидается JSON-объект');
  const allowed = patch ? ['name'] : ['name', 'runId'];
  if (!Object.hasOwn(body, 'name') || Object.keys(body).some(key => !allowed.includes(key))) throw new InputError('Укажите название списка без лишних полей');
  if (typeof body.name !== 'string' || Array.from(body.name.trim()).length < 1 || Array.from(body.name.trim()).length > 100) throw new InputError('Название списка: от 1 до 100 символов');
  if (Object.hasOwn(body, 'runId') && !validRunId(body.runId)) throw new InputError('Некорректный runId');
  return { name: body.name.trim(), ...(!patch ? { runId: body.runId || `list_${randomUUID().replaceAll('-', '')}` } : {}) };
}

export function createApp({ author, tokens, repository }) {
  const app = express();
  app.disable('x-powered-by');
  app.set('strict routing', true);
  app.set('query parser', 'simple');
  const tokenHashes = tokens.map((token, index) => ({ digest: hash(token), role: index === 0 ? 'owner' : 'reviewer' }));
  app.use((req, res, next) => {
    res.set({
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
    });
    next();
  });
  app.get('/login/', (req, res) => res.type('text/plain').send(author.login));
  app.get('/health/', (req, res) => res.json({ status: 'ok' }));
  const api = express.Router({ strict: true });
  api.use((req, res, next) => {
    res.set('Cache-Control', 'no-store');
    const match = /^Bearer ([^\s]+)$/i.exec(req.get('authorization') || '');
    const candidate = hash(match?.[1] || '');
    const matches = tokenHashes.map(entry => timingSafeEqual(candidate, entry.digest));
    const matchedIndex = matches.indexOf(true);
    if (!match || matchedIndex < 0) {
      res.set('WWW-Authenticate', 'Bearer');
      return res.status(401).json({ error: 'Неверный или отсутствующий токен' });
    }
    req.accessRole = tokenHashes[matchedIndex].role;
    next();
  });
  // Authenticate before parsing JSON, including malformed unauthorized requests.
  api.use(express.json({ limit: '16kb', strict: true }));
  api.get('/author/', (req, res) => res.json(author));
  api.get('/session/', (req, res) => res.json({ role: req.accessRole, displayName: req.accessRole === 'reviewer' ? 'Преподаватель' : author.fullName, author }));
  api.get('/lists/', async (req, res) => res.json(await repository.getLists(author.login)));
  api.post('/lists/', async (req, res) => {
    const input = validateList(req.body);
    const created = await repository.createList(author.login, input);
    if (!created) return res.status(409).json({ error: 'Список с таким runId уже существует' });
    res.location(`/api/lists/${created.id}/`).status(201).json(created);
  });
  api.post('/tasks/', async (req, res) => {
    const input = validateBody(req.body);
    const created = await repository.create(author.login, input);
    res.location(`/api/tasks/${created.id}/`).status(201).json(created);
  });
  api.get('/tasks/', async (req, res) => {
    if (!validRunId(req.query.runId)) throw new InputError('Укажите корректный runId');
    res.json(await repository.list(author.login, req.query.runId));
  });
  api.param('id', (req, res, next, id) => {
    if (id.length !== 36 || !uuid.test(id)) return next(new InputError('Некорректный UUID'));
    req.params.id = id.toLowerCase();
    next();
  });
  api.get('/lists/:id/', async (req, res) => {
    const list = await repository.getList(author.login, req.params.id);
    if (!list) return res.status(404).json({ error: 'Список не найден' });
    res.json(list);
  });
  api.patch('/lists/:id/', async (req, res) => {
    const input = validateList(req.body, true);
    const list = await repository.renameList(author.login, req.params.id, input.name);
    if (!list) return res.status(404).json({ error: 'Список не найден' });
    res.json(list);
  });
  api.get('/lists/:id/tasks/', async (req, res) => {
    const filter = req.query.status ?? 'all';
    if (!['all', 'active', 'done'].includes(filter)) throw new InputError('Некорректный статус');
    const list = await repository.getList(author.login, req.params.id);
    if (!list) return res.status(404).json({ error: 'Список не найден' });
    res.json({ list, tasks: await repository.list(author.login, list.runId, filter) });
  });
  api.get('/tasks/:id/', async (req, res) => {
    const found = await repository.get(author.login, req.params.id);
    if (!found) return res.status(404).json({ error: 'Дело не найдено' });
    res.json(found);
  });
  api.patch('/tasks/:id/', async (req, res) => {
    const input = validateBody(req.body, true);
    const updated = await repository.update(author.login, req.params.id, input);
    if (!updated) return res.status(404).json({ error: 'Дело не найдено' });
    res.json(updated);
  });
  api.delete('/tasks/:id/', async (req, res) => {
    if (!await repository.remove(author.login, req.params.id)) return res.status(404).json({ error: 'Дело не найдено' });
    res.status(204).end();
  });
  api.use((req, res) => res.status(404).json({ error: 'Маршрут не найден' }));
  app.use('/api', api);
  app.use(express.static(publicDirectory, { dotfiles: 'deny', index: 'index.html' }));
  app.use((req, res) => res.status(404).type('text/plain').send('Страница не найдена'));
  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    const invalid = error instanceof InputError || error instanceof URIError || error.type === 'entity.parse.failed' || error.type === 'entity.too.large' || error.type === 'encoding.unsupported' || error.type === 'charset.unsupported' || error.type === 'request.aborted' || error.type === 'request.size.invalid';
    if (invalid) return res.status(400).json({ error: error instanceof InputError ? error.message : 'Некорректный JSON или размер запроса' });
    console.error('Ошибка обращения к БД');
    res.status(503).json({ error: 'База данных временно недоступна' });
  });
  return app;
}
