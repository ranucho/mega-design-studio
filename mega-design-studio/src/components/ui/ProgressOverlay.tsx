import React from 'react';
import { LoadingSpinner } from './LoadingSpinner';

interface ProgressOverlayProps {
  isOpen: boolean;
  text: string;
  progress?: number;
  onCancel?: () => void;
}

export const ProgressOverlay: React.FC<ProgressOverlayProps> = ({ isOpen, text, progress, onCancel }) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[250] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-8 max-w-sm w-full text-center space-y-4">
        <LoadingSpinner size="lg" />
        <p className="text-white font-medium">{text}</p>
        {progress !== undefined && (
          <div className="w-full bg-zinc-800 rounded-full h-2">
            <div
              className="bg-indigo-500 h-2 rounded-full transition-all duration-300"
              style={{ width: `${Math.min(100, progress)}%` }}
            />
          </div>
        )}
        {onCancel && (
          <button
            onClick={onCancel}
            className="text-sm text-zinc-400 hover:text-white transition-colors"
          >
            Cancel
          </button>
        )}
      </div>
    </div>
  );
};
