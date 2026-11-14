import { readFile } from 'node:fs/promises';
import { createPool } from '../src/database.js';
if (!process.env.DATABASE_ADMIN_URL) throw new Error('Для инициализации нужна DATABASE_ADMIN_URL');
const pool = createPool({ ssl: process.env.DB_SSL !== 'false', caFile: process.env.DB_SSL_CA_FILE }, process.env.DATABASE_ADMIN_URL);
try {
  const sql = await readFile(new URL('../db/schema.sql', import.meta.url), 'utf8');
  await pool.query(sql);
  console.log('Таблица и ограниченные роли созданы. Задайте отдельные пароли ролям через SQL Editor.');
} finally { await pool.end(); }
