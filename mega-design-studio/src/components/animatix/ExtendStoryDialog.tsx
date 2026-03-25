import React, { useState, useEffect } from 'react';
import { useAnimatix } from '@/contexts/AnimatixContext';
import { Button } from '@/components/ui/Button';
import { AspectRatioSelector } from '@/components/shared/AspectRatioSelector';

interface ExtendStoryDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onGenerate: (brief: string, sceneCount: number, aspectRatio: string) => void;
}

export const ExtendStoryDialog: React.FC<ExtendStoryDialogProps> = ({
  isOpen,
  onClose,
  onGenerate,
}) => {
  const { aspectRatio: currentAspectRatio } = useAnimatix();

  const [brief, setBrief] = useState('');
  const [sceneCount, setSceneCount] = useState(3);
  const [aspectRatio, setAspectRatio] = useState(currentAspectRatio);

  // Sync local aspect ratio when context value changes or dialog opens
  useEffect(() => {
    if (isOpen) {
      setAspectRatio(currentAspectRatio);
    }
  }, [isOpen, currentAspectRatio]);

  // Reset brief when dialog closes
  useEffect(() => {
    if (!isOpen) {
      setBrief('');
      setSceneCount(3);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (brief.trim()) {
      onGenerate(brief, sceneCount, aspectRatio);
      setBrief('');
    }
  };

  return (
    <div className="fixed inset-0 z-[200] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 animate-fade-in">
      <div className="bg-zinc-900 border border-zinc-700 rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden flex flex-col">
        {/* Header */}
        <div className="p-6 border-b border-zinc-800 flex justify-between items-center">
          <h3 className="text-xl font-bold text-white flex items-center gap-2">
            Generate New Chapter
          </h3>
          <button onClick={onClose} className="text-zinc-400 hover:text-white">
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-6 space-y-6">
          {/* Info banner */}
          <div className="bg-indigo-900/20 border border-indigo-500/30 p-4 rounded-lg text-sm text-indigo-200">
            <p>
              This will generate new scenes based on your brief and{' '}
              <strong>append them to the end</strong> of your current storyboard.
              Your existing characters and style will be preserved.
            </p>
          </div>

          {/* Brief textarea */}
          <div>
            <label className="block text-sm font-medium text-zinc-400 mb-2">
              What happens next?
            </label>
            <textarea
              className="w-full bg-zinc-950 border border-zinc-700 rounded-lg p-3 text-white focus:border-indigo-500 outline-none resize-none h-32"
              placeholder="Describe the next events in the story..."
              value={brief}
              onChange={(e) => setBrief(e.target.value)}
              required
              autoFocus
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            {/* Scene count selector */}
            <div>
              <label className="block text-sm font-medium text-zinc-400 mb-2">
                Scenes to Add
              </label>
              <div className="flex gap-2">
                {[1, 2, 3, 4, 5, 6].map((num) => (
                  <button
                    key={num}
                    type="button"
                    onClick={() => setSceneCount(num)}
                    className={`flex-1 h-10 rounded-lg font-bold transition-all ${
                      sceneCount === num
                        ? 'bg-indigo-600 text-white ring-2 ring-indigo-400'
                        : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'
                    }`}
                  >
                    {num}
                  </button>
                ))}
              </div>
            </div>

            {/* Aspect ratio dropdown */}
            <div>
              <label className="block text-sm font-medium text-zinc-400 mb-2">
                Aspect Ratio
              </label>
              <AspectRatioSelector
                value={aspectRatio}
                onChange={setAspectRatio}
                options={['16:9', '9:16', '1:1']}
              />
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex justify-end gap-3 pt-2">
            <Button variant="ghost" onClick={onClose} type="button">
              Cancel
            </Button>
            <Button variant="primary" type="submit" disabled={!brief.trim()}>
              Generate &amp; Append
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
};
