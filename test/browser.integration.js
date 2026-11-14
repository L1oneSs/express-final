import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { chromium } from 'playwright';
import { readConfig } from '../src/config.js';
import { createPool } from '../src/database.js';

test('browser: named lists, task CRUD, automatic synchronization and reviewer identity', { timeout: 90000 }, async () => {
  const config = readConfig();
  const reviewer = createPool(config, process.env.REVIEWER_DATABASE_URL);
  const base = process.env.APP_URL || 'http://127.0.0.1:3000';
  const suffix = randomUUID().slice(0, 8);
  const folders = [];
  const browser = await chromium.launch({ ...(process.platform === 'win32' ? { channel: process.env.BROWSER_CHANNEL || 'msedge' } : {}), headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  async function login(token) { await page.getByLabel('Токен доступа').fill(token); await page.getByRole('button', { name: 'Войти', exact: true }).click(); await page.locator('#workspace').waitFor({ state: 'visible' }); await page.locator('#loading').waitFor({ state: 'hidden' }); }
  async function createList(name) {
    await page.getByRole('button', { name: '＋ Новый список', exact: true }).click();
    await page.getByLabel('Название списка', { exact: true }).fill(name);
    const result = page.waitForResponse(response => response.request().method() === 'POST' && response.url().endsWith('/api/lists/'));
    await page.getByRole('dialog').getByRole('button', { name: 'Сохранить', exact: true }).click();
    const folder = await (await result).json(); folders.push(folder);
    await page.getByRole('heading', { name, exact: true }).waitFor(); return folder;
  }
  try {
    await page.goto(base); await login(process.env.API_TOKEN);
    assert.equal(await page.locator('#profile-name').textContent(), config.author.fullName);
    const firstName = 'Учёба ' + suffix;
    const first = await createList(firstName);
    await page.getByLabel('Новое дело', { exact: true }).fill('<b>Учебное дело</b>');
    const createdResponse = page.waitForResponse(response => response.request().method() === 'POST' && response.url().endsWith('/api/tasks/'));
    await page.getByRole('button', { name: 'Добавить', exact: true }).click();
    const task = await (await createdResponse).json();
    await page.getByText('<b>Учебное дело</b>', { exact: true }).waitFor(); assert.equal(await page.locator('.task-title b').count(), 0);
    await page.getByRole('button', { name: 'Изменить: <b>Учебное дело</b>', exact: true }).click();
    await page.getByLabel('Новое название дела').fill('Изменено в браузере');
    await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
    await page.getByText('Изменено в браузере', { exact: true }).waitFor();
    await page.getByRole('checkbox').check(); await page.locator('.task.done').waitFor();
    await page.getByRole('button', { name: 'В процессе', exact: true }).click(); await page.locator('.task').waitFor({ state: 'hidden' });
    await page.getByRole('button', { name: 'Готово', exact: true }).click(); await page.locator('.task.done').waitFor();
    await createList('Второй ' + suffix); assert.equal(await page.locator('.task').count(), 0);
    await page.getByRole('button', { name: firstName, exact: true }).click(); await page.getByText('Изменено в браузере', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Переименовать список', exact: true }).click();
    const renamed = 'Переименованный ' + suffix;
    await page.getByLabel('Название списка', { exact: true }).fill(renamed);
    await page.getByRole('dialog').getByRole('button', { name: 'Сохранить', exact: true }).click();
    await page.getByRole('heading', { name: renamed, exact: true }).waitFor();
    assert.equal((await reviewer.query('SELECT run_id FROM public.task_lists WHERE id=$1', [first.id])).rows[0].run_id, first.runId);
    await reviewer.query('UPDATE public.tasks SET title=$1 WHERE id=$2', ['Независимое изменение', task.id]);
    await page.getByText('Независимое изменение', { exact: true }).waitFor({ timeout: 18000 });
    await page.reload(); await login(process.env.API_TOKEN);
    await page.getByRole('button', { name: renamed, exact: true }).click(); await page.getByText('Независимое изменение', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Удалить: Независимое изменение', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Удалить', exact: true }).click();
    await page.getByRole('status').filter({ hasText: 'Дело удалено.' }).waitFor();
    await page.getByRole('button', { name: 'Выйти', exact: true }).click(); await login(process.env.REVIEWER_API_TOKEN);
    assert.equal(await page.locator('#profile-name').textContent(), 'Преподаватель');
    assert.equal(await page.locator('#author-name').textContent(), config.author.fullName);
    assert.equal(await page.locator('#avatar').count(), 0);
    assert.equal(await page.getByRole('button', { name: 'Обновить', exact: true }).count(), 0);
    assert.equal(await page.getByRole('button', { name: 'Открыть →', exact: true }).count(), 0);
    await page.getByText(`Итоговая работа 24.10.2026: ${config.author.login}`, { exact: true }).waitFor();
    await mkdir('.private', { recursive: true });
    await page.screenshot({ path: '.private/desktop.png', fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    assert.equal(await page.locator('#author-name').isVisible(), true);
    await page.screenshot({ path: '.private/mobile.png', fullPage: true });
    await page.getByRole('button', { name: 'Выйти', exact: true }).click(); assert.equal(await page.getByLabel('Токен доступа').inputValue(), '');
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
    try { for (const folder of folders) { await reviewer.query('DELETE FROM public.tasks WHERE owner_login=$1 AND run_id=$2', [config.author.login, folder.runId]); await reviewer.query('DELETE FROM public.task_lists WHERE owner_login=$1 AND id=$2', [config.author.login, folder.id]); } }
    finally { await reviewer.end(); }
  }
});
