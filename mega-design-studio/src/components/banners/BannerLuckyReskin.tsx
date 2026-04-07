import React, { useState, useCallback, useRef, useMemo } from 'react';
import { useBanner } from '@/contexts/BannerContext';
import { reskinBanner } from '@/services/gemini';
import { useToast } from '@/components/shared/Toast';

interface ReskinModalProps {
  onClose: () => void;
}

/**
 * Extended reskin dialog — modal version with all options.
 * After generating, swaps project.sourceImage IN PLACE and stays on current stage.
 * Keeps detected/extracted elements so existing compositions continue to work.
 */
export const BannerLuckyReskin: React.FC<ReskinModalProps> = ({ onClose }) => {
  const { project, setProject } = useBanner();
  const { toast } = useToast();

  const [theme, setTheme] = useState('');
  const [characterRef, setCharacterRef] = useState<string | null>(null);
  const [palette, setPalette] = useState('');
  const [negativePrompts, setNegativePrompts] = useState('');
  const [textChanges, setTextChanges] = useState<Record<string, string>>({});
  const [showNegative, setShowNegative] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const charInputRef = useRef<HTMLInputElement>(null);

  const detectedTexts = useMemo(
    () => (project?.extractedElements ?? [])
      .filter(el => el.detectedText)
      .map(el => ({ id: el.id, label: el.label, text: el.detectedText! })),
    [project?.extractedElements],
  );

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
      const themeWithNegatives = negativePrompts.trim()
        ? `${theme}\n\nNEGATIVE PROMPTS (avoid these): ${negativePrompts.trim()}`
        : theme;

      const reskinned = await reskinBanner(project.sourceImage, {
        theme: themeWithNegatives,
        characterRef: characterRef || undefined,
        palette: palette || undefined,
        textChanges: Object.keys(textChanges).length > 0 ? textChanges : undefined,
      });

      // Swap source image — keep EVERYTHING (detected bboxes + extracted elements)
      // Stay on current stage so user can preview before/after
      setProject(prev => {
        if (!prev) return null;
        return {
          ...prev,
          sourceImage: reskinned,
          originalImage: prev.originalImage || prev.sourceImage, // Keep first original
        };
      });

      toast('Banner reskinned', { type: 'success' });
      onClose();
    } catch (err: any) {
      setError(err.message || 'Reskin failed');
      toast('Banner reskin failed', { type: 'error' });
    } finally {
      setIsGenerating(false);
    }
  }, [project?.sourceImage, theme, characterRef, palette, negativePrompts, textChanges, setProject, onClose, toast]);

  if (!project) return null;

  // Floating progress pill while generating
  if (isGenerating) {
    return (
      <div className="fixed top-4 right-4 z-[90] bg-zinc-900 border border-zinc-700 rounded-2xl shadow-2xl w-72">
        <div className="px-4 py-3 flex items-center gap-3">
          <i className="fa-solid fa-spinner fa-spin text-purple-400" />
          <div className="flex-1 min-w-0">
            <div className="text-xs font-medium text-white">Reskinning banner...</div>
            <div className="text-[9px] text-zinc-400 truncate">{theme}</div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[90] bg-black/70 flex items-center justify-center p-6" onClick={onClose}>
      <div
        className="bg-zinc-900 border border-zinc-700 rounded-2xl shadow-2xl flex flex-col overflow-hidden max-w-3xl w-full max-h-[90vh]"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-zinc-800 flex items-center justify-between shrink-0">
          <div>
            <h3 className="text-base font-bold text-white flex items-center gap-2">
              <i className="fa-solid fa-palette text-purple-400" />
              Reskin Banner
            </h3>
            <p className="text-xs text-zinc-400 mt-0.5">
              Transform your banner with a new theme while maintaining the original layout
            </p>
          </div>
          <button onClick={onClose}
            className="w-7 h-7 rounded-full bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-white flex items-center justify-center transition-colors shrink-0">
            <i className="fa-solid fa-xmark text-xs" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-auto px-5 py-4 flex flex-col gap-4">
          {/* Source preview */}
          <div className="rounded-xl overflow-hidden border border-zinc-700 bg-zinc-900">
            <img src={project.sourceImage} alt="Source" className="w-full h-auto max-h-48 object-contain" />
            <div className="px-3 py-1.5 border-t border-zinc-700/50 text-[10px] text-zinc-400">
              Original — {project.sourceWidth}x{project.sourceHeight}
            </div>
          </div>

          {/* Theme */}
          <div className="bg-zinc-900/50 rounded-xl border border-zinc-800 p-4">
            <label className="text-sm font-semibold text-zinc-300 block mb-2">
              <i className="fa-solid fa-wand-magic-sparkles mr-2 text-purple-400" />
              New Theme / Setting
            </label>
            <input type="text" value={theme} onChange={e => setTheme(e.target.value)}
              placeholder="e.g. Norse mythology, Underwater kingdom, Cyberpunk city, Ancient Egypt..."
              className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2.5 text-sm text-white placeholder-zinc-500 focus:border-purple-500 focus:outline-none transition-colors" />
          </div>

          {/* Negative Prompts (collapsible) */}
          <div className="bg-zinc-900/50 rounded-xl border border-zinc-800 p-4">
            <button
              onClick={() => setShowNegative(v => !v)}
              className="w-full flex items-center justify-between text-sm font-semibold text-zinc-300 hover:text-white transition-colors"
            >
              <span>
                <i className="fa-solid fa-ban mr-2 text-red-400" />
                Negative Prompts (optional)
              </span>
              <i className={`fa-solid ${showNegative ? 'fa-chevron-up' : 'fa-chevron-down'} text-xs text-zinc-500`} />
            </button>
            {showNegative && (
              <div className="mt-3">
                <p className="text-xs text-zinc-400 mb-2">Things the AI should avoid in the reskin</p>
                <textarea
                  value={negativePrompts}
                  onChange={e => setNegativePrompts(e.target.value)}
                  placeholder="e.g. dollar signs, actual banknotes, violence, text artifacts..."
                  rows={3}
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2.5 text-sm text-white placeholder-zinc-500 focus:border-red-500 focus:outline-none transition-colors resize-none"
                />
              </div>
            )}
          </div>

          {/* Character + Palette row */}
          <div className="grid grid-cols-2 gap-4">
            {/* Character Reference */}
            <div className="bg-zinc-900/50 rounded-xl border border-zinc-800 p-4">
              <label className="text-sm font-semibold text-zinc-300 block mb-2">
                <i className="fa-solid fa-user mr-2 text-blue-400" />
                Character Ref <span className="text-zinc-500 font-normal text-xs">(optional)</span>
              </label>
              <div className="flex gap-3 items-start">
                {characterRef ? (
                  <div className="relative w-20 h-20 rounded-lg overflow-hidden border border-zinc-700">
                    <img src={characterRef} alt="Character ref" className="w-full h-full object-cover" />
                    <button onClick={() => setCharacterRef(null)}
                      className="absolute top-1 right-1 w-5 h-5 rounded-full bg-red-600 text-white text-[9px] flex items-center justify-center">
                      <i className="fa-solid fa-xmark" />
                    </button>
                  </div>
                ) : (
                  <button onClick={() => charInputRef.current?.click()}
                    className="w-20 h-20 rounded-lg border-2 border-dashed border-zinc-700 hover:border-zinc-500 flex flex-col items-center justify-center gap-1 text-zinc-400 hover:text-zinc-300 transition-colors">
                    <i className="fa-solid fa-plus" />
                    <span className="text-[9px]">Upload</span>
                  </button>
                )}
                <input ref={charInputRef} type="file" accept="image/*" className="hidden"
                  onChange={e => { const f = e.target.files?.[0]; if (f) handleCharacterUpload(f); }} />
              </div>
            </div>

            {/* Palette */}
            <div className="bg-zinc-900/50 rounded-xl border border-zinc-800 p-4">
              <label className="text-sm font-semibold text-zinc-300 block mb-2">
                <i className="fa-solid fa-swatchbook mr-2 text-amber-400" />
                Color Palette <span className="text-zinc-500 font-normal text-xs">(optional)</span>
              </label>
              <input type="text" value={palette} onChange={e => setPalette(e.target.value)}
                placeholder="e.g. Deep blue and gold..."
                className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2.5 text-sm text-white placeholder-zinc-500 focus:border-amber-500 focus:outline-none transition-colors" />
            </div>
          </div>

          {/* Text Changes */}
          {detectedTexts.length > 0 && (
            <div className="bg-zinc-900/50 rounded-xl border border-zinc-800 p-4">
              <label className="text-sm font-semibold text-zinc-300 block mb-3">
                <i className="fa-solid fa-font mr-2 text-green-400" />
                Text Changes <span className="text-zinc-500 font-normal text-xs">(optional)</span>
              </label>
              <div className="flex flex-col gap-2">
                {detectedTexts.map(dt => (
                  <div key={dt.id} className="flex items-center gap-2">
                    <span className="text-xs text-zinc-400 w-28 truncate shrink-0" title={dt.label}>
                      {dt.label}:
                    </span>
                    <span className="text-xs text-zinc-400 w-32 truncate shrink-0">"{dt.text}"</span>
                    <i className="fa-solid fa-arrow-right text-[8px] text-zinc-700" />
                    <input
                      type="text"
                      value={textChanges[dt.text] ?? ''}
                      onChange={e => setTextChanges(prev => ({ ...prev, [dt.text]: e.target.value }))}
                      placeholder={dt.text}
                      className="flex-1 bg-zinc-800 border border-zinc-700 rounded px-2 py-1.5 text-xs text-white placeholder-zinc-600 focus:border-green-500 focus:outline-none transition-colors"
                    />
                  </div>
                ))}
              </div>
            </div>
          )}

          {error && (
            <div className="flex items-center gap-2 px-3 py-2 bg-red-900/20 border border-red-800/40 rounded-lg text-xs text-red-400">
              <i className="fa-solid fa-circle-exclamation" />
              <span className="flex-1">{error}</span>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-zinc-800 flex items-center justify-between shrink-0">
          <button onClick={onClose}
            className="px-3 py-1.5 text-xs text-zinc-400 hover:text-white border border-zinc-700 rounded-lg transition-colors">
            Cancel
          </button>
          <button disabled={!theme.trim()} onClick={handleReskin}
            className={`px-5 py-2 text-sm font-medium rounded-lg transition-all shadow-lg flex items-center gap-2 ${
              theme.trim()
                ? 'bg-purple-600 hover:bg-purple-500 text-white shadow-purple-600/20'
                : 'bg-zinc-700 text-zinc-400 cursor-not-allowed shadow-none'
            }`}>
            <i className="fa-solid fa-wand-magic-sparkles" /> Generate Reskin
          </button>
        </div>
      </div>
    </div>
  );
};
