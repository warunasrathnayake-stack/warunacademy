begin;
set local search_path = academy, pg_catalog;
-- Read contracts are security INVOKER: even a direct RPC call sees the caller's RLS slice.
create function academy_api.me() returns jsonb language sql stable set search_path='' as $$
 select jsonb_build_object('id',p.id,'display_name',p.display_name,'locale',p.locale,'roles',coalesce((
   select jsonb_agg(r.code order by r.code) from academy.roles r join academy.user_roles ur on ur.role_id=r.id where ur.user_id=p.id),'[]'::jsonb))
 from academy.profiles p where p.id=auth.uid()
$$;
create function academy_api.students(p_offset integer) returns table(id uuid,student_code text,name text,grade_id uuid,active boolean) language sql stable set search_path='' as $$
 select s.id,s.student_code,s.name::text,s.grade_id,s.active from academy.students s order by s.id limit 100 offset greatest(p_offset,0)
$$;
create function academy_api.guardians(p_student_id uuid) returns table(id uuid,name text,phone text,relationship text) language sql stable set search_path='' as $$
 select g.id,g.name::text,g.phone::text,sg.relationship::text from academy.guardians g join academy.student_guardians sg on sg.guardian_id=g.id
 where sg.student_id=p_student_id order by g.id
$$;
create function academy_api.enrollments(p_student_id uuid) returns table(id uuid,group_id uuid,starts_on date,ends_on date) language sql stable set search_path='' as $$
 select e.id,e.group_id,e.starts_on,e.ends_on from academy.enrollments e where e.student_id=p_student_id order by e.starts_on,e.id
$$;
create function academy_api.classes(p_offset integer) returns table(id uuid,label text,course_title text,grade integer) language sql stable set search_path='' as $$
 select cg.id,cg.label::text,c.title::text,g.level::integer from academy.class_groups cg join academy.courses c on c.id=cg.course_id join academy.grades g on g.id=c.grade_id
 where cg.active order by cg.id limit 100 offset greatest(p_offset,0)
$$;
create function academy_api.sessions(p_group_id uuid,p_offset integer) returns table(id uuid,starts_at timestamptz,ends_at timestamptz,cancelled boolean) language sql stable set search_path='' as $$
 select s.id,s.starts_at,s.ends_at,s.cancelled from academy.class_sessions s where s.group_id=p_group_id order by s.starts_at,s.id limit 100 offset greatest(p_offset,0)
$$;
create function academy_api.cards(p_student_id uuid) returns table(id uuid,status text,issued_at timestamptz,expires_at timestamptz) language sql stable set search_path='' as $$
 select c.id,case when c.status='active' and c.expires_at<=now() then 'expired' else c.status end,c.issued_at,c.expires_at from academy.student_cards c where c.student_id=p_student_id order by c.issued_at desc limit 100
$$;
create function academy_api.print_metadata(p_card_id uuid) returns jsonb language plpgsql stable set search_path='' as $$
declare result jsonb;
begin
 if not coalesce(academy.permitted('card.issue'),false) then raise insufficient_privilege; end if;
 select jsonb_build_object('card_id',c.id,'student_code',s.student_code,'name',s.name,'grade',g.level,'expires_at',c.expires_at)
 into strict result from academy.student_cards c join academy.students s on s.id=c.student_id join academy.grades g on g.id=s.grade_id
 where c.id=p_card_id and c.status='active' and c.expires_at>now(); return result;
end $$;
create function academy_api.history(p_student_id uuid,p_offset integer) returns table(id uuid,session_id uuid,status text,marked_at timestamptz,source text) language sql stable set search_path='' as $$
 select a.id,a.session_id,a.status::text,a.marked_at,a.source from academy.attendance_records a where a.student_id=p_student_id order by a.marked_at desc,a.id limit 100 offset greatest(p_offset,0)
