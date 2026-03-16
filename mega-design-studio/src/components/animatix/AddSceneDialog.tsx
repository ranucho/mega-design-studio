import React, { useState, useRef, useEffect } from 'react';
import { Character } from '@/types';
import { Button } from '@/components/ui/Button';

declare global {
  interface Window {
    Cropper: any;
  }
}

interface AddSceneDialogProps {
  characters: Character[];
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (description: string, dialogue: string, actionPrompt: string, selectedCharacterIds: string[], image?: string) => void;
  title: string;
  aspectRatio: string;
}

const ImageCropper: React.FC<{
  imageSrc: string;
  aspectRatio: string;
  onCancel: () => void;
  onApply: (croppedImage: string) => void;
}> = ({ imageSrc, aspectRatio, onCancel, onApply }) => {
  const imageRef = useRef<HTMLImageElement>(null);
  const cropperRef = useRef<any>(null);
  const [zoomLevel, setZoomLevel] = useState(1);

  const ratioParts = aspectRatio.split(':').map(Number);
  const numericRatio = ratioParts[0] / ratioParts[1];

  useEffect(() => {
    if (imageRef.current && window.Cropper) {
      cropperRef.current = new window.Cropper(imageRef.current, {
        aspectRatio: numericRatio,
        viewMode: 0,
        dragMode: 'move',
        autoCropArea: 0.8,
        restore: false,
        guides: true,
        center: true,
        highlight: false,
        cropBoxMovable: true,
        cropBoxResizable: true,
        toggleDragModeOnDblclick: false,
        background: false,
        minContainerWidth: 300,
        minContainerHeight: 300,
        ready() {
          const data = this.cropper.getImageData();
          setZoomLevel(data.scaleX);
        },
        zoom(e: any) {
          setZoomLevel(e.detail.ratio);
        }
      });
    }

    return () => {
      if (cropperRef.current) {
        cropperRef.current.destroy();
      }
    };
  }, [imageSrc, numericRatio]);

  const handleCrop = () => {
    if (cropperRef.current) {
      const canvas = cropperRef.current.getCroppedCanvas({
        width: numericRatio >= 1 ? 1920 : 1080,
        fillColor: '#000',
        imageSmoothingEnabled: true,
        imageSmoothingQuality: 'high',
      });
      onApply(canvas.toDataURL('image/png'));
    }
  };

  const rotate = (deg: number) => {
    cropperRef.current?.rotate(deg);
  };

  const handleZoomSlide = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseFloat(e.target.value);
    setZoomLevel(val);
    cropperRef.current?.zoomTo(val);
  };

  const reset = () => {
    cropperRef.current?.reset();
  };

  return (
    <div className="absolute inset-0 bg-zinc-900 z-50 flex flex-col animate-fade-in">
      <div className="p-4 border-b border-zinc-800 flex justify-between items-center bg-zinc-900 shrink-0">
        <h3 className="font-bold text-white">Adjust Image</h3>
        <div className="flex gap-2">
          <Button variant="ghost" onClick={onCancel} className="text-xs py-1 px-3">Cancel</Button>
          <Button onClick={handleCrop} className="text-xs py-1 px-3">Done</Button>
        </div>
      </div>

      <div className="flex-1 bg-black relative overflow-hidden flex items-center justify-center p-4">
        <div className="w-full h-full">
          <img ref={imageRef} src={imageSrc} alt="Crop target" className="max-w-full block" style={{ display: 'block', maxWidth: '100%' }} />
        </div>
      </div>

      <div className="p-3 bg-zinc-900 border-t border-zinc-800 flex flex-col gap-3 shrink-0">
        <div className="flex items-center gap-4 px-4">
          <svg className="w-4 h-4 text-zinc-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 12H4" /></svg>
          <input
            type="range" min="0.1" max="3" step="0.05"
            value={zoomLevel} onChange={handleZoomSlide}
            className="flex-1 h-2 bg-zinc-700 rounded-lg appearance-none cursor-pointer accent-indigo-500"
          />
          <svg className="w-5 h-5 text-zinc-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
        </div>
        <div className="flex justify-center gap-4">
          <button onClick={() => rotate(-90)} className="p-2 text-zinc-400 hover:text-white bg-zinc-800 rounded-lg" title="Rotate Left">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" /></svg>
          </button>
          <button onClick={reset} className="p-2 text-zinc-400 hover:text-white bg-zinc-800 rounded-lg font-bold text-xs uppercase px-4">
            Reset
          </button>
          <button onClick={() => rotate(90)} className="p-2 text-zinc-400 hover:text-white bg-zinc-800 rounded-lg" title="Rotate Right">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 10h-10a8 8 0 00-8 8v2M21 10l-6 6m6-6l-6-6" /></svg>
          </button>
        </div>
      </div>
    </div>
  );
};

