import React, { useRef, useCallback } from 'react';
import { useApp } from '@/contexts/AppContext';
import { useAnimatix } from '@/contexts/AnimatixContext';
import { useExtractor } from '@/contexts/ExtractorContext';
import {
  collectProjectData,
  generateProjectHTML,
  parseProjectHTML,
  restoreProjectData,
} from '@/services/projectSave';
import { downloadBlob } from '@/services/export';

export const ProjectSaveLoad: React.FC = () => {
  const app = useApp();
  const animatix = useAnimatix();
  const extractor = useExtractor();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleSave = useCallback(() => {
    const data = collectProjectData({
      // Animatix
      characters: animatix.characters,
      scenes: animatix.scenes,
      style: animatix.style,
      brief: animatix.brief,
      storyTitle: animatix.storyTitle,
      sceneCount: animatix.sceneCount,
      step: animatix.step,
      isApproved: animatix.isApproved,
      animatixAspectRatio: animatix.aspectRatio,
      // Extractor
      segments: extractor.segments,
      activeSegmentId: extractor.activeSegmentId,
      modificationPrompt: extractor.modificationPrompt,
      referenceAssets: extractor.referenceAssets,
      videoAspectRatio: extractor.videoAspectRatio,
      slotState: extractor.slotState,
      characterState: extractor.characterState,
      backgroundState: extractor.backgroundState,
      symbolGenState: extractor.symbolGenState,
      compositorState: extractor.compositorState,
      // App
      assetLibrary: app.assetLibrary,
      appAspectRatio: app.aspectRatio,
    });

    const html = generateProjectHTML(data);
    const blob = new Blob([html], { type: 'text/html' });
    const safeName = (data.projectName || 'Untitled')
      .replace(/[^a-zA-Z0-9_-]/g, '_')
      .substring(0, 40);
    const dateStr = new Date().toISOString().slice(0, 10);
    downloadBlob(blob, `MegaStudio-${safeName}-${dateStr}.html`);
  }, [animatix, extractor, app]);

  const handleLoad = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = ''; // reset for re-use

    const reader = new FileReader();
    reader.onload = () => {
      const htmlStr = reader.result as string;
      const data = parseProjectHTML(htmlStr);
      if (!data) {
        alert('Could not parse project file. Make sure it was saved by Mega Design Studio.');
        return;
      }

      const confirmed = window.confirm(
        `Load project "${data.projectName}"?\n\nSaved: ${new Date(data.savedAt).toLocaleString()}\n\nThis will replace all current work.`
      );
      if (!confirmed) return;

      restoreProjectData(data, {
        // Animatix
        setCharacters: animatix.setCharacters,
        setScenes: animatix.setScenes,
        setStyle: animatix.setStyle,
        setBrief: animatix.setBrief,
        setStoryTitle: animatix.setStoryTitle,
        setSceneCount: animatix.setSceneCount,
        setStep: animatix.setStep,
        setIsApproved: animatix.setIsApproved,
        setAnimatixAspectRatio: animatix.setAspectRatio,
        // Extractor
        setSegments: extractor.setSegments,
        setActiveSegmentId: extractor.setActiveSegmentId,
        setModificationPrompt: extractor.setModificationPrompt,
        setReferenceAssets: extractor.setReferenceAssets,
        setVideoAspectRatio: extractor.setVideoAspectRatio,
        setSlotState: extractor.setSlotState,
        setCharacterState: extractor.setCharacterState,
        setBackgroundState: extractor.setBackgroundState,
        setSymbolGenState: extractor.setSymbolGenState,
        setCompositorState: extractor.setCompositorState,
        // App
        setAssetLibrary: app.setAssetLibrary,
        setAppAspectRatio: app.setAspectRatio,
      });

      // Navigate to a tab that has content
      if (data.animatix.scenes.length > 0 && data.animatix.scenes.some(s => s.imageUrl)) {
        app.setActiveTab('storyboard');
      } else if (data.extractor.symbolGenState.symbols && data.extractor.symbolGenState.symbols.length > 0) {
        app.setActiveTab('toolkit');
      } else if (data.extractor.segments.length > 0) {
        app.setActiveTab('studio');
      } else {
        app.setActiveTab('concept');
      }
    };
    reader.readAsText(file);
  }, [animatix, extractor, app]);

  return (
    <>
      <div className="flex gap-1">
        <button
          onClick={handleSave}
          className="p-2 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors"
          title="Save Project as HTML"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
          </svg>
        </button>
        <button
          onClick={handleLoad}
          className="p-2 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors"
          title="Load Project from HTML"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
          </svg>
        </button>
      </div>
      <input
        ref={fileInputRef}
        type="file"
        accept=".html,.htm"
        className="hidden"
        onChange={handleFileChange}
      />
    </>
  );
};
