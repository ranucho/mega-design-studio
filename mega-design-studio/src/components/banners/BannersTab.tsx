import React from 'react';
import { useBanner } from '@/contexts/BannerContext';
import { BannerUpload } from './BannerUpload';
import { BannerExtractor } from './BannerExtractor';
import { BannerPresets } from './BannerPresets';
import { BannerCanvas } from './BannerCanvas';
import { BannerLayerPanel } from './BannerLayerPanel';
import { BannerProperties } from './BannerProperties';
import { BannerCompositionGrid } from './BannerCompositionGrid';
import { BannerExportDialog } from './BannerExportDialog';
import { BannerReskinPanel } from './BannerReskinPanel';
import { BannerSparklePanel } from './BannerSparklePanel';
import { BannerLuckyReskin } from './BannerLuckyReskin';
import { BannerStage } from '@/types';
import { SkinSelector } from '@/components/shared/SkinSelector';

// Error boundary to catch render crashes and show the error instead of black screen
class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error) { console.error('BannerExtractor crash:', error); }
  render() {
    if (this.state.error) return (
      <div className="p-8 text-center">
        <h2 className="text-red-400 text-lg font-bold mb-2">Component Error</h2>
        <pre className="text-xs text-red-300 bg-zinc-900 p-4 rounded max-w-xl mx-auto overflow-auto text-left">{this.state.error.message}{'\n'}{this.state.error.stack}</pre>
        <button className="mt-4 px-4 py-2 bg-zinc-700 text-white rounded" onClick={() => this.setState({ error: null })}>Retry</button>
      </div>
    );
    return this.props.children;
  }
}

const RESIZE_STAGES = [
  { key: 'upload' as BannerStage, label: 'Upload', icon: 'fa-cloud-arrow-up' },
  { key: 'extract' as BannerStage, label: 'Extract', icon: 'fa-puzzle-piece' },
  { key: 'presets' as BannerStage, label: 'Sizes', icon: 'fa-table-cells' },
  { key: 'edit' as BannerStage, label: 'Edit', icon: 'fa-pen-ruler' },
  { key: 'sparkle' as BannerStage, label: 'Fine Tune', icon: 'fa-wand-magic-sparkles' },
  { key: 'export' as BannerStage, label: 'Export', icon: 'fa-download' },
];

const RESKIN_STAGES = [
  { key: 'upload' as BannerStage, label: 'Upload', icon: 'fa-cloud-arrow-up' },
  { key: 'reskin' as BannerStage, label: 'Reskin', icon: 'fa-palette' },
  { key: 'extract' as BannerStage, label: 'Extract', icon: 'fa-puzzle-piece' },
  { key: 'presets' as BannerStage, label: 'Sizes', icon: 'fa-table-cells' },
  { key: 'edit' as BannerStage, label: 'Edit', icon: 'fa-pen-ruler' },
  { key: 'sparkle' as BannerStage, label: 'Fine Tune', icon: 'fa-wand-magic-sparkles' },
  { key: 'export' as BannerStage, label: 'Export', icon: 'fa-download' },
];

