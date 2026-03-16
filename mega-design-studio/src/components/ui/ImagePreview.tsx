import React from 'react';

interface ImagePreviewProps {
  src: string;
  onClose: () => void;
}

export const ImagePreview: React.FC<ImagePreviewProps> = ({ src, onClose }) => {
  return (
    <div
      className="fixed inset-0 z-[300] bg-black/95 backdrop-blur-sm flex items-center justify-center p-4 cursor-pointer"
      onClick={onClose}
    >
      <button
        onClick={onClose}
        className="absolute top-4 right-4 text-zinc-400 hover:text-white z-10"
      >
        <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
      <img
        src={src}
        className="max-w-full max-h-[90vh] object-contain rounded-lg"
        onClick={(e) => e.stopPropagation()}
        alt="Preview"
      />
    </div>
  );
};
