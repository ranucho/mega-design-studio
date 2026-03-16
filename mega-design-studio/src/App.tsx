import React, { useState } from 'react';
import { AppProvider, useApp } from '@/contexts/AppContext';
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
            <span className="text-xs text-zinc-500">Particles</span>
            <div
              className={`relative w-8 h-[18px] rounded-full transition-colors ${showParticles ? 'bg-indigo-500' : 'bg-zinc-700'}`}
              onClick={() => setShowParticles(p => !p)}
            >
              <div className={`absolute top-[2px] w-[14px] h-[14px] rounded-full bg-white shadow transition-transform ${showParticles ? 'left-[16px]' : 'left-[2px]'}`} />
            </div>
          </label>
          <ProjectSaveLoad />
        </div>
      </header>

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
