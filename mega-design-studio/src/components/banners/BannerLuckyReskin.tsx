import React, { useState, useCallback, useRef } from 'react';
import { useBanner } from '@/contexts/BannerContext';
import { reskinBanner } from '@/services/gemini';

interface ReskinModalProps {
  onClose: () => void;
}

/**
 * Reskin popup — lightweight config modal.
 * After generating, swaps project.sourceImage and navigates to Extract.
 * The normal extraction flow handles the rest.
 */
export const BannerLuckyReskin: React.FC<ReskinModalProps> = ({ onClose }) => {
  const { project, setProject, setStage } = useBanner();

  const [theme, setTheme] = useState('');
  const [characterRef, setCharacterRef] = useState<string | null>(null);
  const [palette, setPalette] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const charInputRef = useRef<HTMLInputElement>(null);

  const handleCharacterUpload = useCallback((file: File) => {
    if (!file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = () => setCharacterRef(reader.result as string);
    reader.readAsDataURL(file);
  }, []);

  const handleReskin = useCallback(async () => {
    if (!project?.sourceImage || !theme.trim()) return;
    setError(null);
    setIsGenerating(true);

    try {
      const reskinned = await reskinBanner(project.sourceImage, {
        theme,
        characterRef: characterRef || undefined,
        palette: palette || undefined,
      });

      // Swap source image — keep EVERYTHING (detected bboxes + extracted elements)
      // Stay on upload tab so user can preview before/after
      // Extracted elements stay — they'll be replaced when user runs "Extract New Assets"
      setProject(prev => {
        if (!prev) return null;
        return {
          ...prev,
          sourceImage: reskinned,
          originalImage: prev.originalImage || prev.sourceImage, // Keep first original
          // Keep detectedElements — bboxes still valid since layout didn't change
          // Keep extractedElements — will be replaced on next extraction
          stage: 'upload' as const, // Stay on upload tab
        };
      });

      onClose();
    } catch (err: any) {
      setError(err.message || 'Reskin failed');
    } finally {
      setIsGenerating(false);
    }
  }, [project?.sourceImage, theme, characterRef, palette, setProject, onClose]);

  if (!project) return null;

  return (
    <div className={`fixed z-[90] ${isGenerating ? 'top-4 right-4' : 'inset-0 bg-black/70 flex items-center justify-center p-6'}`}
      onClick={isGenerating ? undefined : onClose}>
      <div className={`bg-zinc-900 border border-zinc-700 rounded-2xl shadow-2xl flex flex-col overflow-hidden ${
        isGenerating ? 'w-72' : 'max-w-lg w-full'
      }`} onClick={e => e.stopPropagation()}>

        {/* When generating: compact progress toast */}
        {isGenerating ? (
          <div className="px-4 py-3 flex items-center gap-3">
            <i className="fa-solid fa-spinner fa-spin text-purple-400" />
            <div className="flex-1 min-w-0">
              <div className="text-xs font-medium text-white">Reskinning banner...</div>
              <div className="text-[9px] text-zinc-500 truncate">{theme}</div>
            </div>
          </div>
        ) : (
        <>
        {/* Header */}
        <div className="px-5 py-4 border-b border-zinc-800 flex items-center justify-between">
          <h3 className="text-sm font-bold text-white flex items-center gap-2">
            <i className="fa-solid fa-palette text-purple-400" />
            Reskin Banner
          </h3>
          <button onClick={onClose} disabled={isGenerating}
            className="w-7 h-7 rounded-full bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-white flex items-center justify-center transition-colors disabled:opacity-50">
            <i className="fa-solid fa-xmark text-xs" />
          </button>
        </div>

        {/* Config */}
        <div className="px-5 py-4 flex flex-col gap-4">
          <div>
            <label className="text-xs font-semibold text-zinc-300 block mb-1">
              <i className="fa-solid fa-wand-magic-sparkles mr-1 text-purple-400" /> New Theme
            </label>
            <input type="text" value={theme} onChange={e => setTheme(e.target.value)}
              placeholder="e.g. Norse mythology, Underwater kingdom, Cyberpunk city..."
              className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-500 focus:border-purple-500 focus:outline-none"
              disabled={isGenerating} />
          </div>

          <div className="flex gap-4">
            <div className="flex-1">
              <label className="text-xs font-semibold text-zinc-300 block mb-1">
                <i className="fa-solid fa-user mr-1 text-blue-400" /> Character <span className="text-zinc-600 font-normal">(opt.)</span>
              </label>
              <div className="flex gap-2 items-start">
                {characterRef ? (
                  <div className="relative w-12 h-12 rounded-lg overflow-hidden border border-zinc-700">
                    <img src={characterRef} alt="" className="w-full h-full object-cover" />
                    <button onClick={() => setCharacterRef(null)} className="absolute top-0 right-0 w-3.5 h-3.5 rounded-full bg-red-600 text-white text-[7px] flex items-center justify-center">
                      <i className="fa-solid fa-xmark" />
                    </button>
                  </div>
                ) : (
                  <button onClick={() => charInputRef.current?.click()} disabled={isGenerating}
                    className="w-12 h-12 rounded-lg border-2 border-dashed border-zinc-700 hover:border-zinc-500 flex flex-col items-center justify-center text-zinc-500 hover:text-zinc-300 transition-colors">
                    <i className="fa-solid fa-plus text-[9px]" />
                  </button>
                )}
                <input ref={charInputRef} type="file" accept="image/*" className="hidden"
                  onChange={e => { const f = e.target.files?.[0]; if (f) handleCharacterUpload(f); }} />
              </div>
            </div>
            <div className="flex-1">
              <label className="text-xs font-semibold text-zinc-300 block mb-1">
                <i className="fa-solid fa-swatchbook mr-1 text-amber-400" /> Palette <span className="text-zinc-600 font-normal">(opt.)</span>
              </label>
              <input type="text" value={palette} onChange={e => setPalette(e.target.value)}
                placeholder="e.g. Blue and gold..."
                className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-2.5 py-2 text-xs text-white placeholder-zinc-500 focus:border-amber-500 focus:outline-none"
                disabled={isGenerating} />
            </div>
          </div>

          {error && (
            <div className="flex items-center gap-2 px-3 py-2 bg-red-900/20 border border-red-800/40 rounded-lg text-xs text-red-400">
              <i className="fa-solid fa-circle-exclamation" />
              <span className="flex-1">{error}</span>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-zinc-800 flex items-center justify-between">
          <button onClick={onClose} disabled={isGenerating}
            className="px-3 py-1.5 text-xs text-zinc-500 hover:text-white border border-zinc-700 rounded-lg transition-colors disabled:opacity-50">
            Cancel
          </button>
          <button disabled={!theme.trim() || isGenerating} onClick={handleReskin}
            className={`px-5 py-2 text-xs font-medium rounded-lg transition-all shadow-lg flex items-center gap-2 ${
              theme.trim() && !isGenerating
                ? 'bg-purple-600 hover:bg-purple-500 text-white shadow-purple-600/20'
                : 'bg-zinc-700 text-zinc-500 cursor-not-allowed shadow-none'
            }`}>
            <i className="fa-solid fa-palette" /> Reskin
          </button>
        </div>
        </>
        )}
      </div>
    </div>
  );
};
