-- Test-account allowlist for the Presage QA broker.
-- Only accounts in this table can receive a brokered Presage key.
create table public.presage_qa_accounts (
  clerk_subject text primary key,
  allowed_until timestamptz not null,
  max_requests_per_hour integer not null default 10,
  created_at timestamptz not null default now()
);

alter table public.presage_qa_accounts enable row level security;
-- No client access; Edge Function uses service role.
revoke all on public.presage_qa_accounts from anon, authenticated;

-- Rate-limit tracking table.
create table public.presage_qa_requests (
  id uuid primary key default gen_random_uuid(),
  clerk_subject text not null references public.presage_qa_accounts(clerk_subject) on delete cascade,
  requested_at timestamptz not null default now(),
  outcome text not null check (outcome in ('allowed', 'rate_limited', 'expired', 'not_allowed'))
);

create index presage_qa_requests_subject_time_idx
  on public.presage_qa_requests (clerk_subject, requested_at desc);

alter table public.presage_qa_requests enable row level security;
revoke all on public.presage_qa_requests from anon, authenticated;