-- Ask ResNeo: conversation log for the in-dashboard help assistant
-- (Docs/help-assistant-plan.md, 4.1). Service role only: RLS enabled with no policies, the
-- posture support_sessions uses. Rows carry the question, the answer, the articles it cited,
-- token usage and a thumbs rating; the context column holds plan, flags, role and counts,
-- never personal data. Pruned by /api/cron/assistant-retention after ASSISTANT_RETENTION_DAYS.

create table assistant_conversations (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references venues (id) on delete cascade,
  staff_id uuid references staff (id) on delete set null,
  client text not null check (client in ('web', 'app')),
  model text not null,
  corpus_version text not null,
  context jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index idx_assistant_conversations_venue_created
  on assistant_conversations (venue_id, created_at desc);

create table assistant_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references assistant_conversations (id) on delete cascade,
  reply_to uuid references assistant_messages (id) on delete set null,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  cited_article_ids text[] not null default '{}',
  answered boolean,
  input_tokens integer,
  cached_input_tokens integer,
  output_tokens integer,
  latency_ms integer,
  rating smallint check (rating in (-1, 1)),
  rating_comment text,
  created_at timestamptz not null default now()
);

create index idx_assistant_messages_conversation
  on assistant_messages (conversation_id, created_at);

create index idx_assistant_messages_review
  on assistant_messages (created_at desc)
  where role = 'assistant' and (answered = false or rating = -1);

alter table assistant_conversations enable row level security;
alter table assistant_messages enable row level security;
