import React from 'react';

interface VideoFullscreenProps {
  url: string;
  onClose: () => void;
  promptText?: string;
}

export const VideoFullscreen: React.FC<VideoFullscreenProps> = ({ url, onClose, promptText }) => {
  return (
    <div
      className="fixed inset-0 z-[300] bg-black/95 flex items-center justify-center backdrop-blur-sm"
      onClick={onClose}
    >
      <button
        onClick={onClose}
        className="absolute top-6 right-6 text-zinc-400 hover:text-white text-2xl z-10 w-10 h-10 flex items-center justify-center rounded-full bg-zinc-800/50 hover:bg-zinc-700 transition-colors"
      >
        <i className="fas fa-times" />
      </button>

      <div className="flex flex-col items-center max-w-[90vw] max-h-[90vh]" onClick={e => e.stopPropagation()}>
        <video
          src={url}
          autoPlay
          loop
          controls
          className="max-w-[90vw] max-h-[85vh] rounded-lg shadow-2xl"
        />
        {promptText && (
          <div className="mt-3 text-xs text-zinc-400 font-mono max-w-lg text-center truncate">
            {promptText}
          </div>
        )}
        <a
          href={url}
          download
          className="mt-3 bg-zinc-800 hover:bg-zinc-700 text-white px-6 py-2 rounded-lg text-xs font-bold uppercase transition-colors flex items-center gap-2"
        >
          <i className="fas fa-download" /> Download
        </a>
      </div>
    </div>
  );
};
