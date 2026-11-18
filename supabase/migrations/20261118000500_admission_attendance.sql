begin;
set local search_path = academy, pg_catalog;
create function admission_consented(p_student uuid) returns boolean language sql stable set search_path='' as $$
 select exists(select from (select distinct on (guardian_id) granted from academy.consent_records
   where student_id=p_student and purpose='admission' order by guardian_id,created_at desc,id desc) c where c.granted)
$$;
revoke all on function admission_consented(uuid) from public,anon,authenticated;
insert into permissions(code) values('consent.record');
insert into role_permissions select r.id,p.id from roles r, permissions p where r.code='guardian' and p.code='consent.record';

create function academy_api.admit(p_request_id uuid,p_student_name text,p_birth_date date,p_group_id uuid,p_guardian_id uuid,
 p_guardian_name text,p_guardian_phone text,p_relationship text,p_consent boolean,p_notice_version text,p_evidence_ref text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare g academy.guardians; s academy.students; grade uuid; enrollment uuid; registration uuid; fingerprint bytea;
begin
 perform academy.guard_write('admit',20);
 if p_consent is distinct from true or p_birth_date is null or p_birth_date not between date '1900-01-01' and (now() at time zone 'Asia/Colombo')::date then
   raise exception using errcode='22023',message='invalid_admission'; end if;
 select c.grade_id into strict grade from academy.class_groups cg join academy.courses c on c.id=cg.course_id where cg.id=p_group_id and cg.active for share of cg;
 if p_guardian_id is null then
   insert into academy.guardians(name,phone) values(trim(p_guardian_name),p_guardian_phone) returning * into g;
 else
   if p_guardian_name is not null or p_guardian_phone is not null then raise invalid_parameter_value; end if;
   select * into strict g from academy.guardians where id=p_guardian_id for share;
 end if;
 -- No automatic identity/account merge by phone. A natural-key collision goes to staff review.
 fingerprint:=sha256(convert_to(lower(regexp_replace(trim(p_student_name),'\s+',' ','g')) || '|' || to_char(p_birth_date,'YYYY-MM-DD') || '|' || g.phone,'UTF8'));
 insert into academy.students(name,birth_date,grade_id,duplicate_fingerprint) values(trim(p_student_name),p_birth_date,grade,fingerprint) returning * into s;
 insert into academy.student_guardians(student_id,guardian_id,relationship) values(s.id,g.id,p_relationship);
 insert into academy.consent_records(student_id,guardian_id,purpose,granted,notice_version,evidence_ref,actor_id)
 values(s.id,g.id,'admission',true,p_notice_version,p_evidence_ref,auth.uid());
 insert into academy.enrollments(student_id,group_id) values(s.id,p_group_id) returning id into enrollment;
 insert into academy.registrations(request_id,student_id,enrollment_id,admitted_by) values(p_request_id,s.id,enrollment,auth.uid()) returning id into registration;
 perform academy.audit('admit','students',s.id);
 return jsonb_build_object('registration_id',registration,'student_id',s.id,'student_code',s.student_code,'guardian_id',g.id,'enrollment_id',enrollment);
end $$;

create function academy_api.record_consent(p_student_id uuid,p_purpose text,p_granted boolean,p_notice_version text,p_evidence_ref text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare g uuid; rec uuid;
begin
 perform academy.guard_write('consent.record',20);
 select sg.guardian_id into g from academy.student_guardians sg join academy.guardians g on g.id=sg.guardian_id
 where sg.student_id=p_student_id and sg.access_verified_at is not null and g.verified_at is not null and g.profile_id=auth.uid();
 if g is null then raise insufficient_privilege; end if;
 insert into academy.consent_records(student_id,guardian_id,purpose,granted,notice_version,evidence_ref,actor_id)
 values(p_student_id,g,p_purpose,p_granted,p_notice_version,p_evidence_ref,auth.uid()) returning id into rec;
 perform academy.audit('record_consent','consent_records',rec); return jsonb_build_object('id',rec);
end $$;

create function academy_api.enroll(p_student_id uuid,p_group_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare enrollment uuid;
begin
 perform academy.guard_write('admit',20);
 if not exists(select from academy.students s join academy.courses c on c.grade_id=s.grade_id join academy.class_groups cg on cg.course_id=c.id
    where s.id=p_student_id and s.active and cg.id=p_group_id and cg.active) or not academy.admission_consented(p_student_id) then raise invalid_parameter_value; end if;
 insert into academy.enrollments(student_id,group_id) values(p_student_id,p_group_id) returning id into enrollment;
 perform academy.audit('enroll','enrollments',enrollment); return jsonb_build_object('id',enrollment);
end $$;

create function academy_api.issue_card(p_student_id uuid,p_expires_at timestamptz,p_replace boolean) returns jsonb language plpgsql security definer set search_path='' as $$
declare raw_token text; card uuid; job uuid; previous uuid;
begin
 perform academy.guard_write('card.issue',30);
 perform from academy.students where id=p_student_id and active for update;
 if not found then raise no_data_found; end if;
 if not academy.admission_consented(p_student_id) or p_expires_at is null or not isfinite(p_expires_at) or p_expires_at<=clock_timestamp() then raise invalid_parameter_value; end if;
 select id into previous from academy.student_cards where student_id=p_student_id and status in ('issued','active','suspended','lost');
 if previous is not null then
   if p_replace is distinct from true then raise unique_violation; end if;
   update academy.student_cards set status='revoked',revoked_at=clock_timestamp() where id=previous;
   update academy.card_print_jobs set status='cancelled' where card_id=previous and status='requested';
   perform academy.audit('replace','student_cards',previous);
 end if;
 -- Two independent random UUIDv4s: 244 random bits. The raw QR is returned only here.
 raw_token:=replace(gen_random_uuid()::text || gen_random_uuid()::text,'-','');
 insert into academy.student_cards(student_id,token_hash,status,expires_at,issued_by)
 values(p_student_id,sha256(convert_to(raw_token,'UTF8')),'active',p_expires_at,auth.uid()) returning id into card;
 insert into academy.card_print_jobs(card_id,requested_by) values(card,auth.uid()) returning id into job;
 perform academy.audit('issue','student_cards',card);
 return jsonb_build_object('card_id',card,'qr_token',raw_token,'print_job_id',job,'expires_at',p_expires_at);
end $$;

create function academy_api.revoke_card(p_card_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 perform academy.guard_write('card.issue',30);
 perform from academy.student_cards where id=p_card_id for update; if not found then raise no_data_found; end if;
 update academy.student_cards set status='revoked',revoked_at=clock_timestamp() where id=p_card_id and status<>'revoked';
 if found then
   update academy.card_print_jobs set status='cancelled' where card_id=p_card_id and status='requested';
   perform academy.audit('revoke','student_cards',p_card_id);
 end if;
 return jsonb_build_object('id',p_card_id);
end $$;

create function academy_api.scan(p_device_id uuid,p_session_id uuid,p_request_id uuid,p_qr_token text) returns jsonb language plpgsql security definer set search_path='' as $$
declare sess academy.class_sessions; c academy.student_cards; prior academy.scan_events; att uuid; result_code text;
 digest bytea; instant timestamptz; day date;
begin
 perform academy.guard_write('attendance.scan',180);
 if p_request_id is null or p_qr_token is null or p_qr_token !~ '^[0-9a-f]{64}$' then raise invalid_parameter_value; end if;
 select s.* into sess from academy.class_sessions s join academy.attendance_devices d on d.group_id=s.group_id
 join academy.class_groups cg on cg.id=s.group_id
 where s.id=p_session_id and d.id=p_device_id and cg.active and d.active and d.operator_id=auth.uid() for share of s,cg for update of d;
 if not found then raise insufficient_privilege; end if;
 digest:=sha256(convert_to(p_qr_token,'UTF8'));
 perform pg_advisory_xact_lock(hashtextextended(p_request_id::text,0));
 select * into prior from academy.scan_events where request_id=p_request_id;
 if found then
   if (prior.device_id,prior.session_id,prior.operator_id,prior.token_digest) is distinct from (p_device_id,p_session_id,auth.uid(),digest) then raise unique_violation; end if;
   return jsonb_build_object('result',prior.result,'attendance_id',prior.attendance_id);
 end if;
 -- Do not trust scanner clocks. Row lock serializes revocation against validation.
 select * into c from academy.student_cards where token_hash=digest for share;
 instant:=clock_timestamp(); day:=(sess.starts_at at time zone 'Asia/Colombo')::date;
 if sess.cancelled or instant not between sess.scan_opens_at and sess.scan_closes_at then result_code:='outside_window';
 elsif c.id is null or c.status<>'active' or instant>=c.expires_at or not exists(select from academy.students where id=c.student_id and active)
   or not academy.admission_consented(c.student_id) then result_code:='invalid_card';
 elsif not exists(select from academy.enrollments e where e.student_id=c.student_id and e.group_id=sess.group_id and day between e.starts_on and coalesce(e.ends_on,'infinity'::date)) then result_code:='not_enrolled';
 else
   result_code:=case when instant>sess.late_after then 'late' else 'present' end;
   insert into academy.attendance_records(student_id,session_id,group_id,status,source,marked_by)
   values(c.student_id,sess.id,sess.group_id,result_code::academy.attendance_status,'scan',auth.uid())
   on conflict(student_id,session_id) do nothing returning id into att;
   if not found then
     select id into strict att from academy.attendance_records where student_id=c.student_id and session_id=sess.id;
     result_code:='duplicate';
   end if;
 end if;
 insert into academy.scan_events(request_id,operator_id,device_id,session_id,card_id,token_digest,attendance_id,scan_at,result)
 values(p_request_id,auth.uid(),p_device_id,sess.id,c.id,digest,att,instant,result_code);
 update academy.attendance_devices set last_seen_at=instant where id=p_device_id;
 return jsonb_build_object('result',result_code,'attendance_id',att);
end $$;

create function academy_api.correct_attendance(p_session_id uuid,p_student_id uuid,p_status academy.attendance_status,p_reason text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare sess academy.class_sessions; previous academy.attendance_status; att uuid; day date;
begin
 perform academy.guard_write('attendance.correct',30);
 select * into strict sess from academy.class_sessions where id=p_session_id;
 if not academy.staff_group(sess.group_id) then raise insufficient_privilege; end if;
 if p_reason is null or length(trim(p_reason)) not between 3 and 400 then raise invalid_parameter_value; end if;
 day:=(sess.starts_at at time zone 'Asia/Colombo')::date;
 if sess.cancelled or clock_timestamp()<sess.scan_opens_at or not exists(select from academy.enrollments where student_id=p_student_id and group_id=sess.group_id and day between starts_on and coalesce(ends_on,'infinity'::date)) then raise invalid_parameter_value; end if;
 insert into academy.attendance_records(student_id,session_id,group_id,status,source,marked_by)
 values(p_student_id,sess.id,sess.group_id,p_status,'manual',auth.uid()) on conflict(student_id,session_id) do nothing returning id into att;
 if not found then
   select id,status into strict att,previous from academy.attendance_records where student_id=p_student_id and session_id=sess.id for update;
   update academy.attendance_records set status=p_status,source='manual',marked_at=clock_timestamp(),marked_by=auth.uid() where id=att;
 end if;
 insert into academy.attendance_adjustments(attendance_id,before_status,after_status,reason,actor_id) values(att,previous,p_status,trim(p_reason),auth.uid());
 perform academy.audit('correct','attendance_records',att); return jsonb_build_object('id',att);
end $$;
-- Defer schema USAGE until the complete API surface is installed.
revoke all on all functions in schema academy_api from public,anon,authenticated;
commit;
