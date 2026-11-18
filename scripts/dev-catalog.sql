-- Read-only commissioning evidence. Run on the named dev DB and isolated restore;
-- compare with docs/development-commissioning.md. Counts are NOT a backup.
with app_tables as (
  select c.oid, c.relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='academy' and c.relkind in ('r','p')
), rpc as (
  select p.oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='academy_api'
)
select
  (select count(*)::int from pg_namespace where nspname in ('academy','academy_api')) as app_schemas,
  (select count(*)::int from app_tables) as app_tables,
  (select count(*)::int from app_tables where not relrowsecurity) as tables_missing_rls,
  (select count(*)::int from app_tables t where exists (
    select from (values ('anon'::name),('authenticated'::name)) client(role_name)
    where has_table_privilege(client.role_name,t.oid,'INSERT,UPDATE,DELETE,TRUNCATE')
       or has_any_column_privilege(client.role_name,t.oid,'INSERT,UPDATE')
  )) as client_writable_tables,
  (select count(*)::int from rpc) as rpc_functions,
  (select count(*)::int from rpc where has_function_privilege('anon',oid,'execute')) as anon_executable_rpcs,
  (select count(*)::int from auth.users) as auth_users,
  (select count(*)::int from pg_trigger where tgrelid='auth.users'::regclass and not tgisinternal and tgname='academy_profile' and tgenabled<>'D') as active_profile_triggers,
  (select count(*)::int from storage.buckets where id in ('academy-library','academy-imports') and not public and file_size_limit=10485760
    and allowed_mime_types=case id when 'academy-library' then array['application/pdf'] else array['text/csv'] end) as matching_private_buckets,
  (select relrowsecurity from pg_class where oid='storage.objects'::regclass) as storage_objects_rls,
  (select count(*)::int from pg_policies where schemaname='storage' and tablename='objects') as storage_object_policies;
