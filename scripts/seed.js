const base = process.env.APP_URL || `http://127.0.0.1:${process.env.PORT || 3000}`;
const headers = { Authorization: `Bearer ${process.env.API_TOKEN}`, 'Content-Type': 'application/json' };
const authorResponse = await fetch(`${base}/api/author/`, { headers });
if (!authorResponse.ok) throw new Error(`Не удалось получить автора: ${authorResponse.status}`);
const author = await authorResponse.json();
const title = `Итоговая работа 24.10.2026: ${author.login}`;
const list = await fetch(`${base}/api/tasks/?runId=manual`, { headers });
if (!list.ok) throw new Error(`Ошибка чтения: ${list.status}`);
if ((await list.json()).some(task => task.title === title)) {
  console.log('Персональное дело уже существует.');
} else {
  const response = await fetch(`${base}/api/tasks/`, { method: 'POST', headers, body: JSON.stringify({ title, runId: 'manual' }) });
  if (response.status !== 201) throw new Error(`Ошибка создания: ${response.status}`);
  console.log('Персональное дело создано через API.');
}
