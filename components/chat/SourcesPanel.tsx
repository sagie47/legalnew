import React, { useEffect, useRef } from 'react';
import { useAppStore } from '../../lib/store';
import { Badge } from '../ui/Generic.tsx';
import { ExternalLink, Quote, Library } from 'lucide-react';
import { cn } from '../../lib/cn';
import { CitationReference } from '../../lib/types';

export const SourcesPanel: React.FC<{
  onCloseMobile: () => void;
  onCitationOpen?: (citation: CitationReference) => void;
  isOverlayOpen?: boolean;
}> = ({ onCloseMobile, onCitationOpen, isOverlayOpen }) => {
  const { state } = useAppStore();
  const refs = useRef<{ [key: string]: HTMLDivElement | null }>({});

  useEffect(() => {
    if (state.highlightedCitationId && refs.current[state.highlightedCitationId]) {
      refs.current[state.highlightedCitationId]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      // Add a temporary highlight class
      const el = refs.current[state.highlightedCitationId];
      if (el) {
        el.classList.add('ring-2', 'ring-amber-400', 'ring-offset-2');
        setTimeout(() => el.classList.remove('ring-2', 'ring-amber-400', 'ring-offset-2'), 2000);
      }
    }
  }, [state.highlightedCitationId]);

  const buildTitle = (citation: any) => {
    const manual = citation.manual?.toString().trim();
    const chapter = citation.chapter?.toString().trim();
    const baseTitle = citation.title || citation.caseName || 'Source';
    const prefix = [manual, chapter].filter(Boolean).join(' ');
    if (prefix && typeof baseTitle === 'string' && baseTitle.startsWith(prefix)) {
      return baseTitle;
    }
    return [prefix, baseTitle].filter(Boolean).join(' ').trim();
  };

  const buildLocator = (citation: any) => {
    const parts: string[] = [];
    const manual = citation.manual?.toString().trim();
    const chapter = citation.chapter?.toString().trim();
    const manualChapter = [manual, chapter].filter(Boolean).join(' ');
    if (manualChapter) parts.push(manualChapter);
    if (citation.citation) parts.push(citation.citation);
    if (Array.isArray(citation.headingPath) && citation.headingPath.length > 0) {
      parts.push(citation.headingPath.join(' / '));
    }
    const pageStart = citation.pageStart;
    const pageEnd = citation.pageEnd;
    if (typeof pageStart === 'number' && typeof pageEnd === 'number') {
      parts.push(`pp. ${pageStart}-${pageEnd}`);
    } else if (typeof pageStart === 'number') {
      parts.push(`p. ${pageStart}`);
    }
    return parts.join(' | ');
  };

  return (
    <div className="flex h-full flex-col bg-[#f8f9fa] border-l border-slate-200">
      <div className="flex items-center justify-between border-b border-slate-200 bg-white/80 backdrop-blur-sm px-5 py-4 shrink-0">
        <h2 className="text-sm font-bold text-slate-800 flex items-center gap-2 font-serif">
          <Library className="h-4 w-4 text-amber-600" />
          Sources & Citations
        </h2>
        <Badge variant="secondary" className="bg-slate-100 text-slate-600 font-mono text-[10px]">{state.activeCitations.length} REFS</Badge>
      </div>

      <div className={cn(
        "flex-1 overflow-y-auto p-4 space-y-4 custom-scrollbar transition-all duration-300",
        isOverlayOpen && "scale-[0.98] opacity-60 blur-[0.5px] pointer-events-none"
      )}>
        {state.activeCitations.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-slate-400 text-center text-sm">
            <div className="h-12 w-12 rounded-full bg-slate-100 flex items-center justify-center mb-3">
                <Quote className="h-6 w-6 opacity-30" />
            </div>
            <p className="font-medium text-slate-500">No active citations</p>
            <p className="text-xs mt-1 max-w-[200px] leading-relaxed">Ask a legal question to generate verified case law references.</p>
          </div>
        ) : (
          state.activeCitations.map((citation) => {
            const title = buildTitle(citation);
            const locator = buildLocator(citation);
            return (
              <div 
                key={citation.caseId}
                ref={(el) => refs.current[citation.caseId] = el}
                className={cn(
                  "transition-all duration-300 rounded-xl",
                  state.highlightedCitationId === citation.caseId ? "shadow-lg scale-[1.02]" : ""
                )}
              >
                <button
                  type="button"
                  onClick={() => onCitationOpen?.(citation)}
                  className="w-full text-left rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden group focus:outline-none focus:ring-2 focus:ring-amber-300"
                >
                  <div className="bg-[#fffdf5] px-4 py-3 border-b border-slate-100 flex justify-between items-start">
                    <div>
                      <h3 className="text-base font-bold text-slate-900 leading-tight font-serif group-hover:text-blue-700 transition-colors cursor-pointer">{title}</h3>
                      {locator && (
                        <div className="mt-1.5 text-[11px] text-slate-500 font-medium leading-relaxed">
                          {locator}
                        </div>
                      )}
                    </div>
                    <div className="flex flex-col items-end">
                       <div className="text-[10px] font-bold text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded-full">{citation.relevanceScore}% match</div>
                    </div>
                  </div>
                  
                  <div className="p-4 bg-white">
                    {citation.snippet ? (
                      <div className="mb-1 relative">
                        <div className="absolute left-0 top-1 bottom-1 w-0.5 bg-amber-200 rounded-full"></div>
                        <p className="pl-3 font-serif text-sm text-slate-700 leading-relaxed text-[13px]">
                          "{citation.snippet}"
                        </p>
                      </div>
                    ) : (
                      <p className="text-xs text-slate-400">No snippet available.</p>
                    )}
                  </div>

                  <div className="bg-slate-50/50 px-3 py-2 border-t border-slate-100 flex justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (citation.snippet) {
                          navigator.clipboard?.writeText(citation.snippet);
                        }
                      }}
                      className="text-xs font-medium text-slate-500 hover:text-slate-800 px-2 py-1"
                    >
                      Copy Quote
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (citation.sourceUrl) {
                          window.open(citation.sourceUrl, '_blank', 'noopener,noreferrer');
                        }
                      }}
                      className="text-xs font-medium text-blue-600 hover:text-blue-800 px-2 py-1 flex items-center gap-1"
                    >
                      Read Full Case <ExternalLink className="h-3 w-3" />
                    </button>
                  </div>
                </button>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
