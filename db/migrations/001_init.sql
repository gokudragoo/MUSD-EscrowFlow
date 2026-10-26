-- MUSD EscrowFlow — application database (Neon Postgres). Everything lives in schema `escrowflow`.
-- Idempotent: safe to run repeatedly. The chain is the source of truth for money; these tables hold
-- application records (profiles, drafts, submissions, comments) and a cache of verified on-chain events.

CREATE SCHEMA IF NOT EXISTS escrowflow;

CREATE TABLE IF NOT EXISTS escrowflow.users (
  address        text PRIMARY KEY CHECK (address ~ '^0x[0-9a-f]{40}$'),
  created_at     timestamptz NOT NULL DEFAULT now(),
  last_login_at  timestamptz
);

CREATE TABLE IF NOT EXISTS escrowflow.siwe_nonces (
  nonce       text PRIMARY KEY,
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL,
  used_at     timestamptz
);
CREATE INDEX IF NOT EXISTS siwe_nonces_expires_idx ON escrowflow.siwe_nonces (expires_at);

CREATE TABLE IF NOT EXISTS escrowflow.profiles (
  address          text PRIMARY KEY REFERENCES escrowflow.users(address),
  display_name     text NOT NULL,
  role             text NOT NULL DEFAULT 'freelancer' CHECK (role IN ('client','freelancer','both')),
  headline         text NOT NULL DEFAULT '',
  bio              text NOT NULL DEFAULT '',
  skills           text[] NOT NULL DEFAULT '{}',
  portfolio_links  jsonb NOT NULL DEFAULT '[]'::jsonb,
  social_links     jsonb NOT NULL DEFAULT '[]'::jsonb,
  available        boolean NOT NULL DEFAULT true,
  avatar_mime      text,
  avatar_data      bytea,
  notification_prefs jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS profiles_role_idx ON escrowflow.profiles (role);

-- Off-chain project record: the agreement draft / marketplace listing. Linked to an on-chain
-- EscrowFlow project id once the createProject tx is verified.
CREATE TABLE IF NOT EXISTS escrowflow.projects (
  id                 uuid PRIMARY KEY,
  client_address     text NOT NULL REFERENCES escrowflow.users(address),
  freelancer_address text,
  title              text NOT NULL,
  summary            text NOT NULL DEFAULT '',
  category           text NOT NULL,
  skills             text[] NOT NULL DEFAULT '{}',
  budget_wei         numeric(78,0) NOT NULL CHECK (budget_wei > 0),
  milestone_count    int NOT NULL CHECK (milestone_count BETWEEN 1 AND 20),
  final_deadline     timestamptz NOT NULL,
  hiring_mode        text NOT NULL CHECK (hiring_mode IN ('direct','open')),
  listing_status     text NOT NULL DEFAULT 'draft' CHECK (listing_status IN ('draft','open','closed')),
  terms              jsonb NOT NULL,
  terms_hash         text NOT NULL,
  chain_project_id   bigint UNIQUE,
  create_tx_hash     text UNIQUE,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS projects_client_idx ON escrowflow.projects (client_address);
CREATE INDEX IF NOT EXISTS projects_freelancer_idx ON escrowflow.projects (freelancer_address);
CREATE INDEX IF NOT EXISTS projects_listing_idx ON escrowflow.projects (listing_status, created_at DESC);

-- Every saved version of the terms document (history is append-only, never rewritten).
CREATE TABLE IF NOT EXISTS escrowflow.terms_revisions (
  id           bigserial PRIMARY KEY,
  project_id   uuid NOT NULL REFERENCES escrowflow.projects(id),
  revision     int NOT NULL,
  terms        jsonb NOT NULL,
  terms_hash   text NOT NULL,
  author       text NOT NULL,
  note         text NOT NULL DEFAULT '',
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, revision)
);
CREATE INDEX IF NOT EXISTS terms_revisions_hash_idx ON escrowflow.terms_revisions (terms_hash);

CREATE TABLE IF NOT EXISTS escrowflow.applications (
  id                 uuid PRIMARY KEY,
  project_id         uuid NOT NULL REFERENCES escrowflow.projects(id),
  freelancer_address text NOT NULL,
  introduction       text NOT NULL,
  skills             text[] NOT NULL DEFAULT '{}',
  portfolio_links    jsonb NOT NULL DEFAULT '[]'::jsonb,
  proposed_timeline  text NOT NULL DEFAULT '',
  proposal           text NOT NULL DEFAULT '',
  status             text NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted','selected','declined','withdrawn')),
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, freelancer_address)
);