export const BannersTab: React.FC = () => {
  const { project, setStage, resetProject, activeCompositionId, setActiveCompositionId } = useBanner();
  const currentStage = project?.stage ?? 'upload';
  const STAGES = project?.mode === 'reskin' ? RESKIN_STAGES : RESIZE_STAGES;
  const stageIndex = STAGES.findIndex(s => s.key === currentStage);

  // Gallery vs compositor view for edit stage
  const [editView, setEditView] = React.useState<'gallery' | 'compositor'>('gallery');
  const [showLuckyReskin, setShowLuckyReskin] = React.useState(false);

  const activeComposition = project?.compositions.find(c => c.id === activeCompositionId) ?? null;

  // When entering edit stage, start with gallery
  React.useEffect(() => {
    if (currentStage === 'edit') setEditView('gallery');
  }, [currentStage]);

  // Handle gallery selection → open compositor
  const handleGallerySelect = React.useCallback((id: string) => {
    setActiveCompositionId(id);
    setEditView('compositor');
  }, [setActiveCompositionId]);

  // Determine which stages are reachable based on available data
  const isStageReachable = (stageKey: BannerStage): boolean => {
    if (!project) return false;
    switch (stageKey) {
      case 'upload': return true;
      case 'reskin': return !!project.sourceImage;
      case 'extract': return !!project.sourceImage;
      case 'presets': return project.extractedElements.length > 0;
      case 'edit': return project.compositions.length > 0;
      case 'sparkle': return project.compositions.length > 0;
      case 'export': return project.compositions.length > 0;
      default: return false;
    }
  };

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Stage Progress Bar */}
      <div className="shrink-0 flex items-center gap-1 px-6 py-3 bg-zinc-900/60 border-b border-zinc-800">
        {STAGES.map((s, i) => {
          const isActive = s.key === currentStage;
          const isDone = i < stageIndex;
          const isReachable = isStageReachable(s.key);
          const isClickable = !isActive && isReachable && project;
          return (
            <React.Fragment key={s.key}>
              {i > 0 && (
                <div className={`w-8 h-px ${isDone || (isReachable && i <= stageIndex) ? 'bg-cyan-600' : 'bg-zinc-700'}`} />
              )}
              <button
                disabled={!isClickable}
                onClick={() => isClickable && setStage(s.key)}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                  isActive
                    ? 'bg-cyan-600/20 text-cyan-400 border border-cyan-600/40'
                    : isClickable
                      ? 'text-cyan-600 hover:text-cyan-400 cursor-pointer'
                      : 'text-zinc-600 cursor-default'
                }`}
              >
                <i className={`fa-solid ${s.icon}`} />
                {s.label}
              </button>
            </React.Fragment>
          );
        })}

        {/* Generation progress indicator */}
        {project?.isGenerating && (
          <div className="ml-4 flex items-center gap-2 text-xs text-yellow-400">
            <i className="fa-solid fa-spinner fa-spin" />
            <span>Generating banners...</span>
          </div>
        )}
        <div className="ml-auto">
          <SkinSelector type="banner" />
        </div>
      </div>

      {/* Stage Content */}
      <div className="flex-1 overflow-hidden">
        {currentStage === 'upload' && <BannerUpload />}
        {currentStage === 'reskin' && <BannerReskinPanel />}
        {currentStage === 'extract' && <ErrorBoundary><BannerExtractor /></ErrorBoundary>}
        {currentStage === 'presets' && <BannerPresets />}
        {currentStage === 'edit' && editView === 'gallery' && (
          <div className="flex flex-col h-full">
            <BannerCompositionGrid
              galleryMode
              selectedId={activeCompositionId}
              onSelect={handleGallerySelect}
            />
            {/* Bottom bar */}
            <div className="shrink-0 flex items-center justify-between px-4 py-2.5 bg-zinc-900/60 border-t border-zinc-800">
              <button
                onClick={() => setStage('presets')}
                className="px-3 py-1.5 text-xs text-zinc-500 hover:text-white border border-zinc-700 rounded-lg transition-colors"
              >
                <i className="fa-solid fa-arrow-left mr-1" />
                Back to Sizes
              </button>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setShowLuckyReskin(true)}
                  className="px-4 py-1.5 text-xs font-medium bg-purple-600 hover:bg-purple-500 text-white rounded-lg transition-all shadow-lg shadow-purple-600/20 flex items-center gap-1.5"
                >
                  <i className="fa-solid fa-palette" />
                  Reskin
                </button>
                <button
                  onClick={() => setStage('sparkle')}
                  className="px-5 py-1.5 text-xs font-medium bg-amber-600 hover:bg-amber-500 text-white rounded-lg transition-all shadow-lg shadow-amber-600/20 flex items-center gap-1.5"
                >
                  <i className="fa-solid fa-wand-magic-sparkles" />
                  Continue to Fine Tune
                  <i className="fa-solid fa-arrow-right ml-1" />
                </button>
              </div>
            </div>
            {showLuckyReskin && (
              <BannerLuckyReskin onClose={() => setShowLuckyReskin(false)} />
            )}
          </div>
        )}
        {currentStage === 'edit' && editView === 'compositor' && (
          <div className="flex flex-col h-full">
            {/* Editor area */}
            <div className="flex-1 flex overflow-hidden">
              {/* Canvas */}
              <div className="flex-1 overflow-hidden">
                {activeComposition ? (
                  <BannerCanvas composition={activeComposition} />
                ) : (
                  <div className="flex items-center justify-center h-full text-zinc-500 text-sm">
                    <i className="fa-solid fa-mouse-pointer mr-2" />
                    Select a composition to edit
                  </div>
                )}
              </div>

              {/* Right side: Layers + Properties combined */}
              <div className="w-72 shrink-0 flex flex-col border-l border-zinc-800">
                <div className="flex-1 min-h-0 overflow-hidden">
                  {activeComposition && <BannerLayerPanel composition={activeComposition} />}
                </div>
                <div className="shrink-0 max-h-[50%] overflow-auto border-t border-zinc-800">
                  {activeComposition && <BannerProperties composition={activeComposition} />}
                </div>
              </div>
            </div>

            {/* Composition strip + actions */}
            <div className="shrink-0 border-t border-zinc-800 bg-zinc-900/60">
              <BannerCompositionGrid
                selectedId={activeCompositionId}
                onSelect={setActiveCompositionId}
              />
              <div className="flex items-center justify-between px-3 py-2">
                <button
                  onClick={() => setEditView('gallery')}
                  className="px-3 py-1.5 text-xs text-zinc-500 hover:text-white border border-zinc-700 rounded-lg transition-colors flex items-center gap-1.5"
                >
                  <i className="fa-solid fa-grid-2" />
                  Back to Gallery
                </button>
                <div className="flex gap-2">
                  <button
                    onClick={() => setStage('presets')}
                    className="px-3 py-1.5 text-xs text-zinc-500 hover:text-white border border-zinc-700 rounded-lg transition-colors"
                  >
                    <i className="fa-solid fa-arrow-left mr-1" />
                    Sizes
                  </button>
                  <button
                    onClick={() => setStage('sparkle')}
                    className="px-4 py-1.5 text-xs font-medium bg-amber-600 hover:bg-amber-500 text-white rounded-lg transition-all shadow-lg shadow-amber-600/20 flex items-center gap-1.5"
                  >
                    <i className="fa-solid fa-wand-magic-sparkles" />
                    Fine Tune
                    <i className="fa-solid fa-arrow-right ml-1" />
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
        {currentStage === 'sparkle' && <BannerSparklePanel />}
        {currentStage === 'export' && <BannerExportDialog />}
      </div>
    </div>
  );
};
