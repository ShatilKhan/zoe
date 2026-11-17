begin;
select plan(8);

select has_table('public', 'share_grants', 'share grants table exists');
select row_security_active('public.share_grants'::regclass, 'share grants enforce RLS');
select policies_are(
  'public',
  'share_grants',
  array['participants read grant metadata', 'patients create scoped grants', 'patients revoke their grants'],
  'share grants expose only the expected policies'
);
select has_trigger('public', 'share_grants', 'protect_share_grant_identity_before_update', 'revocation and identity trigger exists');

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
values
  ('00000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'patient@example.test', '', now(), now()),
  ('00000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'clinician@example.test', '', now(), now());

insert into public.share_grants (id, patient_id, recipient_id, object_id, expires_at)
values (
  '00000000-0000-4000-8000-000000000010',
  '00000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000002',
  '00000000-0000-4000-8000-000000000020',
  now() + interval '1 day'
);

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

select * from finish();
rollback;
