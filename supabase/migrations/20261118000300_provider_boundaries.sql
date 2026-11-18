-- Inert design boundaries. No credentials, provider clients, jobs or live entitlements are seeded.
begin;
set local search_path = academy, pg_catalog;
create type job_state as enum ('pending','running','succeeded','retry','dead_letter','cancelled');
create table integration_connections (
  id uuid primary key default gen_random_uuid(), provider short_text not null, account_ref short_text not null,
  status text not null default 'disabled' check(status in ('disabled','sandbox','approved','revoked')),
  vault_ref short_text, scopes text[] not null default '{}', token_expires_at timestamptz, owner_id uuid references profiles,
  last_verified_at timestamptz, created_at timestamptz not null default now(), unique(provider,account_ref)
);
create table webhook_events (
  id uuid primary key default gen_random_uuid(), connection_id uuid not null references integration_connections, event_ref short_text not null,
  event_kind short_text not null, body_sha256 bytea not null check(octet_length(body_sha256)=32), verified_at timestamptz not null,
  received_at timestamptz not null default now(), unique(connection_id,event_ref), unique(id,connection_id)
);
create table integration_sync_jobs (
  id uuid primary key default gen_random_uuid(), connection_id uuid not null references integration_connections, webhook_id uuid references webhook_events,
  operation short_text not null, dedupe_key short_text not null, status job_state not null default 'pending', attempts integer not null default 0 check(attempts>=0),
  next_run_at timestamptz not null default now(), last_error_code short_text, unique(connection_id,dedupe_key), foreign key(webhook_id,connection_id) references webhook_events(id,connection_id)
);
create index on integration_sync_jobs(status,next_run_at);
create table social_accounts (id uuid primary key default gen_random_uuid(), connection_id uuid not null references integration_connections, external_id short_text not null, unique(connection_id,external_id));
create table social_posts (id uuid primary key default gen_random_uuid(), post_id uuid not null references posts, approved_by uuid references profiles, scheduled_at timestamptz, created_at timestamptz not null default now());
create table social_post_targets (id uuid primary key default gen_random_uuid(), social_post_id uuid not null references social_posts, account_id uuid not null references social_accounts, provider_post_id short_text, status job_state not null default 'pending', unique(social_post_id,account_id), unique(account_id,provider_post_id));
create table social_sync_events (id uuid primary key default gen_random_uuid(), target_id uuid not null references social_post_targets, job_id uuid not null references integration_sync_jobs, result_code short_text not null, created_at timestamptz not null default now());
create table ad_accounts (id uuid primary key default gen_random_uuid(), connection_id uuid not null references integration_connections, external_id short_text not null, unique(connection_id,external_id));
create table ad_campaigns (id uuid primary key default gen_random_uuid(), ad_account_id uuid not null references ad_accounts, external_id short_text not null, approval_by uuid references profiles, budget_minor bigint check(budget_minor>=0), currency char(3) not null, unique(ad_account_id,external_id));
create table ad_metrics (id uuid primary key default gen_random_uuid(), campaign_id uuid not null references ad_campaigns, day date not null, impressions bigint not null check(impressions>=0), spend_minor bigint not null check(spend_minor>=0), unique(campaign_id,day));

create table communication_preferences (id uuid primary key default gen_random_uuid(), guardian_id uuid not null references guardians, channel channel not null, purpose short_text not null, opted_in boolean not null default false, evidence_ref short_text not null, updated_at timestamptz not null default now(), unique(guardian_id,channel,purpose));
create table message_templates (id uuid primary key default gen_random_uuid(), connection_id uuid not null references integration_connections, channel channel not null, provider_template_ref short_text not null, language short_text not null, approved boolean not null default false, unique(connection_id,provider_template_ref,language));
create table outbound_messages (id uuid primary key default gen_random_uuid(), preference_id uuid not null references communication_preferences, template_id uuid not null references message_templates, status job_state not null default 'pending', idempotency_key uuid not null unique, created_at timestamptz not null default now());
create table message_deliveries (id uuid primary key default gen_random_uuid(), message_id uuid not null references outbound_messages, connection_id uuid not null references integration_connections, external_id short_text not null, status short_text not null, error_code short_text, updated_at timestamptz not null default now(), unique(connection_id,external_id));
create table attendance_notification_jobs (id uuid primary key default gen_random_uuid(), attendance_id uuid not null references attendance_records, recipient_id uuid not null references guardians, channel channel not null, message_id uuid references outbound_messages, status job_state not null default 'pending', sent_at timestamptz, student_id uuid not null, unique(attendance_id,recipient_id,channel),
  foreign key(attendance_id,student_id) references attendance_records(id,student_id), foreign key(student_id,recipient_id) references student_guardians(student_id,guardian_id));
