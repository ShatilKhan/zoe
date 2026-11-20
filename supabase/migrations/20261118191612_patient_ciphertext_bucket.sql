-- This bucket stores encrypted, opaque patient objects only.
-- Keep it private. No client Storage policy is granted in this migration.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'zoe-patient-ciphertext',
  'zoe-patient-ciphertext',
  false,
  10485760,
  array['application/octet-stream']::text[]
)
on conflict (id) do nothing;
