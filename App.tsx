import React, { useState, useEffect } from 'react';
import { Sidebar } from './components/layout/Sidebar';
import { ChatPage } from './pages/ChatPage';
import { CasesPage } from './pages/CasesPage';
import { LandingPage } from './pages/LandingPage';
import { LoginPage } from './pages/LoginPage';
import { SettingsPage } from './pages/SettingsPage';
import { AppProvider, useAppStore } from './lib/store';
import { Menu, ShieldAlert, X } from 'lucide-react';
import { Button } from './components/ui/Generic';
import { cn } from './lib/cn';

// Simple router component
const Router = () => {
  const [page, setPage] = useState('landing');
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const { state, dispatch } = useAppStore();
  const [showDisclaimer, setShowDisclaimer] = useState(!state.disclaimerAccepted);

  useEffect(() => {
    // Sync with global store if needed, or check persistence
    if (state.disclaimerAccepted) {
      setShowDisclaimer(false);
    }
  }, [state.disclaimerAccepted]);

  const handleDisclaimer = () => {
    dispatch({ type: 'ACCEPT_DISCLAIMER' });
    setShowDisclaimer(false);
  };

  const handleLogout = () => {
    setPage('landing');
    // We could clear session state here if needed
  };

  // Route Handlers
  if (page === 'landing') {
    return <LandingPage onNavigate={(target) => setPage(target)} />;
  }
  
  if (page === 'login') {
    return <LoginPage onLogin={() => setPage('chat')} onBack={() => setPage('landing')} />;
  }

  // App Layout for Authenticated Pages
  const renderAppPage = () => {
    switch (page) {
      case 'chat': return <ChatPage />;
      case 'cases': return <CasesPage />;
      case 'settings': return <SettingsPage />;
      default: return <div className="p-10 text-center text-slate-400">Page under construction: {page}</div>;
    }
  };

  return (
    <div className="flex h-screen w-full bg-white text-slate-900 overflow-hidden">
      {/* Mobile Menu Button - Absolute */}
      <button 
        className="lg:hidden absolute top-3 left-3 z-[60] p-2 bg-slate-900 text-white rounded-md shadow-md"
        onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
      >
        {isMobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
      </button>

      {/* Sidebar */}
      <Sidebar 
        currentPage={page} 
        onNavigate={setPage} 
        isOpen={isMobileMenuOpen} 
        onCloseMobile={() => setIsMobileMenuOpen(false)}
        onLogout={handleLogout}
      />

      {/* Main Content */}
      <main className="flex-1 relative flex flex-col h-full overflow-hidden">
        {renderAppPage()}
        
        {/* Mobile Overlay for Sidebar */}
        {isMobileMenuOpen && (
          <div 
            className="fixed inset-0 z-40 bg-black/50 lg:hidden"
            onClick={() => setIsMobileMenuOpen(false)}
          />
        )}
      </main>

      {/* Initial Disclaimer Modal - Only shown when in App Mode */}
      {showDisclaimer && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm">
          <div className="bg-white max-w-md w-full rounded-xl shadow-2xl p-6 border-t-4 border-amber-500">
            <div className="flex items-center gap-3 mb-4 text-amber-600">
              <ShieldAlert className="h-8 w-8" />
              <h2 className="text-xl font-bold">Important Disclaimer</h2>
            </div>
            <p className="text-slate-600 mb-4 text-sm leading-relaxed">
              This application is an AI-powered research assistant for RCICs. It provides information based on case law but 
              <strong> does not constitute legal advice</strong>.
            </p>
            <p className="text-slate-600 mb-6 text-sm leading-relaxed">
              AI outputs can be inaccurate ("hallucinations"). You must verify all citations, paragraph numbers, and legal principles with official sources (CanLII, FC judgments) before using them in client submissions.
            </p>
            <Button onClick={handleDisclaimer} className="w-full font-bold">
              I Understand & Agree
            </Button>
          </div>
        </div>
      )}
    </div>
  );
};

export default function App() {
  return (
    <AppProvider>
      <Router />
    </AppProvider>
  );
}