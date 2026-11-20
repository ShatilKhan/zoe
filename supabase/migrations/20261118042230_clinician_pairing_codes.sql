create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table private.share_pairing_codes (
  clinician_id uuid primary key references public.share_recipients(user_id) on delete cascade,
  code_digest bytea not null unique check (octet_length(code_digest) = 32),
  issued_at timestamptz not null,
  expires_at timestamptz not null,
  constraint share_pairing_codes_expiry_after_issue check (expires_at > issued_at)
);

alter table private.share_pairing_codes enable row level security;
revoke all on private.share_pairing_codes from public, anon, authenticated;

create function private.issue_share_pairing_code(actor_id uuid)
returns table (pairing_code text, expires_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  random_bytes bytea;
  compact_code text;
  alphabet constant text := '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  issued_at_value timestamptz := pg_catalog.clock_timestamp();
begin
  if actor_id is null or actor_id <> auth.uid() then
    raise exception using errcode = '42501', message = 'authentication required';
  end if;

  perform 1
  from public.share_recipients recipient
  where recipient.user_id = actor_id and recipient.accepting_shares = true
  for update;
  if not found then
    raise exception 'Save an accepting pairing profile before creating a code.';
  end if;

  random_bytes := extensions.gen_random_bytes(16);
  select pg_catalog.string_agg(
    pg_catalog.substr(alphabet, (pg_catalog.get_byte(random_bytes, position) % 32) + 1, 1),
    '' order by position
  )
  into compact_code
  from pg_catalog.generate_series(0, 15) position;

  pairing_code := pg_catalog.concat_ws(
    '-',
    pg_catalog.substr(compact_code, 1, 4),
    pg_catalog.substr(compact_code, 5, 4),
    pg_catalog.substr(compact_code, 9, 4),
    pg_catalog.substr(compact_code, 13, 4)
  );
  expires_at := issued_at_value + interval '10 minutes';

  insert into private.share_pairing_codes (clinician_id, code_digest, issued_at, expires_at)
  values (actor_id, extensions.digest(pairing_code, 'sha256'), issued_at_value, expires_at)
  on conflict (clinician_id) do update
    set code_digest = excluded.code_digest,
        issued_at = excluded.issued_at,
        expires_at = excluded.expires_at;

  return next;
end;
$$;

revoke execute on function private.issue_share_pairing_code(uuid) from public, anon, authenticated;
grant usage on schema private to authenticated;
grant execute on function private.issue_share_pairing_code(uuid) to authenticated;

create function public.issue_share_pairing_code()
returns table (pairing_code text, expires_at timestamptz)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
begin
  if actor_id is null then
    raise exception using errcode = '42501', message = 'authentication required';
  end if;
  return query select issued.pairing_code, issued.expires_at
  from private.issue_share_pairing_code(actor_id) issued;
end;
$$;

revoke execute on function public.issue_share_pairing_code() from public, anon, authenticated;
grant execute on function public.issue_share_pairing_code() to authenticated;

create function private.resolve_share_pairing_code(requester_id uuid, pairing_code_value text)
returns table (
  recipient_id uuid,
  display_name text,
  organization text,
  pairing_expires_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if requester_id is null or requester_id <> auth.uid() then
    raise exception using errcode = '42501', message = 'authentication required';
  end if;
  if pairing_code_value is null or pairing_code_value !~ '^[0123456789ABCDEFGHJKMNPQRSTVWXYZ]{4}(-[0123456789ABCDEFGHJKMNPQRSTVWXYZ]{4}){3}$' then
    return;
  end if;

  return query
  select recipient.user_id, recipient.display_name, recipient.organization, pairing.expires_at
  from private.share_pairing_codes pairing
  join public.share_recipients recipient on recipient.user_id = pairing.clinician_id
  where pairing.code_digest = extensions.digest(pairing_code_value, 'sha256')
    and pairing.expires_at > pg_catalog.clock_timestamp()
    and recipient.accepting_shares = true
    and recipient.user_id <> requester_id;
end;
$$;

revoke execute on function private.resolve_share_pairing_code(uuid, text) from public, anon, authenticated;
grant execute on function private.resolve_share_pairing_code(uuid, text) to authenticated;

create function public.resolve_share_pairing_code(pairing_code text)
returns table (
  recipient_id uuid,
  display_name text,
  organization text,
  pairing_expires_at timestamptz
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  requester_id uuid := auth.uid();
begin
  if requester_id is null then
    raise exception using errcode = '42501', message = 'authentication required';
  end if;
  return query
  select resolved.recipient_id, resolved.display_name, resolved.organization, resolved.pairing_expires_at
  from private.resolve_share_pairing_code(requester_id, pairing_code) resolved;
end;
$$;

revoke execute on function public.resolve_share_pairing_code(text) from public, anon, authenticated;
grant execute on function public.resolve_share_pairing_code(text) to authenticated;

drop policy "authenticated resolve accepting recipients" on public.share_recipients;
create policy "recipients read their pairing profile"
on public.share_recipients for select to authenticated
using (user_id = (select auth.uid()));

create function private.invalidate_pairing_code_on_disable()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.accepting_shares = true and new.accepting_shares = false then
    delete from private.share_pairing_codes where clinician_id = new.user_id;
  end if;
  return new;
end;
$$;

revoke execute on function private.invalidate_pairing_code_on_disable() from public, anon, authenticated;

create trigger invalidate_pairing_code_after_disable
after update of accepting_shares on public.share_recipients
for each row execute function private.invalidate_pairing_code_on_disable();

create function private.create_share_grant_from_pairing(
  requester_id uuid,
  pairing_code_value text,
  expected_recipient_id uuid,
  object_id_value uuid,
  expires_at_value timestamptz
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  resolved_recipient_id uuid;
  created_grant_id uuid;
begin
  if requester_id is null or requester_id <> auth.uid() then
    raise exception using errcode = '42501', message = 'authentication required';
  end if;
  if pairing_code_value is null or pairing_code_value !~ '^[0123456789ABCDEFGHJKMNPQRSTVWXYZ]{4}(-[0123456789ABCDEFGHJKMNPQRSTVWXYZ]{4}){3}$' then
    raise exception 'Pairing code is invalid or expired.';
  end if;

  select recipient.user_id
  into resolved_recipient_id
  from private.share_pairing_codes pairing
  join public.share_recipients recipient on recipient.user_id = pairing.clinician_id
  where pairing.code_digest = extensions.digest(pairing_code_value, 'sha256')
    and pairing.expires_at > pg_catalog.clock_timestamp()
    and recipient.accepting_shares = true
    and recipient.user_id <> requester_id
  for update of pairing;

  if resolved_recipient_id is null or resolved_recipient_id <> expected_recipient_id then
    raise exception 'Pairing code is invalid or expired.';
  end if;

  insert into public.share_grants (patient_id, recipient_id, object_id, expires_at)
  values (requester_id, resolved_recipient_id, object_id_value, expires_at_value)
  returning id into created_grant_id;
  return created_grant_id;
end;
$$;

revoke execute on function private.create_share_grant_from_pairing(uuid, text, uuid, uuid, timestamptz) from public, anon, authenticated;
grant execute on function private.create_share_grant_from_pairing(uuid, text, uuid, uuid, timestamptz) to authenticated;

create function public.create_share_grant_from_pairing(
  pairing_code text,
  recipient_id uuid,
  object_id uuid,
  expires_at timestamptz
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  requester_id uuid := auth.uid();
begin
  if requester_id is null then
    raise exception using errcode = '42501', message = 'authentication required';
  end if;
  return private.create_share_grant_from_pairing(requester_id, pairing_code, recipient_id, object_id, expires_at);
end;
$$;

revoke execute on function public.create_share_grant_from_pairing(text, uuid, uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.create_share_grant_from_pairing(text, uuid, uuid, timestamptz) to authenticated;

drop policy "patients create scoped grants" on public.share_grants;
revoke insert (patient_id, recipient_id, object_id, expires_at) on public.share_grants from authenticated;
