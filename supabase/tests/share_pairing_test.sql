begin;
select plan(29);

select has_schema('private', 'pairing internals use a non-exposed schema');
select has_table('private', 'share_pairing_codes', 'pairing codes use a private digest-only table');
select has_function('public', 'issue_share_pairing_code', array[]::text[], 'clinician can issue a pairing code through an RPC');
select has_function('private', 'issue_share_pairing_code', array['uuid'], 'privileged issue logic stays private');
select has_function('public', 'resolve_share_pairing_code', array['text'], 'patient resolves an exact pairing code through an RPC');
select has_function('private', 'resolve_share_pairing_code', array['uuid', 'text'], 'privileged pairing lookup stays private');
select has_function('public', 'create_share_grant_from_pairing', array['text', 'uuid', 'uuid', 'timestamp with time zone'], 'patient creates a bound grant through an RPC');
select has_function('private', 'create_share_grant_from_pairing', array['uuid', 'text', 'uuid', 'uuid', 'timestamp with time zone'], 'privileged grant check stays private');
select is(
  (select procedure.prosecdef from pg_catalog.pg_proc procedure join pg_catalog.pg_namespace namespace on namespace.oid = procedure.pronamespace where namespace.nspname = 'public' and procedure.proname = 'issue_share_pairing_code' and pg_catalog.pg_get_function_identity_arguments(procedure.oid) = ''),
  false,
  'public issue RPC is security invoker'
);
select is(
  (select procedure.prosecdef from pg_catalog.pg_proc procedure join pg_catalog.pg_namespace namespace on namespace.oid = procedure.pronamespace where namespace.nspname = 'private' and procedure.proname = 'issue_share_pairing_code' and pg_catalog.pg_get_function_identity_arguments(procedure.oid) = 'actor_id uuid'),
  true,
  'private issue logic is security definer'
);
select ok(
  not pg_catalog.has_table_privilege('authenticated', 'private.share_pairing_codes', 'select'),
  'authenticated clients cannot read pairing digests'
);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
values
  ('00000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'patient@example.test', '', now(), now()),
  ('00000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'clinician@example.test', '', now(), now()),
  ('00000000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'disabled@example.test', '', now(), now());

insert into public.share_recipients (user_id, display_name, organization, accepting_shares)
values
  ('00000000-0000-4000-8000-000000000002', 'Synthetic Clinician', 'Synthetic Clinic', true),
  ('00000000-0000-4000-8000-000000000003', 'Disabled Clinician', 'Synthetic Clinic', false);

create temporary table pairing_results (
  label text primary key,
  pairing_code text not null,
  expires_at timestamptz not null
) on commit drop;
grant insert, select on table pairing_results to authenticated;

create temporary table resolved_results (
  label text not null,
  recipient_id uuid not null,
  display_name text not null,
  organization text not null,
  pairing_expires_at timestamptz not null
) on commit drop;
grant insert, select on table resolved_results to authenticated;

create temporary table visibility_results (
  label text primary key,
  row_count bigint not null
) on commit drop;
grant insert, select on table visibility_results to authenticated;

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000002', true);
insert into pairing_results select 'first', issued.pairing_code, issued.expires_at from public.issue_share_pairing_code() issued;
reset role;

select is((select count(*) from pairing_results where label = 'first'), 1::bigint, 'accepting clinician issues one pairing code');
select matches(
  (select pairing_code from pairing_results where label = 'first'),
  '^[0123456789ABCDEFGHJKMNPQRSTVWXYZ]{4}(-[0123456789ABCDEFGHJKMNPQRSTVWXYZ]{4}){3}$',
  'pairing code carries 80 bits in grouped Crockford Base32'
);
select ok(
  (select expires_at > now() + interval '9 minutes' and expires_at <= now() + interval '10 minutes 5 seconds' from pairing_results where label = 'first'),
  'pairing code uses a short server-controlled ten-minute expiry'
);
select is((select count(*) from private.share_pairing_codes), 1::bigint, 'only one digest row is stored for the clinician');

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000001', true);
insert into resolved_results
select 'exact', resolved.recipient_id, resolved.display_name, resolved.organization, resolved.pairing_expires_at
from public.resolve_share_pairing_code((select pairing_code from pairing_results where label = 'first')) resolved;
insert into resolved_results
select 'wrong', resolved.recipient_id, resolved.display_name, resolved.organization, resolved.pairing_expires_at
from public.resolve_share_pairing_code('0000-0000-0000-0000') resolved;
insert into visibility_results select 'directory', count(*) from public.share_recipients;
reset role;

select is((select count(*) from resolved_results where label = 'exact'), 1::bigint, 'patient resolves one exact active pairing code');
select is((select recipient_id from resolved_results where label = 'exact'), '00000000-0000-4000-8000-000000000002'::uuid, 'lookup returns internal recipient binding');
select is((select display_name || ' · ' || organization from resolved_results where label = 'exact'), 'Synthetic Clinician · Synthetic Clinic', 'lookup returns only needed self-declared profile copy');
select is((select count(*) from resolved_results where label = 'wrong'), 0::bigint, 'wrong code returns no recipient details');
select is((select row_count from visibility_results where label = 'directory'), 0::bigint, 'patient cannot list accepting recipient profiles');

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000002', true);
insert into resolved_results
select 'self', resolved.recipient_id, resolved.display_name, resolved.organization, resolved.pairing_expires_at
from public.resolve_share_pairing_code((select pairing_code from pairing_results where label = 'first')) resolved;
insert into pairing_results select 'second', issued.pairing_code, issued.expires_at from public.issue_share_pairing_code() issued;
reset role;

select is((select count(*) from resolved_results where label = 'self'), 0::bigint, 'clinician cannot pair with their own account');
select isnt((select pairing_code from pairing_results where label = 'second'), (select pairing_code from pairing_results where label = 'first'), 'rotation produces a new code');

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000001', true);
insert into resolved_results
select 'rotated-old', resolved.recipient_id, resolved.display_name, resolved.organization, resolved.pairing_expires_at
from public.resolve_share_pairing_code((select pairing_code from pairing_results where label = 'first')) resolved;
insert into resolved_results
select 'rotated-new', resolved.recipient_id, resolved.display_name, resolved.organization, resolved.pairing_expires_at
from public.resolve_share_pairing_code((select pairing_code from pairing_results where label = 'second')) resolved;
reset role;

select is((select count(*) from resolved_results where label = 'rotated-old'), 0::bigint, 'rotation invalidates the previous code');
select is((select count(*) from resolved_results where label = 'rotated-new'), 1::bigint, 'rotated code resolves while active');

update private.share_pairing_codes
set issued_at = now() - interval '20 minutes', expires_at = now() - interval '10 minutes'
where clinician_id = '00000000-0000-4000-8000-000000000002';
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000001', true);
insert into resolved_results
select 'expired', resolved.recipient_id, resolved.display_name, resolved.organization, resolved.pairing_expires_at
from public.resolve_share_pairing_code((select pairing_code from pairing_results where label = 'second')) resolved;
reset role;
select is((select count(*) from resolved_results where label = 'expired'), 0::bigint, 'expired code returns no recipient details');

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000002', true);
insert into pairing_results select 'third', issued.pairing_code, issued.expires_at from public.issue_share_pairing_code() issued;
update public.share_recipients set accepting_shares = false where user_id = '00000000-0000-4000-8000-000000000002';
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000001', true);
insert into resolved_results
select 'disabled', resolved.recipient_id, resolved.display_name, resolved.organization, resolved.pairing_expires_at
from public.resolve_share_pairing_code((select pairing_code from pairing_results where label = 'third')) resolved;
reset role;
select is((select count(*) from resolved_results where label = 'disabled'), 0::bigint, 'disabled profile cannot be resolved');

update public.share_recipients set accepting_shares = true where user_id = '00000000-0000-4000-8000-000000000002';
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000001', true);
insert into resolved_results
select 'reenabled-old', resolved.recipient_id, resolved.display_name, resolved.organization, resolved.pairing_expires_at
from public.resolve_share_pairing_code((select pairing_code from pairing_results where label = 'third')) resolved;
reset role;
select is((select count(*) from resolved_results where label = 'reenabled-old'), 0::bigint, 're-enabling a profile does not resurrect its old code');

set local role anon;
select throws_ok(
  $$select * from public.resolve_share_pairing_code('0000-0000-0000-0000')$$,
  '42501',
  'permission denied for function resolve_share_pairing_code',
  'anonymous clients cannot call pairing lookup'
);
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000003', true);
select throws_ok(
  $$select * from public.issue_share_pairing_code()$$,
  'P0001',
  'Save an accepting pairing profile before creating a code.',
  'non-accepting profile cannot issue a pairing code'
);
reset role;

select * from finish();
rollback;
