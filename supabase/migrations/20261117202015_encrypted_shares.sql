create table public.share_grants (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references auth.users(id) on delete cascade,
  recipient_id uuid not null references auth.users(id) on delete cascade,
  object_id uuid not null unique,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  constraint share_grants_distinct_accounts check (patient_id <> recipient_id),
  constraint share_grants_expiry_after_creation check (expires_at > created_at)
);

create table public.share_recipients (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check (char_length(display_name) between 2 and 100),
  organization text not null check (char_length(organization) between 2 and 160),
  accepting_shares boolean not null default false,
  updated_at timestamptz not null default now()
);

alter table public.share_recipients enable row level security;
create policy "authenticated resolve accepting recipients"
on public.share_recipients for select to authenticated
using (accepting_shares = true or user_id = (select auth.uid()));
create policy "recipients manage their directory entry"
on public.share_recipients for insert to authenticated
with check (user_id = (select auth.uid()));
create policy "recipients update their directory entry"
on public.share_recipients for update to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));
grant select, insert, update on public.share_recipients to authenticated;
revoke all on public.share_recipients from anon;

create index share_grants_recipient_active_idx
  on public.share_grants (recipient_id, expires_at)
  where revoked_at is null;

alter table public.share_grants enable row level security;

create policy "patients create scoped grants"
on public.share_grants for insert
to authenticated
with check ((select auth.uid()) = patient_id);

create policy "participants read grant metadata"
on public.share_grants for select
to authenticated
using ((select auth.uid()) = patient_id or (select auth.uid()) = recipient_id);

create policy "patients revoke their grants"
on public.share_grants for update
to authenticated
using ((select auth.uid()) = patient_id)
with check ((select auth.uid()) = patient_id);

create function public.protect_share_grant_identity()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.patient_id <> old.patient_id
    or new.recipient_id <> old.recipient_id
    or new.object_id <> old.object_id
    or new.expires_at <> old.expires_at
    or new.created_at <> old.created_at then
    raise exception 'share grant identity fields are immutable';
  end if;
  if old.revoked_at is not null and new.revoked_at is distinct from old.revoked_at then
    raise exception 'share revocation is permanent';
  end if;
  if old.revoked_at is null and new.revoked_at is not null then
    new.revoked_at := now();
  end if;
  return new;
end;
$$;

revoke all on function public.protect_share_grant_identity() from public, anon, authenticated;

create trigger protect_share_grant_identity_before_update
before update on public.share_grants
for each row execute function public.protect_share_grant_identity();

grant select, insert, update on public.share_grants to authenticated;
revoke all on public.share_grants from anon;

create table public.share_access_audit (
  id bigint generated always as identity primary key,
  grant_id uuid not null references public.share_grants(id) on delete cascade,
  actor_id uuid not null references auth.users(id) on delete cascade,
  accessed_at timestamptz not null default now(),
  outcome text not null check (outcome in ('downloaded', 'denied'))
);

alter table public.share_access_audit enable row level security;
create policy "patients read access audit"
on public.share_access_audit for select
to authenticated
using (
  exists (
    select 1 from public.share_grants grant_row
    where grant_row.id = grant_id and grant_row.patient_id = (select auth.uid())
  )
);
grant select on public.share_access_audit to authenticated;
revoke all on public.share_access_audit from anon;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('zoe-shares', 'zoe-shares', false, 5242880, array['application/octet-stream'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create policy "patients upload ciphertext once"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'zoe-shares'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and lower(storage.extension(name)) = 'bin'
);

create policy "patients delete their own orphaned ciphertext"
on storage.objects for delete
to authenticated
using (
  bucket_id = 'zoe-shares'
  and owner_id = (select auth.uid())::text
);

-- No client SELECT policy is intentional. The authenticated Edge Function checks
-- recipient, expiry, and revocation on every download before using a server key.
