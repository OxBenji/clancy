-- Subscription tracking for Stripe billing
create table if not exists subscriptions (
  id uuid default gen_random_uuid() primary key,
  user_id text not null unique,
  stripe_subscription_id text not null unique,
  status text not null default 'active',
  updated_at timestamptz default now(),
  created_at timestamptz default now()
);

-- Index for quick user lookup
create index if not exists idx_subscriptions_user_id on subscriptions(user_id);
create index if not exists idx_subscriptions_stripe_id on subscriptions(stripe_subscription_id);