-- Work submissions (application records). submission_hash is committed on-chain by submitMilestone.
CREATE TABLE IF NOT EXISTS escrowflow.submissions (
  id                 uuid PRIMARY KEY,
  project_id         uuid NOT NULL REFERENCES escrowflow.projects(id),
  milestone_index    int NOT NULL CHECK (milestone_index BETWEEN 0 AND 19),
  freelancer_address text NOT NULL,
  record             jsonb NOT NULL,
  submission_hash    text NOT NULL UNIQUE,
  tx_hash            text UNIQUE,
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS submissions_project_idx ON escrowflow.submissions (project_id, milestone_index, created_at DESC);

CREATE TABLE IF NOT EXISTS escrowflow.attachments (
  id           uuid PRIMARY KEY,
  project_id   uuid NOT NULL REFERENCES escrowflow.projects(id),
  parent_kind  text NOT NULL CHECK (parent_kind IN ('submission','evidence')),
  parent_id    uuid,
  filename     text NOT NULL,
  mime         text NOT NULL CHECK (mime IN ('image/png','image/jpeg','image/webp','application/pdf')),
  size_bytes   int NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 2097152),
  sha256       text NOT NULL,
  data         bytea NOT NULL,
  uploaded_by  text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS attachments_parent_idx ON escrowflow.attachments (parent_kind, parent_id);

-- Review comments, change-request reasons, dispute reasons and evidence (application records).
CREATE TABLE IF NOT EXISTS escrowflow.comments (
  id               uuid PRIMARY KEY,
  project_id       uuid NOT NULL REFERENCES escrowflow.projects(id),
  milestone_index  int,
  author           text NOT NULL,
  kind             text NOT NULL CHECK (kind IN ('comment','change_request','dispute','evidence')),
  body             text NOT NULL,
  links            jsonb NOT NULL DEFAULT '[]'::jsonb,
  note_hash        text,
  record           jsonb,
  tx_hash          text,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS comments_project_idx ON escrowflow.comments (project_id, created_at);

-- Cache of verified EscrowFlow events (on-chain facts). Re-derivable from the chain at any time.
CREATE TABLE IF NOT EXISTS escrowflow.chain_events (
  id                bigserial PRIMARY KEY,
  chain_id          int NOT NULL,
  contract_address  text NOT NULL,
  block_number      bigint NOT NULL,
  block_time        timestamptz,
  tx_hash           text NOT NULL,
  log_index         int NOT NULL,
  event_name        text NOT NULL,
  chain_project_id  bigint NOT NULL,
  milestone_index   int,
  args              jsonb NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tx_hash, log_index)
);
CREATE INDEX IF NOT EXISTS chain_events_project_idx ON escrowflow.chain_events (chain_project_id, block_number, log_index);
CREATE INDEX IF NOT EXISTS chain_events_name_idx ON escrowflow.chain_events (event_name);

CREATE TABLE IF NOT EXISTS escrowflow.sync_state (
  key         text PRIMARY KEY,
  last_block  bigint NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS escrowflow.notifications (
  id                uuid PRIMARY KEY,
  recipient         text NOT NULL,
  kind              text NOT NULL,
  title             text NOT NULL,
  body              text NOT NULL DEFAULT '',
  href              text,
  source            text NOT NULL CHECK (source IN ('chain','app','reminder')),
  tx_hash           text,
  dedupe_key        text NOT NULL UNIQUE,
  read_at           timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS notifications_recipient_idx ON escrowflow.notifications (recipient, created_at DESC);

-- Application-record audit trail (who did what in the app). Distinct from chain_events.
CREATE TABLE IF NOT EXISTS escrowflow.audit_events (
  id          bigserial PRIMARY KEY,
  project_id  uuid REFERENCES escrowflow.projects(id),
  actor       text NOT NULL,
  action      text NOT NULL,
  detail      jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS audit_events_project_idx ON escrowflow.audit_events (project_id, created_at);

-- Client feedback after a completed project (off-chain, one per reviewer per project).
CREATE TABLE IF NOT EXISTS escrowflow.reviews (
  id                uuid PRIMARY KEY,
  project_id        uuid NOT NULL REFERENCES escrowflow.projects(id),
  reviewer          text NOT NULL,
  subject           text NOT NULL,
  rating            int NOT NULL CHECK (rating BETWEEN 1 AND 5),
  body              text NOT NULL DEFAULT '',
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, reviewer)
);
CREATE INDEX IF NOT EXISTS reviews_subject_idx ON escrowflow.reviews (subject);
