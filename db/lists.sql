BEGIN;
CREATE TABLE public.task_lists (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_login text NOT NULL CHECK (char_length(owner_login) BETWEEN 1 AND 200),
  run_id text NOT NULL CHECK (run_id ~ '^[A-Za-z0-9_-]{1,64}$'),
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 100 AND name = btrim(name)),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_login, run_id)
);
INSERT INTO public.task_lists(owner_login,run_id,name)
SELECT DISTINCT owner_login,run_id,CASE WHEN run_id='manual' THEN 'Основной список' ELSE run_id END
FROM public.tasks;
ALTER TABLE public.task_lists ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.task_lists FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.task_lists TO todo_app,todo_reviewer;
CREATE POLICY lists_application ON public.task_lists FOR ALL TO todo_app USING (true) WITH CHECK (true);
CREATE POLICY lists_review ON public.task_lists FOR ALL TO todo_reviewer USING (true) WITH CHECK (true);
CREATE FUNCTION public.register_task_list() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  INSERT INTO public.task_lists(owner_login,run_id,name)
  VALUES (NEW.owner_login,NEW.run_id,CASE WHEN NEW.run_id='manual' THEN 'Основной список' ELSE NEW.run_id END)
  ON CONFLICT (owner_login,run_id) DO NOTHING;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.register_task_list() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.register_task_list() TO todo_app,todo_reviewer;
CREATE TRIGGER tasks_register_list BEFORE INSERT OR UPDATE OF owner_login,run_id ON public.tasks
FOR EACH ROW EXECUTE FUNCTION public.register_task_list();
ALTER TABLE public.tasks ADD CONSTRAINT tasks_list_fk FOREIGN KEY (owner_login,run_id)
REFERENCES public.task_lists(owner_login,run_id) ON UPDATE RESTRICT ON DELETE RESTRICT;
COMMENT ON TABLE public.task_lists IS 'Coursework lists. Stable run_id groups tasks; name can be edited. Existing task HTTP contract is unchanged.';
COMMIT;
