# Списки дел — Express и PostgreSQL

Приложение поддерживает создание, переименование и удаление списков, добавление дел, изменение названий, отметку выполнения и удаление записей. 

В качестве БД выбрана площадка SupaBase с PostgreSQL.

Сервер разделён на конфигурацию, HTTP-маршруты Express и PostgreSQL-репозиторий. Запросы параметризованы, Bearer-токен проверяется перед разбором JSON.

Сервер задаёт UUID, ownerLogin, время создания и начальное done=false; ФИО и логин поступают из конфигурации. createdAt возвращается в UTC ISO 8601. Таблица task_lists хранит название и runId (Папки с делами); составной внешний ключ связывает её с задачами. 

Для запуска нужны Node.js 22+, зависимости из lock-файла и заполненный `.env`. На новой БД db:init применяет schema.sql и lists.sql; затем администратор назначает разные пароли ролям. Текущая Supabase уже инициализирована и повторять команду не требуется. 

Приложение использует роль todo_app, преподаватель - todo_reviewer с CRUD только учебных таблиц tasks/task_lists. Доступ к Auth, изменению схемы и TRUNCATE запрещён; RLS закрывает таблицы для анонимных ролей.

## Сравнение трёх вариантов размещения БД

| Площадка | СУБД и оплата | Хранение и подключения |
| --- | --- | --- |
| Supabase | PostgreSQL; постоянный Free $0 с квотами | 500 МБ БД, до двух активных Free-проектов; Nano: 60 прямых / 200 pooler-подключений. Прямой адрес IPv6, shared pooler IPv4 |
| Timeweb Cloud, отечественный сервис | PostgreSQL 14–18; платный pay-as-you-go. Постоянный бесплатный тариф в рассмотренном предложении не заявлен | Минимум: 1 CPU / 1 ГБ RAM / 8 ГБ NVMe; эта конфигурация ограничена одной БД и одним пользователем. Дополнительные пользователи требуют другой конфигурации; max_connections зависит от неё. Публичные IPv4/IPv6 настраиваются отдельно |
| Факультетский Helios | PostgreSQL 18.3; предоставленный учебный доступ без отдельной оплаты | SSH, внутренняя БД studs на хосте pg; внешнее приложение может использовать согласованный SSH-туннель |

## Схема данных и сопоставление полей

| Поле JSON дела | Столбец public.tasks | Тип и правило |
| --- | --- | --- |
| id | id | uuid, PRIMARY KEY, gen_random_uuid() |
| ownerLogin | owner_login | text, логин автора из конфигурации |
| title | title | text, после trim 1–200 символов |
| done | done | boolean, начальное значение false |
| runId | run_id | text, 1–64 символа A–Z/a–z/0–9/_/- |
| createdAt | created_at | timestamptz, now(); JSON UTC ISO 8601 |

| Поле списка | Столбец public.task_lists | Тип и правило |
| --- | --- | --- |
| id | id | uuid, PRIMARY KEY |
| Владелец, внутреннее поле | owner_login | text, задаётся сервером |
| runId | run_id | text, уникален вместе с owner_login |
| name | name | text, после trim 1–100 символов |
| createdAt | created_at | timestamptz; JSON UTC ISO 8601 |
| taskCount, doneCount | Не хранятся | Вычисляются из текущих задач |

Связь: `tasks(owner_login, run_id) → task_lists(owner_login, run_id)`. SQL-схема: [db/schema.sql](db/schema.sql), расширение списков: [db/lists.sql](db/lists.sql).

## Проверенные версии

| Компонент | Версия |
| --- | --- |
| Node.js | 22.17.0 |
| Express | 5.3.0 |
| PostgreSQL выбранной Supabase | 17.11 |
| PostgreSQL-клиент pg | 8.23.1 |

## Установка и конфигурация

```powershell
npm.cmd ci
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
# Заполните .env локально: AUTHOR_LOGIN, AUTHOR_FULL_NAME,
# разные API_TOKEN и REVIEWER_API_TOKEN, DATABASE_URL роли todo_app.
# Для новой БД дополнительно укажите DATABASE_ADMIN_URL администратора.

# Только если отсутствует публичный CA-сертификат:
New-Item -ItemType Directory -Force certs | Out-Null
Invoke-WebRequest 'https://supabase-downloads.s3-ap-southeast-1.amazonaws.com/prod/ssl/prod-ca-2021.crt' -OutFile certs/supabase-ca.crt
# В .env: DB_SSL=true; DB_SSL_CA_FILE=certs/supabase-ca.crt
```

## Инициализация только новой БД

```powershell
npm.cmd run db:init
```

```sql
-- Выполнить администратором в SQL Editor; вместо образцов задать новые пароли.
ALTER ROLE todo_app LOGIN PASSWORD '<новый_пароль_приложения>' CONNECTION LIMIT 5;
ALTER ROLE todo_reviewer LOGIN PASSWORD '<другой_пароль_преподавателя>' CONNECTION LIMIT 3;
ALTER ROLE todo_app SET statement_timeout = '8s';
ALTER ROLE todo_reviewer SET statement_timeout = '8s';
-- В .env сохранить DATABASE_URL роли todo_app; DATABASE_ADMIN_URL удалить.
```

## Запуск и проверки

```powershell
npm.cmd start
# Открыть http://127.0.0.1:3000; в другом терминале:
npm.cmd run seed              # Создаёт персональное дело через API, если его нет
npm.cmd test
# Для независимой проверки дополнительно задать REVIEWER_DATABASE_URL в .env:
npm.cmd run test:integration
npm.cmd run test:browser      # Windows: установленный Edge
# На Linux перед браузерным тестом: npx playwright install chromium
```

```powershell
# На Render переменные задаются в Environment; .env не загружается:
npm.cmd run start:production
# Проверка опубликованного API и независимого SQL-доступа:
$env:APP_URL='https://express-final-l1onesss.onrender.com'
npm.cmd run test:integration
Remove-Item Env:APP_URL
```
