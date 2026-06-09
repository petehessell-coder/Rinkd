-- ADS-1 M0: public bucket for sponsor creative (admin-uploaded). Mirrors share-cards.
-- Applied to prod via MCP.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('ad-creatives', 'ad-creatives', true, 5242880,
        array['image/png','image/jpeg','image/webp','image/svg+xml'])
on conflict (id) do nothing;

drop policy if exists "ad_creatives_bucket_public_read" on storage.objects;
create policy "ad_creatives_bucket_public_read" on storage.objects
  for select to public using (bucket_id = 'ad-creatives');

drop policy if exists "ad_creatives_bucket_authed_insert" on storage.objects;
create policy "ad_creatives_bucket_authed_insert" on storage.objects
  for insert to authenticated with check (bucket_id = 'ad-creatives');

drop policy if exists "ad_creatives_bucket_authed_update" on storage.objects;
create policy "ad_creatives_bucket_authed_update" on storage.objects
  for update to authenticated using (bucket_id = 'ad-creatives') with check (bucket_id = 'ad-creatives');