create table notifications (id uuid primary key default gen_random_uuid(), recipient_id uuid not null references profiles, title short_text not null, read_at timestamptz, created_at timestamptz not null default now());
create index on notifications(recipient_id,created_at);
create table chatbot_configs (id uuid primary key default gen_random_uuid(), model short_text not null, enabled boolean not null default false, budget_minor bigint not null check(budget_minor>=0), created_at timestamptz not null default now());
create table knowledge_documents (id uuid primary key default gen_random_uuid(), config_id uuid not null references chatbot_configs, source_ref short_text not null, version short_text not null, approved_by uuid references profiles, unique(config_id,source_ref,version));
create table conversations (id uuid primary key default gen_random_uuid(), config_id uuid references chatbot_configs, profile_id uuid references profiles, channel channel not null, expires_at timestamptz not null, created_at timestamptz not null default now());
create table messages (id uuid primary key default gen_random_uuid(), conversation_id uuid not null references conversations, direction text not null check(direction in ('inbound','outbound')), protected_body_ref short_text, created_at timestamptz not null default now());
create table handoff_requests (id uuid primary key default gen_random_uuid(), conversation_id uuid not null references conversations, reason_code short_text not null, assigned_to uuid references profiles, resolved_at timestamptz, created_at timestamptz not null default now());

-- Integer minor units. No PAN, CVV, browser settlement flag or raw callback payload.
create domain money_minor as bigint check(value>=0);
create domain currency_code as text check(value ~ '^[A-Z]{3}$');
create type payment_state as enum ('draft','pending','paid','failed','expired','refunded');
create table products (id uuid primary key default gen_random_uuid(), label short_text not null, group_id uuid references class_groups, resource_id uuid references library_resources, active boolean not null default false);
create table prices (id uuid primary key default gen_random_uuid(), product_id uuid not null references products, unit_amount money_minor not null, currency currency_code not null, valid_from timestamptz not null);
create table orders (id uuid primary key default gen_random_uuid(), guardian_id uuid not null references guardians, student_id uuid not null references students, currency currency_code not null, status payment_state not null default 'draft', created_at timestamptz not null default now(), foreign key(student_id,guardian_id) references student_guardians);
create table order_items (id uuid primary key default gen_random_uuid(), order_id uuid not null references orders, price_id uuid not null references prices, unit_amount money_minor not null, quantity integer not null check(quantity>0));
create table invoices (id uuid primary key default gen_random_uuid(), order_id uuid not null references orders, invoice_number short_text not null unique, total_minor money_minor not null, issued_at timestamptz not null default now());
create table payments (id uuid primary key default gen_random_uuid(), order_id uuid not null references orders, connection_id uuid not null references integration_connections, external_id short_text not null, amount_minor money_minor not null, currency currency_code not null, status payment_state not null default 'pending', created_at timestamptz not null default now(), unique(connection_id,external_id), unique(id,connection_id));
create table payment_webhook_events (id uuid primary key default gen_random_uuid(), webhook_id uuid not null unique references webhook_events, payment_id uuid not null references payments, observed_status payment_state not null, created_at timestamptz not null default now(), connection_id uuid not null, foreign key(webhook_id,connection_id) references webhook_events(id,connection_id), foreign key(payment_id,connection_id) references payments(id,connection_id));
create table refunds (id uuid primary key default gen_random_uuid(), payment_id uuid not null references payments, connection_id uuid not null references integration_connections, external_id short_text not null, amount_minor money_minor not null, requested_at timestamptz not null default now(), unique(connection_id,external_id), foreign key(payment_id,connection_id) references payments(id,connection_id));
create table settlements (id uuid primary key default gen_random_uuid(), connection_id uuid not null references integration_connections, external_id short_text not null, amount_minor money_minor not null, currency currency_code not null, settled_at timestamptz not null, unique(connection_id,external_id), unique(id,connection_id));
create table payment_reconciliations (id uuid primary key default gen_random_uuid(), payment_id uuid not null references payments, settlement_id uuid not null references settlements, difference_minor bigint not null, reviewed_by uuid references profiles, created_at timestamptz not null default now(), unique(payment_id,settlement_id), connection_id uuid not null, foreign key(payment_id,connection_id) references payments(id,connection_id), foreign key(settlement_id,connection_id) references settlements(id,connection_id));
create table expenses (id uuid primary key default gen_random_uuid(), category short_text not null, amount_minor money_minor not null, currency currency_code not null, incurred_on date not null, recorded_by uuid not null references profiles);
create table analytics_events (id uuid primary key default gen_random_uuid(), event_name short_text not null, day date not null, source short_text not null, aggregate_count integer not null check(aggregate_count>=0), unique(event_name,day,source));
commit;
