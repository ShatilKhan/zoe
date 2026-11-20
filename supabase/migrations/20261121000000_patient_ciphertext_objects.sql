-- Patient ciphertext object metadata.
-- Stores only opaque object IDs, ownership, revision, and wrapped data keys.
-- No medical text, filenames, or plaintext ever stored here.
create table public.patient_ciphertext_objects (
  id uuid primary key default gen_random_uuid(),
  owner_subject text not null,          -- Clerk subject (sub claim)
  object_id uuid not null,             -- opaque client-generated object ID
  revision integer not null default 1,
  storage_path text not null,          -- opaque path in zoe-patient-ciphertext bucket
  wrapped_key text not null,           -- base64-encoded wrapped file key (from Edge Function)
  key_version text not null,           -- Infisical secret version name (e.g. ZOE_WRAP_KEY_V1)
  size_bytes bigint not null default 0,
  content_type text not null default 'application/octet-stream',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint patient_ciphertext_objects_owner_object unique (owner_subject, object_id, revision),
  constraint patient_ciphertext_objects_size_limit check (size_bytes >= 0 and size_bytes <= 10485760)
);

create index patient_ciphertext_objects_owner_idx
  on public.patient_ciphertext_objects (owner_subject, deleted_at)
  where deleted_at is null;

alter table public.patient_ciphertext_objects enable row level security;

-- Owners can read their own metadata rows.
create policy "owners read own ciphertext metadata"
on public.patient_ciphertext_objects for select to authenticated
using (owner_subject = current_setting('request.jwt.claims', true)::json->>'sub');

-- No direct insert/update/delete from clients; Edge Function uses service role.
revoke all on public.patient_ciphertext_objects from anon, authenticated;
grant select on public.patient_ciphertext_objects to authenticated;

-- Updated_at trigger
create or replace function public.touch_patient_ciphertext_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at := pg_catalog.clock_timestamp();
  return new;
end;
$$;

create trigger touch_patient_ciphertext_updated_at_before_update
before update on public.patient_ciphertext_objects
for each row execute function public.touch_patient_ciphertext_updated_at();

revoke all on function public.touch_patient_ciphertext_updated_at() from public, anon, authenticated;