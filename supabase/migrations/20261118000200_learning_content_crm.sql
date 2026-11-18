begin;
set local search_path = academy, pg_catalog;
-- Media paths are internal object names, never durable signed URLs or external URLs.
create table media_assets (
  id uuid primary key default gen_random_uuid(), bucket short_text not null, object_path text not null,
  mime_type short_text not null, byte_size bigint not null check(byte_size>=0),
  scan_status text not null default 'quarantined' check(scan_status in ('quarantined','clean','rejected')),
  uploaded_by uuid not null references profiles, created_at timestamptz not null default now(), unique(bucket,object_path),
  check(object_path ~ '^[A-Za-z0-9_-]+(/[A-Za-z0-9_-]+)*\.[a-z0-9]+$' and length(object_path)<=400)
);
create table library_resources (
  id uuid primary key default gen_random_uuid(), title short_text not null, grade_id uuid references grades,
  asset_id uuid not null unique references media_assets, published boolean not null default false, created_at timestamptz not null default now()
);
create table resource_access_rules (
  id uuid primary key default gen_random_uuid(), resource_id uuid not null references library_resources, group_id uuid not null references class_groups,
  unique(resource_id,group_id)
);
create table resource_entitlements (
  id uuid primary key default gen_random_uuid(), resource_id uuid not null references library_resources, student_id uuid not null references students,
  starts_at timestamptz not null default now(), expires_at timestamptz, revoked_at timestamptz,
  check(expires_at is null or expires_at>starts_at), unique(resource_id,student_id)
);
create table resource_views (id uuid primary key default gen_random_uuid(), resource_id uuid not null references library_resources, viewer_id uuid not null references profiles, viewed_at timestamptz not null default now());
-- An access grant records a download authorization, not proof of completed transfer.
create table resource_downloads (id uuid primary key default gen_random_uuid(), resource_id uuid not null references library_resources, viewer_id uuid not null references profiles, authorized_at timestamptz not null default now());
create table video_lessons (id uuid primary key default gen_random_uuid(), course_id uuid not null references courses, title short_text not null, resource_id uuid references library_resources);
create table live_sessions (id uuid primary key default gen_random_uuid(), session_id uuid not null unique references class_sessions, provider short_text not null, account_ref short_text not null, meeting_ref short_text not null, unique(provider,account_ref,meeting_ref));
create table lesson_recordings (id uuid primary key default gen_random_uuid(), live_session_id uuid not null references live_sessions, resource_id uuid not null references library_resources, created_at timestamptz not null default now());
create table assignments (id uuid primary key default gen_random_uuid(), group_id uuid not null references class_groups, title short_text not null, due_at timestamptz, author_id uuid not null references profiles);
create table submissions (id uuid primary key default gen_random_uuid(), assignment_id uuid not null references assignments, student_id uuid not null references students, asset_id uuid not null references media_assets, submitted_at timestamptz not null default now(), unique(assignment_id,student_id));
create table assessments (id uuid primary key default gen_random_uuid(), group_id uuid not null references class_groups, title short_text not null, max_score numeric not null check(max_score>0));
create table assessment_attempts (id uuid primary key default gen_random_uuid(), assessment_id uuid not null references assessments, student_id uuid not null references students, attempt integer not null check(attempt>0), score numeric check(score>=0), created_at timestamptz not null default now(), unique(assessment_id,student_id,attempt));

create type editorial_state as enum ('draft','review','published','archived');
create domain slug as text check(value ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(value)<=120);
create table pages (id uuid primary key default gen_random_uuid(), slug slug not null unique, title short_text not null, body text not null, seo_description short_text, status editorial_state not null default 'draft', author_id uuid not null references profiles, created_at timestamptz not null default now());
create table post_categories (id uuid primary key default gen_random_uuid(), slug slug unique not null, label short_text not null);
create table posts (id uuid primary key default gen_random_uuid(), slug slug not null unique, title short_text not null, body text not null check(length(body) between 1 and 12000), category_id uuid references post_categories, cover_id uuid references media_assets, seo_description short_text, status editorial_state not null default 'draft', author_id uuid not null references profiles, created_at timestamptz not null default now());
create table tags (id uuid primary key default gen_random_uuid(), label short_text not null unique);
create table post_tags (post_id uuid not null references posts, tag_id uuid not null references tags, primary key(post_id,tag_id));
create table content_revisions (
  id uuid primary key default gen_random_uuid(), post_id uuid references posts, page_id uuid references pages,
  title short_text not null, body text not null, author_id uuid not null references profiles, created_at timestamptz not null default now(),
  check(num_nonnulls(post_id,page_id)=1)
);
create table events (id uuid primary key default gen_random_uuid(), title short_text not null, starts_at timestamptz not null, ends_at timestamptz not null, status editorial_state not null default 'draft', check(ends_at>starts_at));
create table feedback (id uuid primary key default gen_random_uuid(), profile_id uuid references profiles, rating smallint check(rating between 1 and 5), feedback_text text not null, created_at timestamptz not null default now());
create table testimonials (id uuid primary key default gen_random_uuid(), feedback_id uuid not null unique references feedback, approved_excerpt text not null, release_evidence_ref short_text not null, status editorial_state not null default 'draft');

create table contacts (
  id uuid primary key default gen_random_uuid(), name short_text not null, phone phone_e164 not null,
  guardian_id uuid references guardians, created_at timestamptz not null default now()
);
create table lead_sources (id uuid primary key default gen_random_uuid(), label short_text not null unique);
create type lead_stage as enum ('new','contacted','review','converted','closed');
create table leads (id uuid primary key default gen_random_uuid(), contact_id uuid not null references contacts, student_id uuid references students, stage lead_stage not null default 'new', assigned_to uuid references profiles, consent_ref short_text not null, created_at timestamptz not null default now());
create index on leads(stage,created_at);
create table lead_activities (id uuid primary key default gen_random_uuid(), lead_id uuid not null references leads, actor_id uuid not null references profiles, kind short_text not null, note text check(length(note)<=400), follow_up_at timestamptz, created_at timestamptz not null default now());
create index on lead_activities(lead_id,created_at);
create table form_submissions (id uuid primary key default gen_random_uuid(), lead_id uuid not null references leads, form_version short_text not null, request_id uuid not null unique, created_at timestamptz not null default now());
create table lead_attributions (id uuid primary key default gen_random_uuid(), lead_id uuid not null references leads, source_id uuid not null references lead_sources, campaign_ref short_text, created_at timestamptz not null default now());
commit;
