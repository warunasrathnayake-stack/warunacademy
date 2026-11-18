begin;
set local search_path = academy, pg_catalog;
-- Only a fresh academy schema is affected. New tables remain closed unless explicitly granted below.
do $$ declare t record; begin
  for t in select tablename from pg_tables where schemaname='academy' loop
    execute format('alter table academy.%I enable row level security',t.tablename);
  end loop;
end $$;
revoke all on all tables in schema academy from public, anon, authenticated;
revoke all on all sequences in schema academy from public, anon, authenticated;

create function provision_profile() returns trigger language plpgsql security definer set search_path='' as $$
begin insert into academy.profiles(id) values(new.id); return new; end $$;
create trigger academy_profile after insert on auth.users for each row execute function provision_profile();
-- Never authorize from user-editable metadata. An admin with a second role still needs AAL2.
create function session_ok() returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and (auth.jwt()->>'aal' = 'aal2' or not exists(
   select from academy.user_roles ur join academy.roles r on r.id=ur.role_id
   where ur.user_id=auth.uid() and r.code in ('admin','super_admin')))
$$;
create function permitted(p_code text) returns boolean language sql stable security definer set search_path='' as $$
 select academy.session_ok() and exists(select from academy.user_roles ur join academy.role_permissions rp using(role_id)
   join academy.permissions p on p.id=rp.permission_id where ur.user_id=auth.uid() and p.code=p_code)
$$;
create function family_student(p_student uuid) returns boolean language sql stable security definer set search_path='' as $$
 select academy.session_ok() and (exists(select from academy.students s where s.id=p_student and s.profile_id=auth.uid()) or exists(
   select from academy.student_guardians sg join academy.guardians g on g.id=sg.guardian_id
   where sg.student_id=p_student and g.profile_id=auth.uid() and g.verified_at is not null and sg.access_verified_at is not null))
$$;
create function staff_group(p_group uuid) returns boolean language sql stable security definer set search_path='' as $$
 select academy.permitted('academic.all') or (academy.permitted('academic.teach') and exists(
   select from academy.class_groups cg where cg.id=p_group and cg.teacher_id=auth.uid()))
$$;
create function visible_group(p_group uuid) returns boolean language sql stable security definer set search_path='' as $$
 select academy.staff_group(p_group) or academy.permitted('admit') or exists(select from academy.enrollments e
   join academy.students s on s.id=e.student_id where e.group_id=p_group and s.active and academy.family_student(e.student_id)
   and (now() at time zone 'Asia/Colombo')::date between e.starts_on and coalesce(e.ends_on,'infinity'::date)) or (academy.permitted('attendance.scan') and exists(
   select from academy.attendance_devices d where d.group_id=p_group and d.active and d.operator_id=auth.uid()))
$$;
create function roster_student(p_student uuid) returns boolean language sql stable security definer set search_path='' as $$
 select academy.family_student(p_student) or academy.permitted('admit') or academy.permitted('card.issue') or exists(
   select from academy.enrollments e where e.student_id=p_student and academy.staff_group(e.group_id))
$$;
create function resource_allowed(p_resource uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select from academy.library_resources r join academy.media_assets m on m.id=r.asset_id
   where r.id=p_resource and m.bucket='academy-library' and m.scan_status='clean' and (academy.permitted('library.manage') or
   (r.published and (exists(select from academy.resource_entitlements e join academy.students s on s.id=e.student_id
     where e.resource_id=r.id and s.active and academy.family_student(s.id) and e.revoked_at is null and e.starts_at<=now() and (e.expires_at is null or now()<e.expires_at))
   or exists(select from academy.resource_access_rules a join academy.enrollments e using(group_id) join academy.students s on s.id=e.student_id
     where a.resource_id=r.id and s.active and academy.family_student(s.id) and (now() at time zone 'Asia/Colombo')::date
     between e.starts_on and coalesce(e.ends_on,'infinity'::date))))))
$$;
create function library_object_allowed(p_path text) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select from academy.media_assets m join academy.library_resources r on r.asset_id=m.id
   where m.bucket='academy-library' and m.object_path=p_path and academy.resource_allowed(r.id))
$$;

create function audit(p_action text,p_entity text,p_id uuid) returns void language sql set search_path='' as $$
 insert into academy.audit_logs(actor_id,action,entity,entity_id) values(auth.uid(),p_action,p_entity,p_id)
$$;
create function audit_provisioning() returns trigger language plpgsql security definer set search_path='' as $$
declare row_data jsonb := case when tg_op='DELETE' then to_jsonb(old) else to_jsonb(new) end;
begin
 insert into academy.audit_logs(actor_id,action,entity,entity_id,related_id)
 values(auth.uid(),lower(tg_op),tg_table_name,(row_data->>tg_argv[0])::uuid,(row_data->>tg_argv[1])::uuid);
 return null;
