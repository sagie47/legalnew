export interface Case {
  id: string;
  name: string;
  citation: string;
  year: number;
  court: 'FC' | 'FCA' | 'SCC' | 'IRB';
  tags: string[];
  summary: string;
  paragraphs: CaseParagraph[];
}

export interface CaseParagraph {
  id: string;
  number: number;
  text: string;
}

export interface CitationReference {
  id?: string;
  referenceId?: string;
  caseId: string;
  caseName: string;
  citation: string;
  paragraphNumbers: number[];
  relevanceScore: number;
  sourceType?: 'pinecone' | 'a2aj_case' | 'user_document' | string;
  locator?: string;
  url?: string;
  score?: number;
  metadata?: any;
  title?: string;
  manual?: string;
  chapter?: string;
  headingPath?: string[];
  pageStart?: number;
  pageEnd?: number;
  sourceFile?: string;
  sourceUrl?: string;
  snippet?: string;
}

export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  citations?: CitationReference[];
}

export interface ChatSession {
  id: string;
  title: string;
  lastModified: number;
  messages: Message[];
}

export interface MemoTemplate {
  id: string;
  name: string;
  sections: string[];
}
