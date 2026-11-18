-- Single academy. Refuse schema collisions; do not reuse another application's objects.
begin;
create schema academy;
create schema academy_api;
revoke all on schema academy, academy_api from public, anon, authenticated;
set local search_path = academy, pg_catalog;

create domain short_text as text check (length(value) between 1 and 180 and value ~ '[^[:space:]]' and value !~ '[[:cntrl:]]');
create domain phone_e164 as text check (value ~ '^\+[1-9][0-9]{7,14}$');
create type attendance_status as enum ('present','late','absent','excused');
create type channel as enum ('in_app','email','sms','whatsapp');
create table profiles (
  id uuid primary key references auth.users on delete restrict,
  display_name short_text, locale text not null default 'si' check (locale in ('si','en','ta')),
  created_at timestamptz not null default now()
);
create table roles (id uuid primary key default gen_random_uuid(), code short_text not null unique);
create table permissions (id uuid primary key default gen_random_uuid(), code short_text not null unique);
create table user_roles (
  user_id uuid not null references profiles, role_id uuid not null references roles,
  granted_at timestamptz not null default now(), primary key (user_id, role_id)
);
create table role_permissions (
  role_id uuid not null references roles, permission_id uuid not null references permissions,
  primary key (role_id, permission_id)
);
insert into roles(code) values ('super_admin'),('admin'),('teacher'),('marketing'),('student'),('guardian'),('admissions_officer'),('card_issuer'),('attendance_operator');
insert into permissions(code) values ('admit'),('card.issue'),('attendance.scan'),('attendance.correct'),('attendance.report'),('attendance.export'),('academic.all'),('academic.teach'),('schedule.manage'),('device.manage'),('crm.manage'),('content.manage'),('library.manage'),('import.review'),('audit.read');
insert into role_permissions
select r.id,p.id from roles r cross join permissions p where
  r.code = 'super_admin' or (r.code = 'admin' and p.code <> 'import.review') or
  (r.code = 'teacher' and p.code in ('academic.teach','attendance.scan','attendance.correct','attendance.report')) or
  (r.code = 'marketing' and p.code in ('content.manage','crm.manage')) or
  (r.code = 'admissions_officer' and p.code = 'admit') or
  (r.code = 'card_issuer' and p.code = 'card.issue') or
  (r.code = 'attendance_operator' and p.code = 'attendance.scan');

create table audit_logs (
  id uuid primary key default gen_random_uuid(), actor_id uuid references profiles,
  action short_text not null, entity short_text not null, entity_id uuid not null, related_id uuid,
  created_at timestamptz not null default now()
);
create index on audit_logs(entity,entity_id,created_at);
create table system_settings (id uuid primary key default gen_random_uuid(), key short_text unique not null, value jsonb not null, updated_at timestamptz not null default now());
create table write_quotas (
  user_id uuid not null references profiles, operation text not null, minute timestamptz not null, hits integer not null check (hits > 0),
  primary key (user_id,operation)
);

create table grades (id uuid primary key default gen_random_uuid(), level smallint not null unique check (level between 6 and 11));
insert into grades(level) select generate_series(6,11);
create table courses (id uuid primary key default gen_random_uuid(), grade_id uuid not null references grades, title short_text not null, created_at timestamptz not null default now(), unique(grade_id,title));
create table class_groups (
  id uuid primary key default gen_random_uuid(), course_id uuid not null references courses,
  label short_text not null, teacher_id uuid references profiles, active boolean not null default true,
  created_at timestamptz not null default now(), unique(course_id,label)
);
create index on class_groups(teacher_id);
create table class_sessions (
  id uuid primary key default gen_random_uuid(), group_id uuid not null references class_groups,
  starts_at timestamptz not null, ends_at timestamptz not null, scan_opens_at timestamptz not null, scan_closes_at timestamptz not null,
  late_after timestamptz not null, cancelled boolean not null default false,
  check (scan_opens_at <= starts_at and starts_at <= late_after and late_after <= ends_at and starts_at < ends_at and late_after <= scan_closes_at),
  check (isfinite(scan_opens_at) and isfinite(scan_closes_at) and isfinite(ends_at) and scan_closes_at-scan_opens_at<=interval '24 hours'),
  unique(id,group_id), unique(group_id, starts_at)
);
create sequence student_codes;
create table students (
  id uuid primary key default gen_random_uuid(), student_code text unique not null default ('S-' || nextval('student_codes')::text),
  name short_text not null, birth_date date not null, grade_id uuid not null references grades,
  profile_id uuid unique references profiles, active boolean not null default true,
  duplicate_fingerprint bytea not null unique, created_at timestamptz not null default now()
);
create table guardians (
  id uuid primary key default gen_random_uuid(), name short_text not null, phone phone_e164 not null,
  profile_id uuid unique references profiles, verified_at timestamptz,
  check (verified_at is null or profile_id is not null), created_at timestamptz not null default now()
);
create table student_guardians (
  student_id uuid not null references students, guardian_id uuid not null references guardians,
  relationship short_text not null, access_verified_at timestamptz,
  primary key(student_id,guardian_id)
);
create index on student_guardians(guardian_id,student_id);
create table enrollments (
  id uuid primary key default gen_random_uuid(), student_id uuid not null references students, group_id uuid not null references class_groups,
  starts_on date not null default ((now() at time zone 'Asia/Colombo')::date), ends_on date,
  check (ends_on is null or starts_on <= ends_on), unique(student_id,group_id), unique(id,student_id), created_at timestamptz not null default now()
);
create index on enrollments(group_id,student_id);
create table registrations (
  id uuid primary key default gen_random_uuid(), request_id uuid unique not null, student_id uuid unique not null references students,
  enrollment_id uuid unique not null references enrollments, admitted_by uuid not null references profiles, created_at timestamptz not null default now(),
  foreign key(enrollment_id,student_id) references enrollments(id,student_id)
);
create table consent_records (
  id uuid primary key default gen_random_uuid(), student_id uuid not null, guardian_id uuid not null,
  purpose text not null check(purpose in ('admission','attendance_notice','recording','marketing')),
  granted boolean not null, notice_version short_text not null, evidence_ref short_text not null, actor_id uuid not null references profiles,
  created_at timestamptz not null default clock_timestamp(), foreign key(student_id,guardian_id) references student_guardians
);
create index on consent_records(student_id,guardian_id,purpose,created_at desc);