export const AddSceneDialog: React.FC<AddSceneDialogProps> = ({
  characters, isOpen, onClose, onSubmit, title, aspectRatio
}) => {
  const [description, setDescription] = useState("");
  const [dialogue, setDialogue] = useState("");
  const [actionPrompt, setActionPrompt] = useState("");
  const [selectedCharIds, setSelectedCharIds] = useState<string[]>([]);
  const [uploadedImageRaw, setUploadedImageRaw] = useState<string | null>(null);
  const [croppedImage, setCroppedImage] = useState<string | null>(null);
  const [isCropping, setIsCropping] = useState(false);

  useEffect(() => {
    if (!isOpen) {
      setDescription("");
      setDialogue("");
      setActionPrompt("");
      setSelectedCharIds([]);
      setUploadedImageRaw(null);
      setCroppedImage(null);
      setIsCropping(false);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const toggleCharacter = (id: string) => {
    setSelectedCharIds(prev =>
      prev.includes(id) ? prev.filter(c => c !== id) : [...prev, id]
    );
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = () => {
        setUploadedImageRaw(reader.result as string);
        setIsCropping(true);
      };
      reader.readAsDataURL(file);
    }
    e.target.value = '';
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (description.trim()) {
      onSubmit(description, dialogue, actionPrompt, selectedCharIds, croppedImage || undefined);
    }
  };

  return (
    <div className="fixed inset-0 z-[200] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 animate-fade-in">
      <div className="bg-zinc-900 border border-zinc-700 rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden relative flex flex-col max-h-[90vh]">

        {isCropping && uploadedImageRaw && (
          <ImageCropper
            imageSrc={uploadedImageRaw}
            aspectRatio={aspectRatio}
            onCancel={() => { setIsCropping(false); setUploadedImageRaw(null); }}
            onApply={(img) => { setCroppedImage(img); setIsCropping(false); }}
          />
        )}

        <div className="p-6 border-b border-zinc-800 flex justify-between items-center shrink-0">
          <h3 className="text-xl font-bold text-white">{title}</h3>
          <button onClick={onClose} className="text-zinc-400 hover:text-white">
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-6 overflow-y-auto custom-scrollbar">
          {/* Character Selection */}
          <div>
            <label className="block text-sm font-medium text-zinc-400 mb-3">Who is in this scene?</label>
            <div className="grid grid-cols-2 gap-3">
              {characters.map(char => (
                <div
                  key={char.id}
                  onClick={() => toggleCharacter(char.id)}
                  className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-all ${
                    selectedCharIds.includes(char.id)
                      ? 'bg-indigo-900/40 border-indigo-500 ring-1 ring-indigo-500/50'
                      : 'bg-zinc-950 border-zinc-800 hover:border-zinc-600'
                  }`}
                >
                  <div className={`w-5 h-5 rounded border flex items-center justify-center ${
                    selectedCharIds.includes(char.id) ? 'bg-indigo-500 border-indigo-500' : 'border-zinc-600'
                  }`}>
                    {selectedCharIds.includes(char.id) && (
                      <svg className="w-3.5 h-3.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                  </div>
                  <div className="flex items-center gap-2 overflow-hidden">
                    {char.referenceImage && (
                      <img src={char.referenceImage} alt="" className="w-6 h-6 rounded-full object-cover" />
                    )}
                    <span className={`text-sm font-medium truncate ${selectedCharIds.includes(char.id) ? 'text-white' : 'text-zinc-400'}`}>
                      {char.name}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Image Upload */}
          <div>
            <label className="block text-sm font-medium text-zinc-400 mb-2">Reference Image / Sketch (Optional)</label>
            {!croppedImage ? (
              <label className="flex items-center justify-center w-full h-24 border-2 border-dashed border-zinc-700 rounded-lg hover:border-indigo-500 hover:bg-zinc-800/50 transition-colors cursor-pointer group">
                <div className="flex flex-col items-center gap-1">
                  <svg className="w-6 h-6 text-zinc-500 group-hover:text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                  <span className="text-xs text-zinc-500 font-medium">Click to upload & crop</span>
                </div>
                <input type="file" accept="image/*" className="hidden" onChange={handleImageUpload} />
              </label>
            ) : (
              <div className="relative w-full aspect-video bg-black rounded-lg overflow-hidden group border border-zinc-700">
                <img src={croppedImage} alt="Scene Preview" className="w-full h-full object-contain" />
                <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-3">
                  <button
                    type="button"
                    onClick={() => { setUploadedImageRaw(croppedImage); setIsCropping(true); }}
                    className="px-3 py-1 bg-indigo-600 text-white rounded-full text-xs font-bold hover:scale-105 transition-transform"
                  >
                    Adjust Crop
                  </button>
                  <button
                    type="button"
                    onClick={() => setCroppedImage(null)}
                    className="px-3 py-1 bg-red-600 text-white rounded-full text-xs font-bold hover:scale-105 transition-transform"
                  >
                    Remove
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Description */}
          <div>
            <label className="block text-sm font-medium text-zinc-400 mb-2">Visual Description (Image)</label>
            <textarea
              className="w-full bg-zinc-950 border border-zinc-700 rounded-lg p-3 text-white focus:border-indigo-500 outline-none resize-none h-20"
              placeholder="Describe the action, setting, and camera angle for the image generation..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              required
            />
          </div>

          {/* Action Prompt */}
          <div>
            <label className="block text-sm font-medium text-zinc-400 mb-2">Motion Prompt (Video Action)</label>
            <textarea
              className="w-full bg-zinc-950 border border-zinc-700 rounded-lg p-3 text-white focus:border-indigo-500 outline-none resize-none h-16"
              placeholder="Describe how things move (e.g., 'Slow zoom in as he raises his hand'). If empty, visual description will be used."
              value={actionPrompt}
              onChange={(e) => setActionPrompt(e.target.value)}
            />
          </div>

          {/* Dialogue */}
          <div>
            <label className="block text-sm font-medium text-zinc-400 mb-2">Dialogue (Optional)</label>
            <input
              type="text"
              className="w-full bg-zinc-950 border border-zinc-700 rounded-lg p-3 text-white focus:border-indigo-500 outline-none"
              placeholder="Character Name: What they say..."
              value={dialogue}
              onChange={(e) => setDialogue(e.target.value)}
            />
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <Button variant="ghost" onClick={onClose} type="button">Cancel</Button>
            <Button variant="primary" type="submit" disabled={!description.trim()}>Add Scene</Button>
          </div>
        </form>
      </div>
    </div>
  );
};