end $$;
create trigger audit_role after insert or update or delete on user_roles for each row execute function audit_provisioning('user_id','role_id');
create trigger audit_permission after insert or update or delete on role_permissions for each row execute function audit_provisioning('role_id','permission_id');
create trigger audit_guardian_link after insert or update or delete on student_guardians for each row execute function audit_provisioning('student_id','guardian_id');
create trigger audit_student_profile after update of profile_id,active on students for each row execute function audit_provisioning('id');
create trigger audit_guardian_profile after update of profile_id,verified_at on guardians for each row execute function audit_provisioning('id');
create trigger audit_device after insert or update of active,operator_id,group_id or delete on attendance_devices for each row execute function audit_provisioning('id');
create function immutable_record() returns trigger language plpgsql set search_path='' as $$
begin raise exception using errcode='55000',message='append_only'; end $$;
do $$ declare t text; begin
 foreach t in array array['audit_logs','consent_records','scan_events','attendance_adjustments','webhook_events','payment_webhook_events','content_revisions'] loop
   execute format('create trigger immutable before update or delete or truncate on academy.%I for each statement execute function academy.immutable_record()',t);
 end loop;
end $$;
-- Shared per-user quota for successful privileged commands, including direct PostgREST calls.
create function take_quota(p_operation text,p_limit integer) returns void language plpgsql set search_path='' as $$
declare m timestamptz := date_trunc('minute',clock_timestamp()); n integer;
begin
 insert into academy.write_quotas as q(user_id,operation,minute,hits) values(auth.uid(),p_operation,m,1)
 on conflict(user_id,operation) do update set minute=m,hits=case when q.minute=m then q.hits+1 else 1 end returning hits into n;
 if n>p_limit then raise exception using errcode='PT429',message='rate_limited'; end if;
end $$;

create function guard_write(p_permission text,p_limit integer) returns void language plpgsql set search_path='' as $$
begin
 if not coalesce(academy.permitted(p_permission),false) then raise insufficient_privilege; end if;
 perform academy.take_quota(p_permission,p_limit);
end $$;

grant usage on schema academy to authenticated;
grant select on profiles,roles,user_roles,grades,courses,class_groups,class_sessions,enrollments,library_resources,notifications to authenticated;
-- Roster readers never need birth dates, fingerprints, account links, token digests or guardian phone numbers of other families.
grant select(id,name,student_code,grade_id,active) on students to authenticated;
grant select(id,name,phone) on guardians to authenticated;
grant select(student_id,guardian_id,relationship) on student_guardians to authenticated;
grant select(id,student_id,status,issued_at,expires_at) on student_cards to authenticated;
grant select(id,student_id,session_id,group_id,status,marked_at,source) on attendance_records to authenticated;
grant select on posts,leads,contacts,lead_activities,audit_logs,consent_records to authenticated;
create policy mine on profiles for select to authenticated using(id=(select auth.uid()));
create policy mine on user_roles for select to authenticated using(user_id=(select auth.uid()));
create policy vocabulary on roles for select to authenticated using(true);
create policy vocabulary on grades for select to authenticated using(true);
create policy curriculum on courses for select to authenticated using(exists(select from academy.class_groups g where g.course_id=courses.id));
create policy scoped on class_groups for select to authenticated using(academy.visible_group(id));
create policy scoped on class_sessions for select to authenticated using(academy.visible_group(group_id));
create policy roster on students for select to authenticated using(academy.roster_student(id));
create policy contact on guardians for select to authenticated using(academy.permitted('admit') or (academy.session_ok() and profile_id=auth.uid() and verified_at is not null));
create policy link on student_guardians for select to authenticated using(academy.permitted('admit') or (access_verified_at is not null and exists(select g.id from academy.guardians g where g.id=guardian_id)));
create policy scoped on enrollments for select to authenticated using(academy.permitted('admit') or academy.family_student(student_id) or academy.staff_group(group_id));
create policy card_metadata on student_cards for select to authenticated using(academy.permitted('card.issue') or academy.family_student(student_id));
create policy scoped on attendance_records for select to authenticated using(academy.family_student(student_id) or (academy.permitted('attendance.report') and academy.staff_group(group_id)));
create policy entitled on library_resources for select to authenticated using(academy.resource_allowed(id));
create policy mine on notifications for select to authenticated using(academy.session_ok() and recipient_id=auth.uid());
create policy editor on posts for select to authenticated using(academy.permitted('content.manage') or (academy.session_ok() and status='published'));
create policy crm on leads for select to authenticated using(academy.permitted('crm.manage'));
create policy crm on contacts for select to authenticated using(academy.permitted('crm.manage'));
create policy crm on lead_activities for select to authenticated using(academy.permitted('crm.manage'));
create policy oversight on audit_logs for select to authenticated using(academy.permitted('audit.read'));
create policy evidence on consent_records for select to authenticated using(academy.permitted('admit') or exists(select g.id from academy.guardians g where g.id=guardian_id) and academy.family_student(student_id));

-- Supabase owns the storage schema. Never loosen existing global policies. Fail on bucket collisions.
do $$ begin
 if not (select relrowsecurity from pg_class where oid='storage.objects'::regclass) then raise exception 'storage_rls_required'; end if;
end $$;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values
 ('academy-library','academy-library',false,10485760,array['application/pdf']),
 ('academy-imports','academy-imports',false,10485760,array['text/csv']);
create policy academy_private_library on storage.objects for select to authenticated
 using(bucket_id='academy-library' and academy.library_object_allowed(name));
-- No client uploads, deletes, imports, raw scan-event reads or provider access.
revoke all on all functions in schema academy from public,anon,authenticated;
grant execute on function session_ok(),permitted(text),family_student(uuid),staff_group(uuid),visible_group(uuid),roster_student(uuid),resource_allowed(uuid),library_object_allowed(text) to authenticated;
commit;