create table card_templates (
  id uuid primary key default gen_random_uuid(), name short_text not null, version integer not null check(version>0),
  width_mm numeric not null check(width_mm>0), height_mm numeric not null check(height_mm>0), branding_config jsonb not null default '{}',
  active boolean not null default false, unique(name,version)
);
create table student_cards (
  id uuid primary key default gen_random_uuid(), student_id uuid not null references students, token_hash bytea not null unique check(octet_length(token_hash)=32),
  status text not null check(status in ('draft','issued','active','suspended','lost','revoked','expired')),
  issued_at timestamptz not null default now(), expires_at timestamptz not null, revoked_at timestamptz, issued_by uuid not null references profiles,
  check(expires_at>issued_at), check((status='revoked') = (revoked_at is not null))
);
create unique index one_live_card on student_cards(student_id) where status in ('issued','active','suspended','lost');
create index on student_cards(student_id,status);
create table card_print_jobs (
  id uuid primary key default gen_random_uuid(), card_id uuid not null references student_cards, template_id uuid references card_templates,
  requested_by uuid not null references profiles, status text not null default 'requested' check(status in ('requested','printed','cancelled')),
  requested_at timestamptz not null default now(), printed_at timestamptz
);
create table attendance_devices (
  id uuid primary key default gen_random_uuid(), label short_text not null, assigned_location short_text not null,
  operator_id uuid not null references profiles, group_id uuid not null references class_groups,
  active boolean not null default false, last_seen_at timestamptz, created_at timestamptz not null default now(), unique(group_id,label)
);
create table attendance_records (
  id uuid primary key default gen_random_uuid(), student_id uuid not null, session_id uuid not null, group_id uuid not null,
  status attendance_status not null, source text not null check(source in ('scan','manual')),
  marked_at timestamptz not null default now(), marked_by uuid not null references profiles,
  unique(student_id,session_id), unique(id,student_id), foreign key(student_id,group_id) references enrollments(student_id,group_id),
  foreign key(session_id,group_id) references class_sessions(id,group_id)
);
create index on attendance_records(session_id,status);
create table scan_events (
  id uuid primary key default gen_random_uuid(), request_id uuid not null unique, operator_id uuid not null references profiles,
  device_id uuid not null references attendance_devices, session_id uuid not null references class_sessions, card_id uuid references student_cards,
  token_digest bytea not null, attendance_id uuid references attendance_records, scan_at timestamptz not null default clock_timestamp(),
  result text not null check(result in ('present','late','duplicate','invalid_card','outside_window','not_enrolled'))
);
create index on scan_events(session_id,scan_at);
create table attendance_adjustments (
  id uuid primary key default gen_random_uuid(), attendance_id uuid not null references attendance_records, before_status attendance_status,
  after_status attendance_status not null, reason text not null check(length(trim(reason)) between 3 and 400),
  actor_id uuid not null references profiles, created_at timestamptz not null default now()
);
create table student_import_batches (
  id uuid primary key default gen_random_uuid(), source_vendor short_text not null, imported_by uuid not null references profiles,
  file_hash bytea not null check(octet_length(file_hash)=32), status text not null check(status in ('staged','validated','rejected','approved','applied')),
  created_at timestamptz not null default now(), unique(source_vendor,file_hash), unique(id,source_vendor)
);
create table student_import_rows (
  id uuid primary key default gen_random_uuid(), batch_id uuid not null references student_import_batches, external_id short_text not null,
  mapped_student_id uuid references students, validation_status text not null check(validation_status in ('pending','valid','review','rejected')),
  error_code short_text, unique(batch_id,external_id), unique(id,batch_id,external_id,mapped_student_id)
);
create index on student_import_rows(batch_id,validation_status);
create table student_crosswalk (
  id uuid primary key default gen_random_uuid(), source_vendor short_text not null, external_id short_text not null,
  student_id uuid not null references students, import_row_id uuid not null unique references student_import_rows,
  batch_id uuid not null, unique(source_vendor,external_id),
  foreign key(batch_id,source_vendor) references student_import_batches(id,source_vendor),
  foreign key(import_row_id,batch_id,external_id,student_id) references student_import_rows(id,batch_id,external_id,mapped_student_id)
);
commit;
