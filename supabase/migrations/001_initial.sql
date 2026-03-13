-- ============================================================
-- 001_initial.sql – projects & tasks with RLS
-- ============================================================

-- Projects
create table projects (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null,
  title       text,
  description text,
  status      text default 'pending',
  created_at  timestamptz default now()
);

alter table projects enable row level security;

create policy "Users can read own projects"
  on projects for select
  using (auth.uid() = user_id);

create policy "Users can insert own projects"
  on projects for insert
  with check (auth.uid() = user_id);

create policy "Users can update own projects"
  on projects for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users can delete own projects"
  on projects for delete
  using (auth.uid() = user_id);

-- Tasks
create table tasks (
  id               uuid primary key default gen_random_uuid(),
  project_id       uuid references projects(id) on delete cascade,
  label            text,
  status           text default 'pending',
  duration_seconds int,
  order_index      int,
  created_at       timestamptz default now()
);

alter table tasks enable row level security;

create policy "Users can read own tasks"
  on tasks for select
  using (
    exists (
      select 1 from projects
      where projects.id = tasks.project_id
        and projects.user_id = auth.uid()
    )
  );

create policy "Users can insert own tasks"
  on tasks for insert
  with check (
    exists (
      select 1 from projects
      where projects.id = tasks.project_id
        and projects.user_id = auth.uid()
    )
  );

create policy "Users can update own tasks"
  on tasks for update
  using (
    exists (
      select 1 from projects
      where projects.id = tasks.project_id
        and projects.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from projects
      where projects.id = tasks.project_id
        and projects.user_id = auth.uid()
    )
  );

create policy "Users can delete own tasks"
  on tasks for delete
  using (
    exists (
      select 1 from projects
      where projects.id = tasks.project_id
        and projects.user_id = auth.uid()
    )
  );
