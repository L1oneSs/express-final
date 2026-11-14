# Развёртывание и доступ проверяющему

## Текущий проект

- Автор: `l1onesss` — Чирков Лев Сергеевич.
- Репозиторий: https://github.com/L1oneSs/express-final
- PostgreSQL: Supabase 17.11, учебные таблицы `public.tasks` и `public.task_lists`.
- HTTPS: https://express-final-l1onesss.onrender.com
- Render: `express-final-l1onesss`, Free, Frankfurt, `srv-dbs33567bikc73efe2ng`, автоматическая публикация ветки `main`.
- Схема уже применена к Supabase через MCP. Повторно `db:init` здесь не запускать.
- `.private/access.md` содержит реальные отдельные реквизиты. Этот файл не коммитить и целиком не пересылать.

## Локальный запуск

1. Установить Node.js >=22, выполнить `npm ci`.
2. Для нового рабочего места скопировать `.env.example` в `.env` и заполнить переменные. В текущей папке `.env` уже настроен.
3. `DATABASE_URL` использует роль `todo_app`, её собственный пароль и **точный** shared pooler hostname из Connect. Для Session pooler порт `5432`, имя пользователя имеет вид `todo_app.PROJECT_REF`. Пароль URL-кодируется.
4. `DB_SSL=true`, `DB_SSL_CA_FILE=certs/supabase-ca.crt`. Не отключать проверку сертификата при ошибке TLS.
5. Запустить `npm start`; затем `npm run seed` в другом терминале. Повторный seed не создаёт дубль при обычном последовательном запуске.

`npm start` читает локальный `.env`. На хостинге использовать `npm run start:production`: значения поступают из переменных среды.

## Новая БД

`db/schema.sql` предназначен для чистой PostgreSQL-базы Supabase. Он создаёт `tasks`, индекс, RLS и роли без паролей; следом `db/lists.sql` создаёт именованные списки, триггер регистрации и внешний ключ. `npm run db:init` применяет оба файла. Для существующей старой схемы применяется только `db/lists.sql` — эта миграция уже выполнена в текущем проекте. Требуются административные права. Роли `anon`/`authenticated` относятся к Supabase; для чистой PostgreSQL без Supabase нужно убрать их из REVOKE.

Сначала настроить `DATABASE_ADMIN_URL` только для команды `npm run db:init`. После инициализации назначить **разные случайные пароли** ролям через защищённый SQL Editor:

```sql
-- Подставьте новые секреты локально. Никогда не коммитьте выполненный SQL с паролями.
ALTER ROLE todo_app LOGIN PASSWORD '<уникальный пароль приложения>' CONNECTION LIMIT 5;
ALTER ROLE todo_app SET statement_timeout = '8s';
ALTER ROLE todo_reviewer LOGIN PASSWORD '<другой пароль преподавателя>' CONNECTION LIMIT 3;
ALTER ROLE todo_reviewer SET statement_timeout = '8s';
```

В `.env` записать строку роли приложения, а не администратора. `DATABASE_ADMIN_URL` удалить после инициализации. Приложение её не использует. Схема не идемпотентна: ошибкой при повторном запуске защищает уже существующие данные от переинициализации.

## Render, бесплатный Web Service

Проект содержит `render.yaml` для Blueprint и `Dockerfile` как альтернативный способ сборки. Нужен доступ к аккаунту Render и репозиторию GitHub. Текущий runtime — обычный Node.js, а не статический сайт.

1. Опубликовать проверенные исходники в GitHub либо предоставить Render доступ к выбранному репозиторию. Не включать `.env`, `.private/`, `secrets.md`.
2. Создать Blueprint из репозитория или Web Service: Node, **Free**, build `npm ci --omit=dev`, start `npm run start:production`, health `/health/`.
3. Задать `HOST=0.0.0.0`, `NODE_ENV=production`, `AUTHOR_LOGIN=l1onesss`, `AUTHOR_FULL_NAME=Чирков Лев Сергеевич`, `DB_SSL=true`, `DB_SSL_CA_FILE=certs/supabase-ca.crt`.
4. Секретами задать `DATABASE_URL` (роль приложения), `API_TOKEN` и `REVIEWER_API_TOKEN` из закрытого локального файла. Не передавать на Render `DATABASE_ADMIN_URL`, `REVIEWER_DATABASE_URL` и пароль Helios.
5. После Deploy сохранить фактический HTTPS-адрес в README и этот документ. Проверить `/login/`, 401 без токена и полный CRUD с токеном. В `.env` временно задать `APP_URL` опубликованного сайта и выполнить `npm run seed` для проверки персонального дела через опубликованный API.
6. Для браузерного теста опубликованной версии также использовать `APP_URL`; тест работает в отдельном случайном runId и очищает только свои записи.

Для проверки опубликованного API и независимого доступа к БД:

```powershell
$env:APP_URL='https://express-final-l1onesss.onrender.com'
npm.cmd run test:integration
npm.cmd run test:browser
Remove-Item Env:APP_URL
```

При заданном APP_URL интеграционный тест использует размещённый HTTPS API; перезапуск процесса и искусственный отказ его пула проверяются только в локальном режиме. Настоящий сайт ради теста не останавливается.

