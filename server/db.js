import pg from 'pg';
import { randomUUID } from 'node:crypto';
import dotenv from 'dotenv';

dotenv.config({ override: true });

const { Pool } = pg;

const connectionString = process.env.DATABASE_URL;
const isDbConfigured = Boolean(connectionString);

const pool = isDbConfigured
  ? new Pool({
      connectionString,
      ssl: process.env.PGSSLMODE === 'disable' ? false : { rejectUnauthorized: false },
    })
  : null;

export function dbEnabled() {
  return Boolean(pool);
}

export async function ensureUser({ externalAuthId, email = null }) {
  if (!pool) return null;
  const result = await pool.query(
    `insert into users (id, external_auth_id, email, created_at)
     values ($1, $2, $3, now())
     on conflict (external_auth_id)
     do update set email = coalesce(excluded.email, users.email)
     returning id`,
    [randomUUID(), externalAuthId, email]
  );
  return result.rows[0]?.id || null;
}

export async function ensureSession({ sessionId, userId, title }) {
  if (!pool) return null;

  const result = await pool.query(
    `insert into sessions (id, user_id, title, created_at, updated_at)
     values ($1, $2, $3, now(), now())
     on conflict (id) do update
       set updated_at = now(),
           title = case
             when sessions.title is null or sessions.title = '' then excluded.title
             else sessions.title
           end
     where sessions.user_id = excluded.user_id
     returning id, title, created_at, updated_at`,
    [sessionId, userId, title]
  );

  return result.rows[0] || null;
}

export async function appendMessage({ sessionId, userId, role, content, citations = null }) {
  if (!pool) return null;

  const ownership = await pool.query(
    `select 1
     from sessions
     where id = $1 and user_id = $2`,
    [sessionId, userId]
  );
  if (!ownership.rowCount) {
    throw new Error('Session not found for user.');
  }

  const result = await pool.query(
    `insert into messages (id, session_id, role, content, citations, created_at)
     values ($1, $2, $3, $4, $5::jsonb, now())
     returning id, session_id, role, content, citations, created_at`,
    [randomUUID(), sessionId, role, content, citations ? JSON.stringify(citations) : null]
  );

  await pool.query(
    `update sessions
     set updated_at = now()
     where id = $1 and user_id = $2`,
    [sessionId, userId]
  );

  return result.rows[0] || null;
}

export async function getRecentMessages({ sessionId, userId, limit = 10 }) {
  if (!pool) return [];

  const result = await pool.query(
    `select role, content, citations, created_at
     from (
       select m.role, m.content, m.citations, m.created_at
       from messages m
       join sessions s on s.id = m.session_id
       where m.session_id = $1 and s.user_id = $2
       order by m.created_at desc
       limit $3
     ) recent
     order by created_at asc`,
    [sessionId, userId, limit]
  );

  return result.rows;
}

export async function listHistory({ userId, sessionLimit = 40 }) {
  if (!pool) return [];

  const sessionsResult = await pool.query(
    `select id, title, created_at, updated_at
     from sessions
     where user_id = $1
     order by updated_at desc
     limit $2`,
    [userId, sessionLimit]
  );

  const sessions = sessionsResult.rows;
  if (sessions.length === 0) {
    return [];
  }

  const sessionIds = sessions.map((s) => s.id);
  const messagesResult = await pool.query(
    `select id, session_id, role, content, citations, created_at
     from messages
     where session_id = any($1::uuid[])
     order by created_at asc`,
    [sessionIds]
  );

  const bySession = new Map();
  for (const msg of messagesResult.rows) {
    const list = bySession.get(msg.session_id) || [];
    list.push(msg);
    bySession.set(msg.session_id, list);
  }

  return sessions.map((session) => ({
    ...session,
    messages: bySession.get(session.id) || [],
  }));
}

export async function createDocument({
  userId,
  sessionId,
  title,
  mimeType = 'text/plain',
  sourceUrl = null,
  extractedText = '',
  extractedJson = null,
  status = 'ready',
}) {
  if (!pool) return null;

  const ownership = await pool.query(
    `select 1
     from sessions
     where id = $1 and user_id = $2`,
    [sessionId, userId]
  );
  if (!ownership.rowCount) {
    throw new Error('Session not found for user.');
  }

  const result = await pool.query(
    `insert into documents (
       id, user_id, session_id, title, mime_type, source_url, status, extracted_text, extracted_json, created_at, updated_at
     )
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, now(), now())
     returning id, user_id, session_id, title, mime_type, source_url, status, created_at, updated_at`,
    [
      randomUUID(),
      userId,
      sessionId,
      title,
      mimeType,
      sourceUrl,
      status,
      extractedText,
      extractedJson ? JSON.stringify(extractedJson) : null,
    ]
  );

  return result.rows[0] || null;
}

export async function replaceDocumentChunks({ documentId, chunks = [] }) {
  if (!pool) return 0;

  await pool.query(
    `delete from document_chunks
     where document_id = $1`,
    [documentId]
  );

  let inserted = 0;
  for (const chunk of chunks) {
    await pool.query(
      `insert into document_chunks (id, document_id, chunk_index, text, metadata, created_at)
       values ($1, $2, $3, $4, $5::jsonb, now())`,
      [
        randomUUID(),
        documentId,
        Number(chunk?.chunk_index || 0),
        chunk?.text || '',
        chunk?.metadata ? JSON.stringify(chunk.metadata) : null,
      ]
    );
    inserted += 1;
  }

  await pool.query(
    `update documents
     set updated_at = now()
     where id = $1`,
    [documentId]
  );

  return inserted;
}

export async function listSessionDocuments({ sessionId, userId, limit = 40 }) {
  if (!pool) return [];

  const result = await pool.query(
    `select d.id, d.session_id, d.title, d.mime_type, d.source_url, d.status, d.created_at, d.updated_at
     from documents d
     join sessions s on s.id = d.session_id
     where d.session_id = $1 and s.user_id = $2
     order by d.updated_at desc
     limit $3`,
    [sessionId, userId, limit]
  );
  return result.rows;
}

export async function listSessionDocumentChunks({ sessionId, userId, limit = 80 }) {
  if (!pool) return [];

  const result = await pool.query(
    `select
       dc.id as chunk_id,
       dc.chunk_index,
       dc.text,
       dc.metadata,
       d.id as document_id,
       d.title,
       d.source_url,
       d.mime_type,
       d.updated_at as document_updated_at
     from document_chunks dc
     join documents d on d.id = dc.document_id
     join sessions s on s.id = d.session_id
     where d.session_id = $1
       and s.user_id = $2
       and d.status = 'ready'
     order by d.updated_at desc, dc.chunk_index asc
     limit $3`,
    [sessionId, userId, limit]
  );

  return result.rows;
}
