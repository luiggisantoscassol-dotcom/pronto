insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'produtos',
  'produtos',
  true,
  8388608,
  array['image/webp', 'image/jpeg', 'image/png']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "product images public read" on storage.objects;
create policy "product images public read"
on storage.objects for select
using (bucket_id = 'produtos');

drop policy if exists "product images admin insert" on storage.objects;
create policy "product images admin insert"
on storage.objects for insert to authenticated
with check (bucket_id = 'produtos' and public.is_admin());

drop policy if exists "product images admin update" on storage.objects;
create policy "product images admin update"
on storage.objects for update to authenticated
using (bucket_id = 'produtos' and public.is_admin())
with check (bucket_id = 'produtos' and public.is_admin());

drop policy if exists "product images admin delete" on storage.objects;
create policy "product images admin delete"
on storage.objects for delete to authenticated
using (bucket_id = 'produtos' and public.is_admin());
