import React, { useRef, useState, useCallback } from 'react';
import { useBanner } from '@/contexts/BannerContext';
import { BannerMode } from '@/types';

export const BannerUpload: React.FC = () => {
  const { project, initProject, setStage, resetProject } = useBanner();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [mode, setMode] = useState<BannerMode>('resize');

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
        <div className="relative rounded-xl overflow-hidden border border-zinc-700 bg-zinc-900 shadow-lg">
          <img
            src={project.sourceImage}
            alt="Source banner"
            className="max-h-[400px] w-auto object-contain"
          />
          <div className="absolute top-3 right-3 bg-black/70 text-xs text-zinc-300 px-2 py-1 rounded">
            {project.sourceWidth} x {project.sourceHeight}
          </div>
        </div>

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
