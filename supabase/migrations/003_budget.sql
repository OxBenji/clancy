-- ============================================================
-- 003_budget.sql – add cost tracking columns to projects
-- ============================================================

alter table projects
  add column if not exists total_tokens_used int default 0,
  add column if not exists total_cost_usd numeric(10, 4) default 0;
