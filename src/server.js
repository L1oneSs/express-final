import { createApp } from './app.js';
import { readConfig } from './config.js';
import { createPool, createTaskRepository } from './database.js';

const config = readConfig();
const pool = createPool(config);
const app = createApp({ ...config, repository: createTaskRepository(pool) });
const server = app.listen(config.port, config.host, () => console.log(`Приложение: http://${config.host}:${server.address().port}`));
let shuttingDown = false;
function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  server.close(async () => { await pool.end(); process.exit(0); });
  setTimeout(() => process.exit(1), 10000).unref();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
