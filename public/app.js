const $ = selector => document.querySelector(selector);
const state = { token: '', lists: [], selectedId: null, currentList: null, tasks: [], filter: 'all', request: 0, loading: false, editing: false, mutating: 0, snapshot: '', listMode: 'create' };
const length = value => Array.from(value.trim()).length;
function status(message = '', error = false) { $('#status').textContent = message; $('#status').classList.toggle('error', error); }
function element(tag, className, text) { const node = document.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = text; return node; }
function logout() {
  state.token = ''; state.tasks = []; state.lists = []; state.selectedId = null; state.currentList = null; state.snapshot = ''; state.editing = false; state.request++;
  document.body.classList.remove('authenticated');
  for (const selector of ['#navigation', '#session-header', '#workspace']) $(selector).hidden = true;
  $('#login-panel').hidden = false; $('#token').value = ''; $('#tasks').replaceChildren(); $('#lists').replaceChildren();
  $('#list-dialog').close(); $('#delete-dialog').close();
}
async function api(path, options = {}) {
  let response;
  try { response = await fetch(`/api/${path}`, { ...options, cache: 'no-store', headers: { Authorization: `Bearer ${state.token}`, ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers } }); }
  catch { throw new Error('Нет связи с сервером.'); }
  if (!response.ok) {
    const result = await response.json().catch(() => ({ error: 'Не удалось выполнить запрос' }));
    if (response.status === 401) logout();
    throw new Error(result.error);
  }
  return response.status === 204 ? null : response.json();
}
async function withButton(button, action) {
  state.mutating++; button.disabled = true;
  try { await action(); } catch (error) { status(error.message, true); }
  finally { state.mutating--; button.disabled = false; }
}
function render() {
  const list = state.currentList;
  $('#list-name').textContent = list?.name || 'Создайте список';
  $('#list-summary').textContent = list ? `Всего: ${list.taskCount} · Выполнено: ${list.doneCount}` : '';
  $('#rename-list').hidden = !list; $('#add-form').hidden = !list; $('.filters').hidden = !list;
  $('#empty').hidden = state.tasks.length > 0;
  $('#empty').textContent = !list ? 'Нажмите «Новый список».' : state.filter === 'all' ? 'В этом списке нет дел.' : 'Нет дел с выбранным статусом.';
  $('#lists').replaceChildren(...state.lists.map(item => {
    const row = element('li'); const button = element('button', `list-button${item.id === state.selectedId ? ' selected' : ''}`);
    button.setAttribute('aria-label', item.name); button.setAttribute('aria-pressed', String(item.id === state.selectedId));
    button.append(element('span', 'folder-icon', '▤'), element('span', 'folder-name', item.name), element('span', 'count', String(item.taskCount)));
    button.addEventListener('click', () => { state.selectedId = item.id; state.filter = 'all'; state.editing = false; refresh(); }); row.append(button); return row;
  }));
  document.querySelectorAll('[data-filter]').forEach(button => { const selected = button.dataset.filter === state.filter; button.classList.toggle('selected', selected); button.setAttribute('aria-pressed', String(selected)); });
  $('#tasks').replaceChildren(...state.tasks.map(task => {
    const row = element('li', `task${task.done ? ' done' : ''}`);
    const checkbox = element('input', 'task-check'); checkbox.type = 'checkbox'; checkbox.checked = task.done;
    checkbox.setAttribute('aria-label', `Отметить ${task.done ? 'невыполненным' : 'выполненным'}: ${task.title}`);
    checkbox.addEventListener('change', () => withButton(checkbox, async () => {
      try { await api(`tasks/${task.id}/`, { method: 'PATCH', body: JSON.stringify({ done: checkbox.checked }) }); }
      catch (error) { checkbox.checked = task.done; throw error; }
      await refresh();
    }));
    const main = element('div', 'task-main'); main.append(element('p', 'task-title', task.title));
    const actions = element('div', 'task-actions');
    const edit = element('button', 'icon-button', '✎'); edit.setAttribute('aria-label', `Изменить: ${task.title}`); edit.title = 'Изменить название';
    edit.addEventListener('click', () => editTask(task, main, edit));
    const remove = element('button', 'icon-button delete', '×'); remove.setAttribute('aria-label', `Удалить: ${task.title}`); remove.title = 'Удалить дело';
    remove.addEventListener('click', () => {
      const dialog = $('#delete-dialog'); $('#delete-title').textContent = task.title; dialog.returnValue = ''; dialog.showModal();
      dialog.addEventListener('close', () => { if (dialog.returnValue === 'delete') withButton(remove, async () => { await api(`tasks/${task.id}/`, { method: 'DELETE' }); await refresh(); status('Дело удалено.'); }); }, { once: true });
    });
    actions.append(edit, remove); row.append(checkbox, main, actions); return row;
  }));
}
async function refresh(quiet = false) {
  if (!state.token || (quiet && (state.loading || state.editing || state.mutating || document.querySelector('dialog[open]')))) return;
  const request = ++state.request; state.loading = true;
  if (!quiet) $('#loading').hidden = false;
  try {
    const lists = await api('lists/'); if (request !== state.request) return;
    const selectedId = lists.some(list => list.id === state.selectedId) ? state.selectedId : (lists.find(list => list.runId === 'manual') || lists[0])?.id;
    const result = selectedId ? await api(`lists/${selectedId}/tasks/?status=${state.filter}`) : { list: null, tasks: [] };
    if (request !== state.request) return;
    const snapshot = JSON.stringify([lists, result, state.filter]);
    state.selectedId = selectedId; state.lists = lists; state.currentList = result.list; state.tasks = result.tasks;
    if (!quiet || snapshot !== state.snapshot) { state.snapshot = snapshot; render(); }
    if ($('#status').classList.contains('error')) status();
  } catch (error) { if (request === state.request) status(error.message, true); }
  finally { if (request === state.request) { state.loading = false; $('#loading').hidden = true; } }
}
function editTask(task, container, button) {
  if (state.editing) return; state.editing = true; button.disabled = true;
  const form = element('form', 'edit-form'); const input = element('input'); input.value = task.title; input.required = true; input.setAttribute('aria-label', 'Новое название дела');
  const save = element('button', 'primary', 'Сохранить'); save.type = 'submit'; const cancel = element('button', 'secondary', 'Отмена'); cancel.type = 'button';
  const cancelEdit = () => { state.editing = false; render(); }; cancel.addEventListener('click', cancelEdit);
  input.addEventListener('keydown', event => { if (event.key === 'Escape') { event.preventDefault(); cancelEdit(); } });
  form.addEventListener('submit', event => { event.preventDefault(); if (length(input.value) < 1 || length(input.value) > 200) return status('Название дела: от 1 до 200 символов.', true); withButton(save, async () => { await api(`tasks/${task.id}/`, { method: 'PATCH', body: JSON.stringify({ title: input.value }) }); state.editing = false; await refresh(); }); });
  form.append(input, save, cancel); container.replaceChildren(form); input.focus(); input.select();
}
function openListDialog(mode) {
  state.listMode = mode; $('#list-dialog-title').textContent = mode === 'create' ? 'Новый список' : 'Переименовать список';
  $('#folder-name').value = mode === 'create' ? '' : state.currentList.name; $('#list-error').textContent = ''; $('#list-dialog').showModal(); $('#folder-name').focus();
}
$('#new-list').addEventListener('click', () => openListDialog('create'));
$('#rename-list').addEventListener('click', () => openListDialog('rename'));
$('#cancel-list').addEventListener('click', () => $('#list-dialog').close());
$('#list-form').addEventListener('submit', async event => {
  event.preventDefault(); const name = $('#folder-name').value;
  if (length(name) < 1 || length(name) > 100) { $('#list-error').textContent = 'Название списка: от 1 до 100 символов.'; return; }
  const button = event.submitter; button.disabled = true; state.mutating++;
  try {
    const result = await api(state.listMode === 'create' ? 'lists/' : `lists/${state.selectedId}/`, { method: state.listMode === 'create' ? 'POST' : 'PATCH', body: JSON.stringify({ name }) });
    state.selectedId = result.id; state.filter = 'all'; state.editing = false; $('#list-dialog').close(); await refresh(); status();
  } catch (error) { $('#list-error').textContent = error.message; }
  finally { state.mutating--; button.disabled = false; }
});
$('#login-form').addEventListener('submit', event => {
  event.preventDefault(); withButton(event.submitter, async () => {
    state.token = $('#token').value.trim(); const session = await api('session/'); $('#token').value = '';
    $('#profile-name').textContent = session.displayName; $('#profile-login').textContent = session.role === 'reviewer' ? 'Доступ для проверки' : session.author.login;
    $('#author-name').textContent = session.author.fullName; $('#author-login').textContent = session.author.login;
    $('#author-info').hidden = session.role !== 'reviewer';
    document.body.classList.add('authenticated'); $('#login-panel').hidden = true;
    for (const selector of ['#navigation', '#session-header', '#workspace']) $(selector).hidden = false;
    status(); await refresh();
  });
});
$('#logout').addEventListener('click', () => { logout(); status(); });
$('#add-form').addEventListener('submit', event => {
  event.preventDefault(); const input = $('#new-title');
  if (length(input.value) < 1 || length(input.value) > 200) return status('Название дела: от 1 до 200 символов.', true);
  const runId = state.currentList.runId;
  withButton(event.submitter, async () => { await api('tasks/', { method: 'POST', body: JSON.stringify({ title: input.value, runId }) }); input.value = ''; state.filter = 'all'; state.editing = false; await refresh(); input.focus(); });
});
document.querySelectorAll('[data-filter]').forEach(button => button.addEventListener('click', () => { state.filter = button.dataset.filter; state.editing = false; refresh(); }));
window.addEventListener('focus', () => refresh(true));
document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(true); });
setInterval(() => { if (!document.hidden) refresh(true); }, 10000);
