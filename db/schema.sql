BEGIN;
CREATE TABLE public.tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_login text NOT NULL CHECK (char_length(owner_login) BETWEEN 1 AND 200),
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200 AND title = btrim(title)),
  done boolean NOT NULL DEFAULT false,
  run_id text NOT NULL CHECK (run_id ~ '^[A-Za-z0-9_-]{1,64}$'),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX tasks_owner_run_created_idx ON public.tasks (owner_login, run_id, created_at, id);
ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.tasks FROM PUBLIC, anon, authenticated;
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'todo_app') THEN
    CREATE ROLE todo_app NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'todo_reviewer') THEN
    CREATE ROLE todo_reviewer NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  END IF;
END $$;
GRANT CONNECT ON DATABASE postgres TO todo_app, todo_reviewer;
GRANT USAGE ON SCHEMA public TO todo_app, todo_reviewer;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tasks TO todo_app, todo_reviewer;
CREATE POLICY tasks_application ON public.tasks FOR ALL TO todo_app USING (true) WITH CHECK (true);
CREATE POLICY tasks_review ON public.tasks FOR ALL TO todo_reviewer USING (true) WITH CHECK (true);
COMMENT ON TABLE public.tasks IS 'Isolated coursework data. Only todo_app and todo_reviewer have CRUD access.';
COMMIT;
