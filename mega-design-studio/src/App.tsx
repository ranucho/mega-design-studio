import React, { useState, useEffect } from 'react';
import { AppProvider, useApp } from '@/contexts/AppContext';
import { hasApiKey, setApiKey, getApiKey } from '@/services/gemini/client';
import { AnimatixProvider } from '@/contexts/AnimatixContext';
import { ExtractorProvider } from '@/contexts/ExtractorContext';
import { BannerProvider } from '@/contexts/BannerContext';
import { ToastProvider } from '@/components/shared/Toast';
import { BackgroundParticles } from '@/components/shared/BackgroundParticles';
import TabBar from '@/components/ui/TabBar';
import { ConceptTab } from '@/components/animatix/ConceptTab';
import { StoryboardTab } from '@/components/animatix/StoryboardTab';
import { MovieTab } from '@/components/animatix/MovieTab';
import { CaptureTab } from '@/components/extractor/CaptureTab';
import { StudioTab } from '@/components/extractor/StudioTab';
import { TheLab } from '@/components/extractor/TheLab';
import { ToolkitTab } from '@/components/extractor/ToolkitTab';
import { EditorTab } from '@/components/extractor/EditorTab';
import { ProjectSaveLoad } from '@/components/ui/ProjectSaveLoad';
import { BannersTab } from '@/components/banners/BannersTab';

