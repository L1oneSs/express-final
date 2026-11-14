export function readConfig(env = process.env) {
  const required = ['AUTHOR_LOGIN', 'AUTHOR_FULL_NAME', 'API_TOKEN', 'DATABASE_URL'];
  for (const name of required) {
    if (!env[name]?.trim()) throw new Error(`Не задана переменная ${name}`);
  }
  if ([env.API_TOKEN, env.REVIEWER_API_TOKEN].some(value => value && value.length < 32)) {
    throw new Error('API-токен должен содержать не менее 32 символов');
  }
  if (env.REVIEWER_API_TOKEN === env.API_TOKEN) throw new Error('Токены автора и преподавателя должны различаться');
  const port = Number(env.PORT || 3000);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Некорректный PORT');
  return {
    port, host: env.HOST || '127.0.0.1',
    author: { login: env.AUTHOR_LOGIN.trim(), fullName: env.AUTHOR_FULL_NAME.trim() },
    tokens: [env.API_TOKEN, env.REVIEWER_API_TOKEN].filter(Boolean),
    databaseUrl: env.DATABASE_URL,
    ssl: env.DB_SSL !== 'false', caFile: env.DB_SSL_CA_FILE || undefined,
    sslServername: env.DB_SSL_SERVERNAME || undefined,
  };
}
