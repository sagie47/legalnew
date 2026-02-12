import React, { useState, useEffect, useRef } from 'react';
import { useAppStore } from '../lib/store';
import { MessageBubble } from '../components/chat/MessageBubble';
import { SourcesPanel } from '../components/chat/SourcesPanel';
import { Button, Textarea } from '../components/ui/Generic';
import { Paperclip, FileText, PanelRightClose, PanelRightOpen, Loader2, Sparkles, ChevronDown, Scale, Search, ShieldAlert, PenTool, ArrowUpRight } from 'lucide-react';
import { api } from '../lib/api';
import { CitationReference, Message } from '../lib/types';
import { ExportMemoModal } from '../components/shared/ExportMemoModal';
import { cn } from '../lib/cn';

export const ChatPage = () => {
  const { state, dispatch } = useAppStore();
  const [input, setInput] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [isUploadingDocument, setIsUploadingDocument] = useState(false);
  const [uploadStatus, setUploadStatus] = useState('');
  const [showMemoModal, setShowMemoModal] = useState(false);
  const [activeCitation, setActiveCitation] = useState<CitationReference | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const currentChat = state.chats.find(c => c.id === state.currentChatId);
  const messages = currentChat ? currentChat.messages : [];

  // Auto-scroll on new message
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
    }
  }, [messages, isSending]);

  // Focus textarea on mount
  useEffect(() => {
    if (!currentChat && textareaRef.current) {
        textareaRef.current.focus();
    }
  }, [currentChat]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setActiveCitation(null);
      }
    };
    if (activeCitation) {
      window.addEventListener('keydown', onKeyDown);
      return () => window.removeEventListener('keydown', onKeyDown);
    }
  }, [activeCitation]);

  const buildTitle = (citation: CitationReference) => {
    const manual = citation.manual?.toString().trim();
    const chapter = citation.chapter?.toString().trim();
    const baseTitle = citation.title || citation.caseName || 'Source';
    const prefix = [manual, chapter].filter(Boolean).join(' ');
    if (prefix && typeof baseTitle === 'string' && baseTitle.startsWith(prefix)) {
      return baseTitle;
    }
    return [prefix, baseTitle].filter(Boolean).join(' ').trim();
  };

  const buildLocator = (citation: CitationReference) => {
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

  const handleSend = async (textOverride?: string) => {
    const textToSend = textOverride || input;
    if (!textToSend.trim()) return;

    setIsSending(true);
    setInput('');
    dispatch({ type: 'SET_CITATIONS', citations: [] });
    
    // Reset textarea height
    if (textareaRef.current) {
        textareaRef.current.style.height = 'auto';
    }

    const userMsg: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: textToSend,
      timestamp: Date.now()
    };

    const nextSessionId = state.currentChatId
      || (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : Date.now().toString());

    // If no active chat, start one. Otherwise, add to existing.
    if (!state.currentChatId) {
        dispatch({ type: 'START_CHAT', chatId: nextSessionId, initialMessage: userMsg });
    } else {
        dispatch({ type: 'ADD_MESSAGE', message: userMsg });
    }

    try {
      const response = await api.sendMessage(userMsg.content, nextSessionId);
      if (response.sessionId && response.sessionId !== nextSessionId) {
        dispatch({ type: 'REKEY_CURRENT_CHAT', newChatId: response.sessionId });
      }
      
      const botMsg: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: response.text,
        timestamp: Date.now(),
        citations: response.citations
      };

      dispatch({ type: 'ADD_MESSAGE', message: botMsg });
      dispatch({ type: 'SET_CITATIONS', citations: response.citations });
    } catch (err) {
      console.error(err);
    } finally {
      setIsSending(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    // Auto-grow
    e.target.style.height = 'auto';
    e.target.style.height = `${Math.min(e.target.scrollHeight, 200)}px`;
  };

  const suggestions = [
    { icon: Search, label: "Find Precedent", desc: "Search for 'study permit' or 'h&c' cases", query: "Find recent Federal Court cases regarding study permit refusals under s. 216(1)." },
    { icon: ShieldAlert, label: "Analyze Refusal", desc: "Check a decision for Vavilov errors", query: "I have a refusal letter. Can you analyze it for reasonableness based on Vavilov principles?" },
    { icon: PenTool, label: "Draft Submission", desc: "Create an IRAC memo for a client", query: "Draft a submission letter for a spousal sponsorship addressing the genuineness of the relationship." },
    { icon: Scale, label: "Legal Principles", desc: "Explain 'dual intent' or 'procedural fairness'", query: "Explain the current legal test for dual intent under the IRPA." },
  ];

  const clearUploadStatusLater = (message: string, delayMs = 6000) => {
    window.setTimeout(() => {
      setUploadStatus((current) => (current === message ? '' : current));
    }, delayMs);
  };

  const handlePickDocument = () => {
    fileInputRef.current?.click();
  };

  const handleDocumentSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const name = file.name || 'document.txt';
    const lowerName = name.toLowerCase();
    const supported = lowerName.endsWith('.txt') || lowerName.endsWith('.md') || lowerName.endsWith('.markdown');
    if (!supported) {
      const message = `Unsupported file type for "${name}". Use .txt or .md.`;
      setUploadStatus(message);
      clearUploadStatusLater(message);
      e.target.value = '';
      return;
    }

    try {
      setIsUploadingDocument(true);
      const text = await file.text();
      const cleaned = text.trim();
      if (!cleaned) {
        const message = `No readable text found in "${name}".`;
        setUploadStatus(message);
        clearUploadStatusLater(message);
        return;
      }

      const initialSessionId = state.currentChatId
        || (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : Date.now().toString());

      if (!state.currentChatId) {
        dispatch({ type: 'NEW_CHAT', chatId: initialSessionId });
      }

      const uploaded = await api.uploadTextDocument({
        text: cleaned,
        title: name,
        sessionId: initialSessionId,
      });

      if (uploaded.sessionId && uploaded.sessionId !== initialSessionId) {
        dispatch({ type: 'REKEY_CURRENT_CHAT', newChatId: uploaded.sessionId });
      }

      if (uploaded.status === 'ok') {
        const message = `Uploaded "${name}" (${uploaded.chunkCount} chunks). It will be used as [D#] sources in this chat.`;
        setUploadStatus(message);
        clearUploadStatusLater(message);
      } else {
        const message = uploaded.error || `Failed to upload "${name}".`;
        setUploadStatus(message);
        clearUploadStatusLater(message);
      }
    } catch (error) {
      console.error('Document upload failed:', error);
      const message = `Failed to upload "${name}".`;
      setUploadStatus(message);
      clearUploadStatusLater(message);
    } finally {
      setIsUploadingDocument(false);
      e.target.value = '';
    }
  };

  return (
    <div className="flex h-full overflow-hidden bg-white font-sans">
      <div className="flex-1 flex flex-col min-w-0 relative bg-[#f9fafb]">
        {/* Subtle Noise Texture */}
        <div className="absolute inset-0 opacity-[0.015] pointer-events-none" style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.65' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)'/%3E%3C/svg%3E")` }}></div>

        {/* Minimal Floating Header */}
        <header className="absolute top-0 left-0 right-0 h-20 px-8 flex items-center justify-between z-20 pointer-events-none">
          <div className="flex items-center gap-2 pointer-events-auto">
             <div className="flex items-center gap-2 cursor-pointer hover:bg-black/5 py-1.5 px-3 -ml-3 rounded-full transition-colors group backdrop-blur-sm border border-transparent hover:border-black/5">
                <span className="w-2 h-2 rounded-full bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.4)]"></span>
                <h1 className="font-semibold text-slate-800 text-sm tracking-tight">{currentChat?.title || "New Session"}</h1>
                <ChevronDown className="h-3 w-3 text-slate-400 group-hover:text-slate-600 transition-transform group-hover:rotate-180" />
             </div>
          </div>
          <div className="flex items-center gap-3 pointer-events-auto">
            <Button variant="ghost" size="sm" onClick={() => setShowMemoModal(true)} className="hidden sm:flex text-slate-500 hover:text-slate-900 gap-2 h-9 rounded-full px-4 hover:bg-white/60 hover:shadow-sm border border-transparent hover:border-slate-200 transition-all">
              <FileText className="h-4 w-4" /> 
              <span className="text-xs font-medium">Export</span>
            </Button>
            <Button 
              variant="ghost" 
              size="icon" 
              onClick={() => dispatch({ type: 'TOGGLE_SOURCES_PANEL' })}
              className={cn("text-slate-400 hover:text-slate-800 transition-all rounded-full hover:bg-white/60 hover:shadow-sm h-9 w-9", state.isSourcesPanelOpen && "bg-white shadow-sm text-slate-900")}
            >
              {state.isSourcesPanelOpen ? <PanelRightClose className="h-4 w-4" /> : <PanelRightOpen className="h-4 w-4" />}
            </Button>
          </div>
        </header>

        {/* Messages Canvas */}
        <div className="flex-1 overflow-y-auto" ref={scrollRef}>
          <div className="max-w-4xl mx-auto w-full px-6 pt-32 pb-72">
              {messages.length === 0 ? (
                <div className="flex flex-col items-center justify-center animate-fade-in mt-10">
                  <div className="mb-10 relative group">
                     <div className="absolute inset-0 bg-blue-500/20 rounded-full blur-2xl opacity-0 group-hover:opacity-100 transition-opacity duration-1000"></div>
                     <div className="relative bg-white p-5 rounded-2xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] border border-slate-100 ring-1 ring-slate-900/5">
                        <Scale className="h-10 w-10 text-slate-900" />
                     </div>
                  </div>
                  
                  <h2 className="text-4xl font-serif font-medium text-slate-900 mb-3 tracking-tight text-center">Good afternoon, Counsel.</h2>
                  <p className="text-slate-500 mb-16 text-center max-w-lg text-lg leading-relaxed font-light">
                    I'm ready to assist with your research. All citations are verified against the 2024 Federal Court database.
                  </p>
                  
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6 w-full max-w-3xl px-4">
                    {suggestions.map((s, idx) => (
                      <button 
                        key={idx}
                        onClick={() => handleSend(s.query)}
                        className="group flex flex-col items-start p-5 bg-white border border-slate-200/60 rounded-2xl hover:border-blue-300/50 hover:shadow-[0_8px_30px_rgb(0,0,0,0.04)] hover:-translate-y-0.5 transition-all duration-300 text-left relative overflow-hidden"
                      >
                        <div className="absolute top-4 right-4 opacity-0 group-hover:opacity-100 transition-opacity duration-300 transform translate-x-2 group-hover:translate-x-0">
                            <ArrowUpRight className="h-4 w-4 text-blue-500" />
                        </div>
                        <div className="mb-4 p-2.5 bg-slate-50 rounded-xl group-hover:bg-blue-50/50 transition-colors text-slate-600 group-hover:text-blue-600">
                            <s.icon className="h-5 w-5" />
                        </div>
                        <span className="text-base font-semibold text-slate-900 mb-1.5">{s.label}</span>
                        <span className="text-sm text-slate-500 leading-snug">{s.desc}</span>
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="flex flex-col space-y-12">
                  {messages.map((msg, idx) => (
                    <MessageBubble
                      key={msg.id}
                      message={msg}
                      isLast={idx === messages.length - 1}
                      onCitationOpen={setActiveCitation}
                    />
                  ))}
                  {isSending && (
                    <div className="flex gap-6 p-4 animate-fade-in pl-2 max-w-3xl">
                       <div className="h-8 w-8 rounded-full bg-white border border-slate-100 flex items-center justify-center shadow-sm shrink-0">
                          <Sparkles className="h-4 w-4 text-amber-500 animate-pulse" />
                       </div>
                       <div className="space-y-3 pt-1.5">
                          <div className="flex gap-1.5 items-center">
                            <div className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-[bounce_1s_infinite_0ms]"></div>
                            <div className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-[bounce_1s_infinite_200ms]"></div>
                            <div className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-[bounce_1s_infinite_400ms]"></div>
                            <span className="text-xs text-slate-400 font-medium ml-2 uppercase tracking-wider">Reasoning</span>
                          </div>
                       </div>
                    </div>
                  )}
                </div>
              )}
          </div>
        </div>

        {/* Floating Command Center */}
        <div className="absolute bottom-0 left-0 right-0 p-6 pt-32 bg-gradient-to-t from-[#f9fafb] via-[#f9fafb]/90 to-transparent pointer-events-none z-30">
          <div className="max-w-3xl mx-auto pointer-events-auto relative">
            <div className={cn(
                "group relative bg-white/80 backdrop-blur-xl rounded-[24px] shadow-[0_20px_40px_-12px_rgba(0,0,0,0.12)] border border-white/50 ring-1 ring-slate-900/5 transition-all duration-300",
                "focus-within:ring-2 focus-within:ring-slate-900/10 focus-within:shadow-[0_25px_50px_-12px_rgba(0,0,0,0.15)] focus-within:scale-[1.002]"
            )}>
                <input
                    ref={fileInputRef}
                    type="file"
                    accept=".txt,.md,.markdown,text/plain,text/markdown"
                    className="hidden"
                    onChange={handleDocumentSelected}
                />
                <Textarea
                    ref={textareaRef}
                    value={input}
                    onChange={handleInput}
                    onKeyDown={handleKeyDown}
                    placeholder="Describe the legal issue or ask a question..."
                    className="w-full bg-transparent border-none focus:ring-0 focus:border-none p-5 min-h-[64px] max-h-[240px] resize-none text-[16px] leading-relaxed placeholder:text-slate-400 text-slate-900"
                    rows={1}
                />
                
                <div className="flex items-center justify-between px-3 pb-3">
                    <div className="flex items-center gap-1">
                        <Button
                            variant="ghost"
                            size="icon"
                            onClick={handlePickDocument}
                            disabled={isUploadingDocument}
                            className="h-9 w-9 text-slate-400 hover:text-slate-700 hover:bg-slate-100/80 rounded-xl transition-colors disabled:opacity-50"
                            title="Attach text/markdown document"
                        >
                            {isUploadingDocument ? <Loader2 className="h-4 w-4 animate-spin" /> : <Paperclip className="h-4 w-4" />}
                        </Button>
                        <div className="w-px h-4 bg-slate-200 mx-1"></div>
                        <Button variant="ghost" size="sm" className="h-8 text-xs font-medium text-slate-500 hover:text-slate-900 hover:bg-slate-100/80 rounded-lg transition-colors px-3">
                            Search Web
                        </Button>
                    </div>
                    <div className="flex items-center gap-3">
                        {input.length > 0 && (
                            <span className="text-[10px] text-slate-300 font-medium animate-fade-in tracking-wider uppercase">
                                {input.length} chars
                            </span>
                        )}
                        <Button 
                            onClick={() => handleSend()} 
                            disabled={isUploadingDocument || (!input.trim() && !isSending)}
                            size="icon"
                            className={cn(
                                "h-9 w-9 rounded-xl transition-all duration-300 shadow-sm",
                                input.trim() 
                                    ? "bg-slate-900 hover:bg-black text-white hover:scale-105 shadow-md" 
                                    : "bg-slate-100 text-slate-300"
                            )}
                        >
                            {isSending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowUpIcon className="h-5 w-5" />}
                        </Button>
                    </div>
                </div>
            </div>

            {uploadStatus && (
              <p className="text-center text-[11px] text-slate-500 mt-3 font-medium">{uploadStatus}</p>
            )}
            
            <p className="text-center text-[11px] text-slate-400 mt-4 font-medium tracking-wide opacity-60">
                AI may produce inaccurate information. Verify with official sources.
            </p>
          </div>
        </div>

        {activeCitation && (
          <div
            className="absolute inset-0 z-[80] bg-black/30 backdrop-blur-sm flex items-center justify-center p-4"
            onClick={() => setActiveCitation(null)}
          >
            <div
              className="w-full max-w-2xl bg-white rounded-2xl shadow-[0_30px_80px_-30px_rgba(15,23,42,0.6)] border border-slate-200 overflow-hidden"
              onClick={(e) => e.stopPropagation()}
              role="dialog"
              aria-modal="true"
            >
              <div className="px-6 py-4 border-b border-slate-100 bg-[#fffdf5]">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h3 className="text-lg font-bold text-slate-900 font-serif">{buildTitle(activeCitation)}</h3>
                    {buildLocator(activeCitation) && (
                      <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                        {buildLocator(activeCitation)}
                      </p>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => setActiveCitation(null)}
                    className="text-xs font-semibold text-slate-500 hover:text-slate-900 px-2 py-1 rounded-md"
                  >
                    Close
                  </button>
                </div>
              </div>
              <div className="px-6 py-5 space-y-4">
                {activeCitation.snippet ? (
                  <div className="relative">
                    <div className="absolute left-0 top-1 bottom-1 w-0.5 bg-amber-200 rounded-full"></div>
                    <p className="pl-3 font-serif text-sm text-slate-700 leading-relaxed">
                      “{activeCitation.snippet}”
                    </p>
                  </div>
                ) : (
                  <p className="text-sm text-slate-400">No snippet available.</p>
                )}
                <div className="flex flex-wrap gap-2 text-[11px] text-slate-500">
                  {activeCitation.sourceType && (
                    <span className="px-2 py-0.5 bg-slate-100 rounded-full">type: {activeCitation.sourceType}</span>
                  )}
                  {activeCitation.sourceFile && (
                    <span className="px-2 py-0.5 bg-slate-100 rounded-full">file: {activeCitation.sourceFile}</span>
                  )}
                  {typeof activeCitation.pageStart === 'number' && typeof activeCitation.pageEnd === 'number' && (
                    <span className="px-2 py-0.5 bg-slate-100 rounded-full">pages: {activeCitation.pageStart}-{activeCitation.pageEnd}</span>
                  )}
                </div>
              </div>
              <div className="px-6 py-4 border-t border-slate-100 bg-slate-50 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => {
                    if (activeCitation.snippet) {
                      navigator.clipboard?.writeText(activeCitation.snippet);
                    }
                  }}
                  className="text-xs font-medium text-slate-600 hover:text-slate-900 px-3 py-1.5 rounded-md bg-white border border-slate-200"
                >
                  Copy Quote
                </button>
                {activeCitation.sourceUrl && (
                  <button
                    type="button"
                    onClick={() => window.open(activeCitation.sourceUrl, '_blank', 'noopener,noreferrer')}
                    className="text-xs font-medium text-blue-600 hover:text-blue-800 px-3 py-1.5 rounded-md bg-white border border-slate-200 flex items-center gap-1"
                  >
                    Open Source <ArrowUpRight className="h-3 w-3" />
                  </button>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Sources Panel */}
      <div className={cn(
        "border-l border-slate-200 bg-white transition-all duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] hidden lg:block z-10 shadow-[0_0_40px_rgba(0,0,0,0.03)]",
        state.isSourcesPanelOpen ? "w-[400px] opacity-100 translate-x-0" : "w-0 opacity-0 translate-x-10 overflow-hidden"
      )}>
        <div className="w-[400px] h-full">
          <SourcesPanel
            onCloseMobile={() => {}}
            onCitationOpen={setActiveCitation}
            isOverlayOpen={Boolean(activeCitation)}
          />
        </div>
      </div>

      <ExportMemoModal isOpen={showMemoModal} onClose={() => setShowMemoModal(false)} />
    </div>
  );
};

// Icons for this component
const ArrowUpIcon = ({ className }: { className?: string }) => (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}><path d="m5 12 7-7 7 7"/><path d="M12 19V5"/></svg>
);