$$;
create function academy_api.report(p_day date,p_group_id uuid,p_offset integer)
returns table(group_id uuid,session_id uuid,student_id uuid,student_code text,name text,status text) language plpgsql stable set search_path='' as $$
begin
 if not coalesce(academy.permitted('attendance.report'),false) or (p_group_id is not null and not coalesce(academy.staff_group(p_group_id),false)) then raise insufficient_privilege; end if;
 return query select se.group_id,se.id,s.id,s.student_code,s.name::text,coalesce(a.status::text,'unmarked')
 from academy.class_sessions se join academy.enrollments e on e.group_id=se.group_id join academy.students s on s.id=e.student_id
 left join academy.attendance_records a on a.session_id=se.id and a.student_id=s.id
 where academy.staff_group(se.group_id) and (p_group_id is null or se.group_id=p_group_id) and not se.cancelled
 and se.starts_at>=(p_day::timestamp at time zone 'Asia/Colombo') and se.starts_at<((p_day+1)::timestamp at time zone 'Asia/Colombo')
 and p_day between e.starts_on and coalesce(e.ends_on,'infinity'::date) order by se.group_id,se.starts_at,se.id,s.id limit 100 offset greatest(p_offset,0);
end $$;
create function academy_api.resources(p_offset integer) returns table(id uuid,title text,grade_id uuid) language sql stable set search_path='' as $$
 select r.id,r.title::text,r.grade_id from academy.library_resources r order by r.id limit 100 offset greatest(p_offset,0)
