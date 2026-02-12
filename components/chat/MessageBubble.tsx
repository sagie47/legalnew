import React from 'react';
import { cn } from '../../lib/cn';
import { CitationReference, Message } from '../../lib/types';
import { Copy, ThumbsUp, Scale, CheckCircle2 } from 'lucide-react';
import { useAppStore } from '../../lib/store';

export const MessageBubble: React.FC<{
  message: Message;
  isLast: boolean;
  onCitationOpen?: (citation: CitationReference) => void;
}> = ({ message, isLast, onCitationOpen }) => {
  const isUser = message.role === 'user';
  const { dispatch } = useAppStore();

  const resolveCitation = (token: string): CitationReference | null => {
    if (!message.citations || message.citations.length === 0) {
      return null;
    }

    const raw = token.replace('[', '').replace(']', '').trim();
    const numericMatch = raw.match(/^(\d+)$/);
    if (numericMatch) {
      const idx = Number(numericMatch[1]) - 1;
      return message.citations[idx] || null;
    }

    const refMatch = raw.match(/^([PCD])(\d+)$/i);
    if (!refMatch) {
      return null;
    }

    const refId = `${refMatch[1].toUpperCase()}${refMatch[2]}`;
    const byRef = message.citations.find((c) => {
      const cid = typeof c.caseId === 'string' ? c.caseId.toUpperCase() : '';
      const rid = typeof c.referenceId === 'string' ? c.referenceId.toUpperCase() : '';
      const iid = typeof c.id === 'string' ? c.id.toUpperCase() : '';
      return rid === refId || cid === refId || iid === refId;
    });
    if (byRef) {
      return byRef;
    }

    const idx = Number(refMatch[2]) - 1;
    return message.citations[idx] || null;
  };

  const renderContent = (content: string) => {
    const lines = content.split('\n');
    return lines.map((line, idx) => {
      // Headers (IRAC) - styled as premium document sections
      if (line.startsWith('### ')) {
        const title = line.replace('### ', '');
        const type = title.toLowerCase();
        
        return (
          <div key={idx} className="mt-10 mb-5 first:mt-2 group/header">
            <div className="flex items-center gap-3">
                <span className={cn("w-1.5 h-1.5 rounded-full ring-4 ring-opacity-20 transition-all duration-500",
                    type.includes('issue') ? "bg-amber-500 ring-amber-500" :
                    type.includes('rule') ? "bg-blue-500 ring-blue-500" :
                    type.includes('analysis') ? "bg-emerald-500 ring-emerald-500" :
                    "bg-slate-800 ring-slate-800"
                )}></span>
                <h3 className="text-sm font-serif font-bold tracking-wider text-slate-900 uppercase">
                    {title}
                </h3>
                <div className="h-px bg-slate-100 flex-1 group-hover/header:bg-slate-200 transition-colors"></div>
            </div>
          </div>
        );
      }

      // Process inline bold and citations
      const parts = line.split(/(\[(?:P|C|D)?\d+\]|\*\*.*?\*\*)/g);
      return (
        <p key={idx} className={cn(
            "mb-4 leading-8 text-[16px] font-normal tracking-wide",
            isUser ? "text-white/95" : "text-slate-700"
        )}>
          {parts.map((part, pIdx) => {
            if (part.match(/^\[(?:P|C|D)?\d+\]$/i)) {
              const refId = part.replace('[', '').replace(']', '');
              const citation = resolveCitation(part);
              
              return (
                <button
                  key={pIdx}
                  onClick={() => {
                    if (!citation) return;
                    dispatch({ type: 'HIGHLIGHT_CITATION', caseId: citation.caseId });
                    onCitationOpen?.(citation);
                  }}
                  className={cn(
                    "inline-flex items-center justify-center align-top ml-0.5 -mt-0.5 text-[10px] font-bold rounded-md h-5 min-w-[1.25rem] px-1 transition-all shadow-sm transform",
                    citation
                      ? "text-blue-600 bg-blue-50 border border-blue-100/50 hover:bg-blue-600 hover:text-white hover:border-blue-600 cursor-pointer hover:scale-105"
                      : "text-slate-400 bg-slate-100 border border-slate-200 cursor-default"
                  )}
                  title={citation?.caseName || "View Source"}
                >
                  {refId}
                </button>
              );
            }
            if (part.startsWith('**') && part.endsWith('**')) {
              return <strong key={pIdx} className={cn("font-semibold", isUser ? "text-white" : "text-slate-900")}>{part.slice(2, -2)}</strong>;
            }
            return <span key={pIdx}>{part}</span>;
          })}
        </p>
      );
    });
  };

  if (isUser) {
    return (
        <div className="flex w-full justify-end animate-slide-up py-4">
            <div className="max-w-[70%] bg-[#0f172a] text-white px-6 py-4 rounded-[24px] rounded-tr-sm shadow-xl shadow-slate-900/5 selection:bg-white/20">
                {renderContent(message.content)}
            </div>
        </div>
    );
  }

  // Assistant Message - Document Style
  return (
    <div className="flex w-full gap-6 animate-fade-in group pb-8">
      <div className="shrink-0 flex flex-col items-center">
        <div className="h-10 w-10 rounded-full bg-white border border-slate-200/60 flex items-center justify-center shadow-sm text-slate-900 mb-2 relative z-10">
            <Scale className="h-5 w-5" />
            <div className="absolute -bottom-1 -right-1 bg-green-500 rounded-full p-0.5 border-2 border-white">
                <CheckCircle2 className="h-3 w-3 text-white" />
            </div>
        </div>
        {/* Thread line */}
        {!isLast && <div className="w-px h-full bg-slate-200/50 my-2 rounded-full"></div>}
      </div>
      
      <div className="flex-1 max-w-3xl pt-2">
        <div className="flex items-center gap-2 mb-1">
            <span className="text-sm font-bold text-slate-900">RCIC Assistant</span>
            <span className="text-[10px] font-medium text-slate-400 px-2 py-0.5 rounded-full bg-slate-100">AI Model v2.4</span>
        </div>
        
        <div className="text-slate-800 bg-white rounded-2xl p-1 -ml-1">
          {renderContent(message.content)}
        </div>

        <div className="mt-6 flex gap-2 opacity-0 group-hover:opacity-100 transition-all duration-300 translate-y-2 group-hover:translate-y-0">
            <button className="flex items-center gap-2 px-3 py-1.5 text-xs font-medium text-slate-500 hover:text-slate-900 hover:bg-white hover:shadow-sm border border-transparent hover:border-slate-100 rounded-lg transition-all">
                <Copy className="h-3.5 w-3.5" /> Copy
            </button>
            <button className="flex items-center gap-2 px-3 py-1.5 text-xs font-medium text-slate-500 hover:text-slate-900 hover:bg-white hover:shadow-sm border border-transparent hover:border-slate-100 rounded-lg transition-all">
                <ThumbsUp className="h-3.5 w-3.5" /> Helpful
            </button>
        </div>
      </div>
    </div>
  );
};