const AppContent: React.FC = () => {
  const { activeTab, setActiveTab } = useApp();
  const [showParticles, setShowParticles] = useState(true);
  const [showApiKeyModal, setShowApiKeyModal] = useState(false);
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [keyConfigured, setKeyConfigured] = useState(hasApiKey());

  // Show API key modal on first load if no key
  useEffect(() => {
    if (!hasApiKey()) setShowApiKeyModal(true);
    else setApiKeyInput(getApiKey().slice(0, 8) + '...');
  }, []);

  const handleSaveKey = () => {
    if (apiKeyInput.trim() && !apiKeyInput.endsWith('...')) {
      setApiKey(apiKeyInput.trim());
      setKeyConfigured(true);
      setShowApiKeyModal(false);
    }
  };

  return (
    <div className="h-screen bg-black text-white flex flex-col relative overflow-hidden font-sans selection:bg-indigo-500/30">
      {showParticles && <BackgroundParticles />}

      {/* Header */}
      <header className="relative z-10 flex items-center justify-between px-6 py-3 bg-zinc-950/80 backdrop-blur-sm border-b border-zinc-800 shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-lg flex items-center justify-center">
            <i className="fa-solid fa-wand-magic-sparkles text-white text-sm" />
          </div>
          <h1 className="text-lg font-bold bg-gradient-to-r from-indigo-400 to-purple-400 bg-clip-text text-transparent">
            Mega Design Studio
          </h1>
        </div>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 cursor-pointer" title={showParticles ? 'Hide Particles' : 'Show Particles'}>
            <span className="text-xs text-zinc-400">Particles</span>
            <div
              className={`relative w-8 h-[18px] rounded-full transition-colors ${showParticles ? 'bg-indigo-500' : 'bg-zinc-700'}`}
              onClick={() => setShowParticles(p => !p)}
            >
              <div className={`absolute top-[2px] w-[14px] h-[14px] rounded-full bg-white shadow transition-transform ${showParticles ? 'left-[16px]' : 'left-[2px]'}`} />
            </div>
          </label>
          <button
            onClick={() => { setApiKeyInput(hasApiKey() ? '' : ''); setShowApiKeyModal(true); }}
            className={`w-8 h-8 rounded-lg flex items-center justify-center transition-colors ${
              keyConfigured ? 'bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-white' : 'bg-red-600/20 border border-red-600/40 text-red-400 hover:bg-red-600/30 animate-pulse'
            }`}
            title={keyConfigured ? 'API Key Settings' : 'API Key Required!'}
          >
            <i className="fa-solid fa-key text-xs" />
          </button>
          <ProjectSaveLoad />
        </div>
      </header>

      {/* API Key Modal */}
      {showApiKeyModal && (
        <div className="fixed inset-0 z-[100] bg-black/80 flex items-center justify-center p-6" onClick={() => keyConfigured && setShowApiKeyModal(false)}>
          <div className="bg-zinc-900 border border-zinc-700 rounded-2xl shadow-2xl max-w-md w-full p-6 flex flex-col gap-4" onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 to-cyan-500 flex items-center justify-center">
                <i className="fa-solid fa-key text-white" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-white">Google Gemini API Key</h3>
                <p className="text-[10px] text-zinc-400">Required for AI features. Get yours at ai.google.dev</p>
              </div>
            </div>
            <input
              type="password"
              value={apiKeyInput}
              onChange={e => setApiKeyInput(e.target.value)}
              onFocus={() => { if (apiKeyInput.endsWith('...')) setApiKeyInput(''); }}
              placeholder="Paste your Gemini API key here..."
              className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2.5 text-sm text-white placeholder-zinc-500 focus:border-blue-500 focus:outline-none font-mono"
              onKeyDown={e => e.key === 'Enter' && handleSaveKey()}
            />
            <div className="flex items-center justify-between">
              <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener noreferrer"
                className="text-[10px] text-blue-400 hover:text-blue-300 flex items-center gap-1">
                <i className="fa-solid fa-external-link" /> Get API Key
              </a>
              <div className="flex gap-2">
                {keyConfigured && (
                  <button onClick={() => setShowApiKeyModal(false)}
                    className="px-3 py-1.5 text-xs text-zinc-400 hover:text-white border border-zinc-700 rounded-lg transition-colors">
                    Cancel
                  </button>
                )}
                <button onClick={handleSaveKey}
                  disabled={!apiKeyInput.trim() || apiKeyInput.endsWith('...')}
                  className={`px-4 py-1.5 text-xs font-medium rounded-lg transition-all ${
                    apiKeyInput.trim() && !apiKeyInput.endsWith('...')
                      ? 'bg-blue-600 hover:bg-blue-500 text-white'
                      : 'bg-zinc-700 text-zinc-400 cursor-not-allowed'
                  }`}>
                  Save Key
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Tab Navigation */}
      <div className="relative z-10 shrink-0">
        <TabBar activeTab={activeTab} onTabChange={setActiveTab} />
      </div>

      {/* Main Content - all tabs stay mounted, toggled via hidden */}
      <main className="flex-1 overflow-hidden relative z-10">
        <div className={`h-full ${activeTab === 'concept' ? '' : 'hidden'}`}><ConceptTab /></div>
        <div className={`h-full ${activeTab === 'storyboard' ? '' : 'hidden'}`}><StoryboardTab /></div>
        <div className={`h-full ${activeTab === 'movie' ? '' : 'hidden'}`}><MovieTab /></div>
        <div className={`h-full ${activeTab === 'capture' ? '' : 'hidden'}`}><CaptureTab /></div>
        <div className={`h-full ${activeTab === 'studio' ? '' : 'hidden'}`}><StudioTab /></div>
        <div className={`h-full ${activeTab === 'editor' ? '' : 'hidden'}`}><EditorTab /></div>
        <div className={`h-full ${activeTab === 'toolkit' ? '' : 'hidden'}`}><ToolkitTab /></div>
        <div className={`h-full ${activeTab === 'banners' ? '' : 'hidden'}`}><BannersTab /></div>
        <div className={`h-full ${activeTab === 'lab' ? '' : 'hidden'}`}><TheLab /></div>
      </main>
    </div>
  );
};

const App: React.FC = () => {
  return (
    <AppProvider>
      <ToastProvider>
        <AnimatixProvider>
          <ExtractorProvider>
            <BannerProvider>
              <AppContent />
            </BannerProvider>
          </ExtractorProvider>
        </AnimatixProvider>
      </ToastProvider>
    </AppProvider>
  );
};

export default App;
