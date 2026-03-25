import React, { useRef, useState, useCallback } from 'react';
import { useBanner } from '@/contexts/BannerContext';
import { BannerLuckyReskin } from './BannerLuckyReskin';
import { BannerMode } from '@/types';

export const BannerUpload: React.FC = () => {
  const { project, initProject, setStage, resetProject } = useBanner();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [mode, setMode] = useState<BannerMode>('resize');
  const [showLuckyReskin, setShowLuckyReskin] = useState(false);
  const [showBeforeAfter, setShowBeforeAfter] = useState(false);

  const hasCompositions = (project?.compositions?.length ?? 0) > 0;
  const isReskinned = !!project?.originalImage;

  const handleFile = useCallback((file: File) => {
    if (!file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      const img = new Image();
      img.onload = () => {
        initProject(dataUrl, img.naturalWidth, img.naturalHeight, mode);
      };
      img.src = dataUrl;
    };
    reader.readAsDataURL(file);
  }, [initProject, mode]);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }, [handleFile]);

  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(true);
  }, []);

  const onDragLeave = useCallback(() => setDragOver(false), []);

  // If we have a source image, show preview + proceed button
  if (project?.sourceImage) {
    return (
      <div className="flex flex-col items-center gap-6 p-8 max-w-3xl mx-auto">
        {/* Banner preview — click to see before/after when reskinned */}
        <div
          className={`relative rounded-xl overflow-hidden border bg-zinc-900 shadow-lg ${
            isReskinned ? 'border-purple-600/50 cursor-pointer' : 'border-zinc-700'
          }`}
          onClick={isReskinned ? () => setShowBeforeAfter(true) : undefined}
        >
          <img
            src={project.sourceImage}
            alt="Source banner"
            className="max-h-[400px] w-auto object-contain"
          />
          <div className="absolute top-3 right-3 bg-black/70 text-xs text-zinc-300 px-2 py-1 rounded">
            {project.sourceWidth} x {project.sourceHeight}
          </div>
          {isReskinned && (
            <div className="absolute bottom-3 left-3 flex items-center gap-2">
              <span className="px-2.5 py-1 rounded-lg bg-purple-600/90 text-[10px] font-bold text-white backdrop-blur-sm">
                <i className="fa-solid fa-palette mr-1" /> Reskinned
              </span>
              <span className="px-2.5 py-1 rounded-lg bg-black/60 text-[10px] text-zinc-300 backdrop-blur-sm">
                Click to compare
              </span>
            </div>
          )}
        </div>

        {/* Before/After lightbox */}
        {showBeforeAfter && project.originalImage && (
          <div className="fixed inset-0 z-[90] bg-black/90 flex items-center justify-center p-8 cursor-pointer" onClick={() => setShowBeforeAfter(false)}>
            <div className="relative max-w-[90vw] max-h-[85vh] flex flex-col items-center gap-4" onClick={e => e.stopPropagation()}>
              <button onClick={() => setShowBeforeAfter(false)}
                className="absolute -top-2 -right-2 z-10 w-8 h-8 rounded-full bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-white flex items-center justify-center">
                <i className="fa-solid fa-xmark" />
              </button>
              <div className="flex items-start gap-6 overflow-auto">
                <div className="flex flex-col items-center gap-2">
                  <span className="text-xs text-zinc-500 uppercase tracking-wider">Before (Original)</span>
                  <img src={project.originalImage} alt="Original" className="rounded-lg border border-zinc-700/50 shadow-2xl"
                    style={{ maxHeight: '70vh', maxWidth: '42vw', objectFit: 'contain' }} />
                </div>
                <div className="flex flex-col items-center gap-2">
                  <span className="text-xs text-purple-400 uppercase tracking-wider font-medium">After (Reskinned)</span>
                  <img src={project.sourceImage} alt="Reskinned" className="rounded-lg border border-purple-600/30 shadow-2xl"
                    style={{ maxHeight: '70vh', maxWidth: '42vw', objectFit: 'contain' }} />
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Mode selector */}
        <div className="flex gap-2 bg-zinc-900 rounded-lg p-1 border border-zinc-700">
          <button
            onClick={() => setMode('resize')}
            className={`px-4 py-2 text-sm rounded-md transition-all ${
              mode === 'resize'
                ? 'bg-cyan-600 text-white shadow'
                : 'text-zinc-400 hover:text-white'
            }`}
          >
            <i className="fa-solid fa-arrows-left-right-to-line mr-2" />
            Resize & Adapt
          </button>
          <button
            onClick={() => setMode('reskin')}
            className={`px-4 py-2 text-sm rounded-md transition-all ${
              mode === 'reskin'
                ? 'bg-purple-600 text-white shadow'
                : 'text-zinc-400 hover:text-white'
            }`}
          >
            <i className="fa-solid fa-palette mr-2" />
            Reskin
          </button>
        </div>

        <div className="flex gap-3">
          <button
            onClick={() => resetProject()}
            className="px-4 py-2 text-sm text-zinc-400 hover:text-white border border-zinc-700 rounded-lg transition-colors"
          >
            Choose Different Image
          </button>
          {hasCompositions && (
            <button
              onClick={() => setShowLuckyReskin(true)}
              className="px-5 py-2 text-sm font-medium bg-purple-600 hover:bg-purple-500 text-white rounded-lg transition-all shadow-lg shadow-purple-600/20 flex items-center gap-1.5"
            >
              <i className="fa-solid fa-palette" />
              Reskin
            </button>
          )}
          <button
            onClick={() => setStage(mode === 'reskin' ? 'reskin' : 'extract')}
            className={`px-6 py-2 text-sm font-medium text-white rounded-lg transition-colors shadow-lg ${
              mode === 'reskin'
                ? 'bg-purple-600 hover:bg-purple-500 shadow-purple-600/20'
                : 'bg-cyan-600 hover:bg-cyan-500 shadow-cyan-600/20'
            }`}
          >
            Continue
            <i className="fa-solid fa-arrow-right ml-2" />
          </button>
        </div>
        {showLuckyReskin && (
          <BannerLuckyReskin onClose={() => setShowLuckyReskin(false)} />
        )}
      </div>
    );
  }

  // Upload drop zone
  return (
    <div className="flex flex-col items-center gap-6 p-8 max-w-2xl mx-auto">
      <div className="text-center mb-2">
        <h2 className="text-2xl font-bold text-white mb-2">Banner Studio</h2>
        <p className="text-zinc-400 text-sm">
          Upload a banner to resize it across 36+ sizes or reskin it with a new theme
        </p>
      </div>

      <div
        className={`w-full aspect-[16/9] rounded-xl border-2 border-dashed transition-all cursor-pointer flex flex-col items-center justify-center gap-4 ${
          dragOver
            ? 'border-cyan-400 bg-cyan-400/5 scale-[1.01]'
            : 'border-zinc-600 hover:border-zinc-500 bg-zinc-900/50'
        }`}
        onClick={() => fileInputRef.current?.click()}
        onDrop={onDrop}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
      >
        <div className={`w-16 h-16 rounded-full flex items-center justify-center transition-colors ${
          dragOver ? 'bg-cyan-500/20' : 'bg-zinc-800'
        }`}>
          <i className={`fa-solid fa-cloud-arrow-up text-2xl ${
            dragOver ? 'text-cyan-400' : 'text-zinc-500'
          }`} />
        </div>
        <div className="text-center">
          <p className="text-sm text-zinc-300">
            Drop a banner image here or <span className="text-cyan-400 underline underline-offset-2">browse</span>
          </p>
          <p className="text-xs text-zinc-500 mt-1">PNG, JPG, WebP</p>
        </div>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={e => {
          const file = e.target.files?.[0];
          if (file) handleFile(file);
        }}
      />
    </div>
  );
};
