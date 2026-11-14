const $ = selector => document.querySelector(selector);
const state = { token: '', tasks: [], filter: 'all', runId: 'manual', request: 0, busy: false };
const titleLength = value => Array.from(value.trim()).length;
$('#today').textContent = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date());
function status(message = '', error = false) {
  $('#status').textContent = message;
  $('#status').classList.toggle('error', error);
}
function logout() {
  state.token = ''; state.tasks = []; state.request++;
  $('#workspace').hidden = true; $('#login-panel').hidden = false; $('#logout').hidden = true;
  $('#profile-name').textContent = 'Ваше пространство'; $('#profile-login').textContent = 'Войдите с токеном';
  $('#sidebar-count').textContent = '0'; $('#tasks').replaceChildren(); $('#token').value = '';
}
async function api(path, options = {}) {
  let response;
  try {
    response = await fetch(`/api/${path}`, { ...options, cache: 'no-store', headers: { Authorization: `Bearer ${state.token}`, ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers } });
  } catch { throw new Error('Нет связи с сервером. Попробуйте ещё раз.'); }
  if (!response.ok) {
    const message = await response.json().catch(() => ({ error: 'Не удалось выполнить запрос' }));
    if (response.status === 401) logout();
    throw new Error(message.error);
  }
  return response.status === 204 ? null : response.json();
}
function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
async function withButton(button, action) {
  button.disabled = true;
  try { await action(); } catch (error) { status(error.message, true); }
  finally { button.disabled = false; }
}
function render() {
  const total = state.tasks.length;
  const done = state.tasks.filter(task => task.done).length;
  for (const selector of ['#total-stat', '#all-count', '#list-count', '#sidebar-count']) $(selector).textContent = total;
  $('#done-stat').textContent = done; $('#active-stat').textContent = total - done;
  $('#progress').value = total ? Math.round(done / total * 100) : 0;
  $('#progress-label').textContent = total ? `Завершено ${Math.round(done / total * 100)}% — так держать` : 'Каждое дело — маленький шаг';
  $('#remaining').textContent = total === done ? 'Нет незавершённых дел' : `Осталось завершить: ${total - done}`;
  const visible = state.tasks.filter(task => state.filter === 'all' || (state.filter === 'done' ? task.done : !task.done));
  $('#empty').hidden = visible.length > 0;
  $('#empty h3').textContent = total ? 'Всё спокойно' : 'Здесь есть место для нового';
  $('#empty p').textContent = total ? 'В этом фильтре пока нет дел. Откройте другой или добавьте новое.' : 'Добавьте первое дело — и мысли станут чуть свободнее.';
  const nodes = visible.map(task => {
    const row = element('li', `task${task.done ? ' done' : ''}`);
    const checkbox = element('input', 'task-check'); checkbox.type = 'checkbox'; checkbox.checked = task.done;
    checkbox.setAttribute('aria-label', `Отметить ${task.done ? 'невыполненным' : 'выполненным'}: ${task.title}`);
    checkbox.addEventListener('change', () => withButton(checkbox, async () => {
      try { await api(`tasks/${task.id}/`, { method: 'PATCH', body: JSON.stringify({ done: checkbox.checked }) }); }
      catch (error) { checkbox.checked = task.done; throw error; }
      await load(); status(task.done ? 'Дело снова в процессе.' : 'Ещё одно дело готово.');
    }));
    const main = element('div', 'task-main');
    const title = element('p', 'task-title', task.title);
    const date = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(task.createdAt));
    main.append(title, element('span', 'task-meta', `${date} · ${task.runId}`));
    const actions = element('div', 'task-actions');
    const edit = element('button', '', '✎'); edit.title = 'Изменить название'; edit.setAttribute('aria-label', `Изменить: ${task.title}`);
    edit.addEventListener('click', () => editTask(task, main, edit));
    const remove = element('button', 'delete', '×'); remove.title = 'Удалить дело'; remove.setAttribute('aria-label', `Удалить: ${task.title}`);
    remove.addEventListener('click', () => {
      $('#delete-title').textContent = task.title;
      const dialog = $('#delete-dialog'); dialog.returnValue = ''; dialog.showModal();
      dialog.addEventListener('close', () => {
        if (dialog.returnValue === 'delete') withButton(remove, async () => {
          await api(`tasks/${task.id}/`, { method: 'DELETE' }); await load(); status('Дело удалено.');
        });
      }, { once: true });
    });
    actions.append(edit, remove); row.append(checkbox, main, actions); return row;
  });
  $('#tasks').replaceChildren(...nodes);
}
function editTask(task, container, button) {
  button.disabled = true;
  const form = element('form', 'edit-form');
  const input = element('input'); input.value = task.title; input.required = true; input.setAttribute('aria-label', 'Новое название дела');
  const save = element('button', 'text-button', 'Сохранить'); save.type = 'submit';
  const cancel = element('button', 'text-button', 'Отмена'); cancel.type = 'button';
  cancel.addEventListener('click', render);
  input.addEventListener('keydown', event => { if (event.key === 'Escape') { event.preventDefault(); render(); } });
  form.addEventListener('submit', event => {
    event.preventDefault();
    if (titleLength(input.value) < 1 || titleLength(input.value) > 200) return status('Название должно содержать от 1 до 200 символов.', true);
    withButton(save, async () => { await api(`tasks/${task.id}/`, { method: 'PATCH', body: JSON.stringify({ title: input.value }) }); await load(); status('Название обновлено.'); });
  });
  form.append(input, save, cancel); container.replaceChildren(form); input.focus(); input.select();
}
async function load() {
  const request = ++state.request;
  $('#loading').hidden = false; $('#sync-status').textContent = 'Синхронизация…';
  try {
    const tasks = await api(`tasks/?runId=${encodeURIComponent(state.runId)}`);
    if (request !== state.request) return;
    state.tasks = tasks; render();
    $('#sync-status').textContent = `Обновлено в ${new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit' }).format(new Date())}`;
  } catch (error) { $('#sync-status').textContent = 'Не удалось обновить данные'; throw error; }
  finally { if (request === state.request) $('#loading').hidden = true; }
}
$('#login-form').addEventListener('submit', event => {
  event.preventDefault();
  withButton(event.submitter, async () => {
    state.token = $('#token').value.trim();
    const author = await api('author/');
    $('#token').value = '';
    $('#profile-name').textContent = author.fullName; $('#profile-login').textContent = author.login;
    $('#avatar').textContent = author.fullName.split(/\s+/).slice(0, 2).map(word => word[0]).join('');
    $('#workspace').hidden = false; $('#login-panel').hidden = true; $('#logout').hidden = false;
    await load(); status(); $('#new-title').focus();
  });
});
$('#logout').addEventListener('click', () => { logout(); status('Вы вышли. Токен удалён из памяти страницы.'); });
$('#refresh').addEventListener('click', event => withButton(event.currentTarget, async () => { await load(); status('Список обновлён.'); }));
$('#run-form').addEventListener('submit', event => {
  event.preventDefault();
  withButton(event.submitter, async () => {
    state.runId = $('#run-id').value; state.tasks = []; render(); await load(); status();
  });
});
$('#add-form').addEventListener('submit', event => {
  event.preventDefault();
  const input = $('#new-title');
  if (titleLength(input.value) < 1 || titleLength(input.value) > 200) return status('Название должно содержать от 1 до 200 символов.', true);
  withButton(event.submitter, async () => {
    await api('tasks/', { method: 'POST', body: JSON.stringify({ title: input.value, runId: state.runId }) });
    input.value = ''; state.filter = 'all'; updateFilters(); await load(); status('Новое дело добавлено.'); input.focus();
  });
});
function updateFilters() {
  document.querySelectorAll('[data-filter]').forEach(button => { const selected = button.dataset.filter === state.filter; button.classList.toggle('selected', selected); button.setAttribute('aria-pressed', selected); });
}
document.querySelectorAll('[data-filter]').forEach(button => button.addEventListener('click', () => { state.filter = button.dataset.filter; updateFilters(); render(); }));
