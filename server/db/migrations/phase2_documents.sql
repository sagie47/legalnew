-- Phase 2 foundation: user documents + document chunks
-- Safe to run multiple times.

create table if not exists documents (
  id uuid primary key,
  user_id uuid not null references users(id) on delete cascade,
  session_id uuid not null references sessions(id) on delete cascade,
  title text not null,
  mime_type text,
  source_url text,
  status text not null default 'ready',
  extracted_text text,
  extracted_json jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_documents_session_updated
  on documents(session_id, updated_at desc);

create index if not exists idx_documents_user_updated
  on documents(user_id, updated_at desc);

create table if not exists document_chunks (
  id uuid primary key,
  document_id uuid not null references documents(id) on delete cascade,
  chunk_index integer not null,
  text text not null,
  metadata jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_document_chunks_doc_idx
  on document_chunks(document_id, chunk_index);
