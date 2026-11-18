begin;
select plan(18);

select has_table('public', 'share_grants', 'share grants table exists');
select ok(
  (select relrowsecurity from pg_catalog.pg_class where oid = 'public.share_grants'::regclass),
  'share grants enforce RLS'
);
select policies_are(
  'public',
  'share_grants',
  array['participants read grant metadata', 'patients create scoped grants', 'patients revoke their grants'],
  'share grants expose only the expected policies'
);
select has_trigger('public', 'share_grants', 'protect_share_grant_identity_before_update', 'revocation and identity trigger exists');
select has_trigger('public', 'share_grants', 'enforce_share_grant_server_fields_before_insert', 'server timestamp trigger exists');

create temporary table share_grant_mutation_results (
  actor text primary key,
  affected_rows bigint not null
) on commit drop;
grant insert, select on table share_grant_mutation_results to authenticated;

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
values
  ('00000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'patient@example.test', '', now(), now()),
  ('00000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'clinician@example.test', '', now(), now());

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
values ('00000000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'declined@example.test', '', now(), now());

insert into public.share_recipients (user_id, display_name, organization, accepting_shares)
values
  ('00000000-0000-4000-8000-000000000002', 'Synthetic Clinician', 'Synthetic Clinic', true),
  ('00000000-0000-4000-8000-000000000003', 'Declined Recipient', 'Synthetic Clinic', false);

select throws_ok(
  $$insert into public.share_grants (patient_id, recipient_id, object_id, expires_at) values ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000099', now() + interval '24 hours 1 second')$$,
  '23514',
  'new row for relation "share_grants" violates check constraint "share_grants_max_ttl"',
  'the database caps grant TTL at 24 hours'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000001', true);

select throws_ok(
  $$insert into public.share_grants (patient_id, recipient_id, object_id, expires_at, created_at) values ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000096', now() + interval '8 days', now() + interval '7 days')$$,
  '42501',
  'permission denied for table share_grants',
  'an authenticated patient cannot forge created_at to bypass the TTL cap'
);

select throws_ok(
  $$insert into public.share_grants (patient_id, recipient_id, object_id, expires_at) values ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000098', now() + interval '1 hour')$$,
  '42501',
  'new row violates row-level security policy for table "share_grants"',
  'RLS rejects a grant to a recipient who is not accepting shares'
);

select lives_ok(
  $$insert into public.share_grants (patient_id, recipient_id, object_id, expires_at) values ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000097', now() + interval '1 hour')$$,
  'RLS accepts a patient grant to an accepting recipient'
);

reset role;

insert into public.share_grants (id, patient_id, recipient_id, object_id, expires_at)
values (
  '00000000-0000-4000-8000-000000000010',
  '00000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000002',
  '00000000-0000-4000-8000-000000000020',
  now() + interval '1 day'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000001', true);

select lives_ok(
  $$update public.share_grants set revoked_at = '2000-01-01T00:00:00Z' where id = '00000000-0000-4000-8000-000000000010'$$,
  'a patient can revoke an active grant'
);

select ok(
  (select revoked_at > now() - interval '5 seconds' from public.share_grants where id = '00000000-0000-4000-8000-000000000010'),
  'the database supplies the authoritative revocation time'
);

select throws_ok(
  $$update public.share_grants set revoked_at = null where id = '00000000-0000-4000-8000-000000000010'$$,
  'P0001',
  'share revocation is permanent',
  'a revoked grant cannot be un-revoked'
);

select throws_ok(
  $$update public.share_grants set revoked_at = now() + interval '1 hour' where id = '00000000-0000-4000-8000-000000000010'$$,
  'P0001',
  'share revocation is permanent',
  'a revoked grant timestamp cannot be rewritten'
);

reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000002', true);
with changed as (
  update public.share_grants
  set revoked_at = now()
  where id = '00000000-0000-4000-8000-000000000010'
  returning id
)
insert into share_grant_mutation_results (actor, affected_rows)
select 'recipient', count(*) from changed;
select is(
  (select affected_rows from share_grant_mutation_results where actor = 'recipient'),
  0::bigint,
  'the recipient cannot revoke or mutate a patient grant'
);
select is(
  (select count(*) from public.share_grants where recipient_id = '00000000-0000-4000-8000-000000000002'),
  2::bigint,
  'the recipient can read only grants addressed to that account'
);
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000003', true);
with changed as (
  update public.share_grants
  set revoked_at = now()
  where id = '00000000-0000-4000-8000-000000000010'
  returning id
)
insert into share_grant_mutation_results (actor, affected_rows)
select 'attacker', count(*) from changed;
select is(
  (select affected_rows from share_grant_mutation_results where actor = 'attacker'),
  0::bigint,
  'an unrelated authenticated account cannot mutate a grant'
);
select is(
  (select count(*) from public.share_grants),
  0::bigint,
  'an unrelated authenticated account cannot read grants'
);
reset role;

insert into storage.objects (bucket_id, name, owner_id)
values ('zoe-shares', '00000000-0000-4000-8000-000000000001/00000000-0000-4000-8000-000000000020.bin', '00000000-0000-4000-8000-000000000001');

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000002', true);
select is(
  (select count(*) from storage.objects where bucket_id = 'zoe-shares'),
  0::bigint,
  'direct authenticated Storage SELECT cannot read ciphertext objects'
);
reset role;

select * from finish();
rollback;
