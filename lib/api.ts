import { MOCK_CASES } from '../data/mockCases';
import { ChatSession, CitationReference, Message } from './types';
import { getAuthIdentity, isAuthBypassEnabled } from './neonAuth';

type UploadTextDocumentParams = {
  text: string;
  title?: string;
  sessionId?: string;
  sourceUrl?: string;
  extractedJson?: Record<string, unknown> | null;
};

type UploadedDocument = {
  id: string;
  title: string;
  sourceUrl?: string | null;
  status: string;
};

type UploadTextDocumentResponse = {
  status: 'ok' | 'error';
  sessionId: string | null;
  chunkCount: number;
  document: UploadedDocument | null;
  error?: string;
};

export type SessionDocumentSummary = {
  id: string;
  sessionId: string;
  title: string;
  mimeType?: string;
  sourceUrl?: string;
  status: string;
  createdAt?: string;
  updatedAt?: string;
};

async function authHeaders({ includeContentType = false }: { includeContentType?: boolean } = {}) {
  const identity = await getAuthIdentity();
  if (!identity?.externalAuthId) {
    return null;
  }

  const headers: Record<string, string> = {
    'x-external-auth-id': identity.externalAuthId,
  };
  if (identity.email) {
    headers['x-user-email'] = identity.email;
  }
  if (includeContentType) {
    headers['Content-Type'] = 'application/json';
  }
  return headers;
}

export const api = {
  async sendMessage(message: string, sessionId?: string): Promise<{ text: string; citations: CitationReference[]; sessionId: string | null }> {
    try {
      const headers = await authHeaders({ includeContentType: true });
      if (!headers) {
        return {
          text: isAuthBypassEnabled()
            ? 'Unable to resolve local auth identity.'
            : 'You are signed out. Please sign in to continue.',
          citations: [],
          sessionId: sessionId || null,
        };
      }

      const response = await fetch('/api/chat', {
        method: 'POST',
        headers,
        body: JSON.stringify({ message, sessionId })
      });

      if (response.status === 403 && sessionId) {
        const retry = await fetch('/api/chat', {
          method: 'POST',
          headers,
          body: JSON.stringify({ message }),
        });

        if (retry.ok) {
          const retried = await retry.json();
          return {
            text: retried.text || 'No response generated.',
            citations: retried.citations || [],
            sessionId: retried.sessionId || null,
          };
        }
      }

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(errText || 'API error');
      }

      const data = await response.json();
      return {
        text: data.text || 'No response generated.',
        citations: data.citations || [],
        sessionId: data.sessionId || sessionId || null,
      };
    } catch (error) {
      console.error('Chat API Error:', error);
      return {
        text: 'I encountered an error connecting to the AI service. Please ensure the server is running and configured.',
        citations: [],
        sessionId: sessionId || null,
      };
    }
  },

  async loadHistory(): Promise<ChatSession[]> {
    try {
      const headers = await authHeaders();
      if (!headers) {
        return [];
      }

      const response = await fetch('/api/history', {
        method: 'GET',
        headers,
      });
      if (!response.ok) {
        throw new Error('Failed to load history');
      }
      const data = await response.json();
      const rawSessions = Array.isArray(data?.sessions) ? data.sessions : [];
      return rawSessions.map((session: any) => {
        const messages: Message[] = Array.isArray(session.messages)
          ? session.messages.map((m: any) => {
              let citations: CitationReference[] = [];
              if (Array.isArray(m.citations)) {
                citations = m.citations;
              } else if (typeof m.citations === 'string') {
                try {
                  const parsed = JSON.parse(m.citations);
                  if (Array.isArray(parsed)) {
                    citations = parsed;
                  }
                } catch {
                  citations = [];
                }
              }

              return {
                id: m.id,
                role: m.role,
                content: m.content || '',
                timestamp: m.created_at ? Date.parse(m.created_at) : Date.now(),
                citations,
              };
            })
          : [];
        const derivedTitle = session.title || messages.find((m) => m.role === 'user')?.content?.slice(0, 40) || 'New Case Research';
        return {
          id: session.id,
          title: derivedTitle,
          lastModified: session.updated_at ? Date.parse(session.updated_at) : Date.now(),
          messages,
        } as ChatSession;
      });
    } catch (error) {
      console.error('History API Error:', error);
      return [];
    }
  },

  async searchCases({ query, filters }: any) {
    // Local search simulation (kept from original for the CasesPage)
    // In a real app, this might also be an API call or a vector search.
    const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
    await delay(300);

    let results = MOCK_CASES.filter(c => {
      const q = query.toLowerCase();
      return c.name.toLowerCase().includes(q) || 
             c.citation.toLowerCase().includes(q) || 
             c.tags.some(t => t.toLowerCase().includes(q)) ||
             c.summary.toLowerCase().includes(q);
    });

    if (filters?.court) {
      results = results.filter(c => c.court === filters.court);
    }
    if (filters?.tags && filters.tags.length > 0) {
      results = results.filter(c => filters.tags!.some((tag: string) => c.tags.includes(tag)));
    }

    return results;
  },

  async uploadTextDocument(params: UploadTextDocumentParams): Promise<UploadTextDocumentResponse> {
    try {
      const headers = await authHeaders({ includeContentType: true });
      if (!headers) {
        return {
          status: 'error',
          sessionId: params.sessionId || null,
          chunkCount: 0,
          document: null,
          error: isAuthBypassEnabled()
            ? 'Unable to resolve local auth identity.'
            : 'You are signed out. Please sign in to continue.',
        };
      }

      const response = await fetch('/api/documents/text', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          text: params.text,
          title: params.title,
          sessionId: params.sessionId,
          sourceUrl: params.sourceUrl,
          extractedJson: params.extractedJson || undefined,
        }),
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        return {
          status: 'error',
          sessionId: params.sessionId || null,
          chunkCount: 0,
          document: null,
          error: data?.error || `Upload failed (${response.status})`,
        };
      }

      return {
        status: data?.status || 'ok',
        sessionId: data?.sessionId || params.sessionId || null,
        chunkCount: Number(data?.chunkCount || 0),
        document: data?.document
          ? {
              id: data.document.id,
              title: data.document.title,
              sourceUrl: data.document.sourceUrl,
              status: data.document.status,
            }
          : null,
      };
    } catch (error) {
      console.error('Document upload API Error:', error);
      return {
        status: 'error',
        sessionId: params.sessionId || null,
        chunkCount: 0,
        document: null,
        error: 'Failed to upload document.',
      };
    }
  },

  async listSessionDocuments(sessionId: string): Promise<SessionDocumentSummary[]> {
    if (!sessionId) return [];
    try {
      const headers = await authHeaders();
      if (!headers) return [];
      const response = await fetch(`/api/documents?sessionId=${encodeURIComponent(sessionId)}`, {
        method: 'GET',
        headers,
      });
      if (!response.ok) {
        return [];
      }
      const data = await response.json();
      const docs = Array.isArray(data?.documents) ? data.documents : [];
      return docs.map((d: any) => ({
        id: String(d.id),
        sessionId: String(d.session_id || sessionId),
        title: String(d.title || 'Document'),
        mimeType: typeof d.mime_type === 'string' ? d.mime_type : undefined,
        sourceUrl: typeof d.source_url === 'string' ? d.source_url : undefined,
        status: String(d.status || 'unknown'),
        createdAt: typeof d.created_at === 'string' ? d.created_at : undefined,
        updatedAt: typeof d.updated_at === 'string' ? d.updated_at : undefined,
      }));
    } catch (error) {
      console.error('List documents API Error:', error);
      return [];
    }
  }
};