Render Free засыпает после 15 минут без входящих запросов; пробуждение может занять примерно минуту. Месячный лимит Free — 750 часов на workspace. Supabase Free может приостановиться после недели неактивности. Перед проверкой открыть сайт и убедиться, что база активна; приложение должно оставаться доступным на весь период проверки. Платные услуги для этого проекта не заказывались. [Официальные ограничения Render](https://render.com/docs/free), проверены 14.11.2026.

`/health/` проверяет жизнеспособность процесса, а не БД: это позволяет продолжать отдавать интерфейс и JSON 503 при недоступности PostgreSQL. Проверка записи/чтения выполняется интеграционным тестом.

## Независимое подключение преподавателя

Использовать **отдельный** PostgreSQL-логин `todo_reviewer.PROJECT_REF` для shared pooler; при прямом IPv6-подключении суффикс проекта не нужен. База `postgres`, Session pooler `5432`, SSL `verify-full`, CA `certs/supabase-ca.crt`. Пароль находится в `.private/access.md`.

В DBeaver/pgAdmin ввести поля host, port, database, user и пароль; включить SSL, выбрать CA, включить проверку hostname. Либо установить `psql` и выполнить команду, которая **спросит** пароль:

```powershell
psql "host=aws-1-eu-west-2.pooler.supabase.com port=5432 dbname=postgres user=todo_reviewer.mevteqjckaucvdptbhhw sslmode=verify-full sslrootcert=certs/supabase-ca.crt" -W
```

Права преподавателя: SELECT/INSERT/UPDATE/DELETE на учебные `public.tasks` и `public.task_lists`; без TRUNCATE, изменения схемы, ролей, доступа к `auth.users`. Внешний ключ запрещает удалить список с делами. Не выдавать роль `postgres`, Supabase service key и пароль Helios.

Проверять на отдельном runId, не удаляя персональное дело:

```sql
INSERT INTO public.tasks(owner_login,title,run_id)
VALUES ('l1onesss','Добавлено преподавателем','teacher_check')
RETURNING id;

SELECT id, owner_login, title, done, run_id, created_at
FROM public.tasks WHERE owner_login='l1onesss' AND run_id='teacher_check';

UPDATE public.tasks SET title='Изменено в БД',done=true
WHERE owner_login='l1onesss' AND run_id='teacher_check';

DELETE FROM public.tasks
WHERE owner_login='l1onesss' AND run_id='teacher_check';
```

В интерфейсе выбрать появившийся список `teacher_check`: изменения подхватываются автоматически каждые десять секунд и при возвращении на вкладку.

## API

Все указанные маршруты заканчиваются `/`. Для каждого `/api/` передавать `Authorization: Bearer <отдельный API-токен>`; тело POST/PATCH — `application/json`.

| Метод и путь | Тело / параметры | Результат |
| --- | --- | --- |
| GET /login/ | Без токена | 200 text/plain, логин Moodle |
| GET /api/author/ | — | 200 JSON login/fullName |
| POST /api/tasks/ | title, runId | 201, созданное дело |
| GET /api/tasks/?runId=manual | Обязательный runId | 200, массив |
| GET /api/tasks/:id/ | UUID | 200 либо 404 |
| PATCH /api/tasks/:id/ | title и/или done | 200 либо 404 |
| DELETE /api/tasks/:id/ | UUID | 204 без тела либо 404 |

Ошибочные JSON, типы, лишние поля, неверные UUID/runId, пустые PATCH — 400. Неверный токен — 401. Сбой БД — 503. Ошибки имеют единственное поле `error` и Content-Type application/json.

## Дополнительный API списков

Все маршруты требуют тот же Bearer-токен. Оба токена разрешают учебный CRUD; токен преподавателя определяет роль, а не его личное имя. `/api/author/` по требованиям PDF всегда описывает студента, `/api/session/` возвращает текущую роль и отдельно автора.

| Метод и путь | Тело / параметры | Результат |
| --- | --- | --- |
| GET /api/session/ | — | `{role:"owner"\|"reviewer",displayName,author:{login,fullName}}` |
| GET /api/lists/ | — | Массив `{id,runId,name,taskCount,doneCount,createdAt}` |
| POST /api/lists/ | `{name,runId?}` | 201; без runId сервер генерирует стабильный ключ; занятый ключ — 409 |
| GET /api/lists/:id/ | UUID | 200, метаданные списка; отсутствующий — 404 |
| PATCH /api/lists/:id/ | Только `{name}` | 200; runId и id не меняются |
| DELETE /api/lists/:id/ | UUID | 204 без тела: список и все его дела удалены; отсутствующий — 404 |
| GET /api/lists/:id/tasks/ | Необязательный `status=all\|active\|done` | `{list:{id,runId,name,taskCount,doneCount,createdAt},tasks:[...]}`; дела содержат прежние шесть полей |

Название списка после trim: 1–100 символов. Пустое имя, лишние поля, неподходящие типы и неверный status — 400. Списки принадлежат настроенному автору; другая ownerLogin не принимается. Один `(owner_login,run_id)` соответствует одному списку. `taskCount` и `doneCount` вычисляются по актуальным делам и не хранятся отдельно.
