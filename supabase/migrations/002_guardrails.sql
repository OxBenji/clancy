-- ============================================================
-- 002_guardrails.sql – guardrails table for Ralph loop signs
-- ============================================================

create table guardrails (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references projects(id) on delete cascade,
  task_label  text not null,
  sign        text not null,
  created_at  timestamptz default now()
);

alter table guardrails enable row level security;

create policy "Users can read own guardrails"
  on guardrails for select
  using (
    exists (
      select 1 from projects
      where projects.id = guardrails.project_id
        and projects.user_id = auth.uid()
    )
  );

create policy "Users can insert own guardrails"
  on guardrails for insert
  with check (
    exists (
      select 1 from projects
      where projects.id = guardrails.project_id
        and projects.user_id = auth.uid()
    )
  );

create policy "Users can delete own guardrails"
  on guardrails for delete
  using (
    exists (
      select 1 from projects
      where projects.id = guardrails.project_id
        and projects.user_id = auth.uid()
    )
  );