$$;
create function academy_api.resource_access(p_resource_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare path text;
begin
 if not academy.resource_allowed(p_resource_id) then raise no_data_found; end if;
 perform academy.take_quota('library.access',30);
 select m.object_path into strict path from academy.media_assets m join academy.library_resources r on r.asset_id=m.id where r.id=p_resource_id;
 insert into academy.resource_downloads(resource_id,viewer_id) values(p_resource_id,auth.uid()); return jsonb_build_object('object_path',path);
end $$;
create function academy_api.posts(p_offset integer) returns table(id uuid,slug text,title text,body text,status text) language sql stable set search_path='' as $$
 select p.id,p.slug::text,p.title::text,p.body,p.status::text from academy.posts p order by p.created_at desc,p.id limit 100 offset greatest(p_offset,0)
$$;
create function academy_api.draft_post(p_slug academy.slug,p_title text,p_body text) returns jsonb language plpgsql security definer set search_path='' as $$
declare post uuid;
begin
 perform academy.guard_write('content.manage',20);
 insert into academy.posts(slug,title,body,author_id) values(p_slug,p_title,p_body,auth.uid()) returning id into post;
 insert into academy.content_revisions(post_id,title,body,author_id) values(post,p_title,p_body,auth.uid()); perform academy.audit('draft','posts',post);
 return jsonb_build_object('id',post);
end $$;
create function academy_api.leads(p_offset integer) returns table(id uuid,name text,phone text,stage text,created_at timestamptz) language plpgsql stable set search_path='' as $$
begin
 if not coalesce(academy.permitted('crm.manage'),false) then raise insufficient_privilege; end if;
 return query select l.id,c.name::text,c.phone::text,l.stage::text,l.created_at from academy.leads l join academy.contacts c on c.id=l.contact_id order by l.created_at desc,l.id limit 100 offset greatest(p_offset,0);
end $$;
create function academy_api.create_lead(p_name text,p_phone academy.phone_e164,p_consent_ref text,p_source text) returns jsonb language plpgsql security definer set search_path='' as $$
declare contact uuid; lead uuid; src uuid;
begin
 perform academy.guard_write('crm.manage',30);
 insert into academy.contacts(name,phone) values(p_name,p_phone) returning id into contact;
 insert into academy.leads(contact_id,consent_ref,assigned_to) values(contact,p_consent_ref,auth.uid()) returning id into lead;
 insert into academy.lead_sources(label) values(p_source) on conflict(label) do update set label=excluded.label returning id into src;
 insert into academy.lead_attributions(lead_id,source_id) values(lead,src);
 perform academy.audit('create','leads',lead); return jsonb_build_object('id',lead);
end $$;
create function academy_api.update_lead(p_lead_id uuid,p_stage academy.lead_stage,p_note text,p_follow_up_at timestamptz) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 perform academy.guard_write('crm.manage',30);
 update academy.leads set stage=p_stage where id=p_lead_id; if not found then raise no_data_found; end if;
 insert into academy.lead_activities(lead_id,actor_id,kind,note,follow_up_at) values(p_lead_id,auth.uid(),'stage:'||p_stage::text,p_note,p_follow_up_at);
 perform academy.audit('update','leads',p_lead_id); return jsonb_build_object('id',p_lead_id);
end $$;
create function academy_api.notifications(p_offset integer) returns table(id uuid,title text,read_at timestamptz,created_at timestamptz) language sql stable set search_path='' as $$
 select n.id,n.title::text,n.read_at,n.created_at from academy.notifications n order by n.created_at desc,n.id limit 100 offset greatest(p_offset,0)
$$;
-- Reviewed provisioning paths; no classroom is created with guessed attendance rules.
create function academy_api.create_course(p_grade integer,p_title text) returns jsonb language plpgsql security definer set search_path='' as $$
declare g uuid; course uuid;
begin
 perform academy.guard_write('schedule.manage',30);
 select id into strict g from academy.grades where level=p_grade;
 insert into academy.courses(grade_id,title) values(g,p_title) returning id into course;
 perform academy.audit('create','courses',course); return jsonb_build_object('id',course);
end $$;
create function academy_api.create_class(p_course_id uuid,p_label text,p_teacher_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare grp uuid;
begin
 perform academy.guard_write('schedule.manage',30);
 if not exists(select from academy.user_roles ur join academy.roles r on r.id=ur.role_id where ur.user_id=p_teacher_id and r.code='teacher') then raise invalid_parameter_value; end if;
 insert into academy.class_groups(course_id,label,teacher_id) values(p_course_id,p_label,p_teacher_id) returning id into grp;
 perform academy.audit('create','class_groups',grp); return jsonb_build_object('id',grp);
end $$;
create function academy_api.schedule(p_group_id uuid,p_starts_at timestamptz,p_ends_at timestamptz,p_scan_opens_at timestamptz,p_scan_closes_at timestamptz,p_late_after timestamptz) returns jsonb language plpgsql security definer set search_path='' as $$
declare sess uuid;
begin
 perform academy.guard_write('schedule.manage',30);
 if not exists(select from academy.class_groups where id=p_group_id and active) then raise no_data_found; end if;
 insert into academy.class_sessions(group_id,starts_at,ends_at,scan_opens_at,scan_closes_at,late_after) values(p_group_id,p_starts_at,p_ends_at,p_scan_opens_at,p_scan_closes_at,p_late_after) returning id into sess;
 perform academy.audit('schedule','class_sessions',sess); return jsonb_build_object('id',sess);
end $$;
create function academy_api.register_device(p_label text,p_location text,p_operator_id uuid,p_group_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare device uuid;
begin
 perform academy.guard_write('device.manage',20);
 if not exists(select from academy.user_roles ur join academy.role_permissions rp using(role_id) join academy.permissions p on p.id=rp.permission_id
   where ur.user_id=p_operator_id and p.code='attendance.scan') or not exists(select from academy.class_groups where id=p_group_id and active) then raise invalid_parameter_value; end if;
 insert into academy.attendance_devices(label,assigned_location,operator_id,group_id,active) values(p_label,p_location,p_operator_id,p_group_id,true) returning id into device;
 return jsonb_build_object('id',device); -- provisioning trigger audits this change
end $$;
create function academy_api.disable_device(p_device_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 perform academy.guard_write('device.manage',20);
 update academy.attendance_devices set active=false where id=p_device_id;
 if not found then raise no_data_found; end if; return jsonb_build_object('id',p_device_id);
end $$;
-- academy_api is an RPC-only schema; no tables/views, no anonymous EXECUTE. Every new function requires review.
revoke all on all functions in schema academy_api from public,anon,authenticated;
grant usage on schema academy_api to authenticated;
grant execute on all functions in schema academy_api to authenticated;
notify pgrst,'reload schema';
commit;
