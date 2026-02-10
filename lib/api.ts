import { MOCK_CASES } from '../data/mockCases';
import { CitationReference } from './types';

export const api = {
  async sendMessage(message: string): Promise<{ text: string; citations: CitationReference[] }> {
    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message })
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(errText || 'API error');
      }

      const data = await response.json();
      return { text: data.text || 'No response generated.', citations: data.citations || [] };
    } catch (error) {
      console.error('Chat API Error:', error);
      return {
        text: 'I encountered an error connecting to the AI service. Please ensure the server is running and configured.',
        citations: []
      };
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
  }
};
