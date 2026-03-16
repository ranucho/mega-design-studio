import { useState, useCallback, useRef } from 'react';
import { Crop } from '@/types';

type DragMode = 'move' | 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'create' | null;

interface CropToolState {
  crop: Crop | null;
  dragMode: DragMode;
}

export function useCropTool() {
  const [state, setState] = useState<CropToolState>({ crop: null, dragMode: null });
  const startPos = useRef({ x: 0, y: 0 });
  const startCrop = useRef<Crop | null>(null);

  const setCrop = useCallback((crop: Crop | null) => {
    setState(prev => ({ ...prev, crop }));
  }, []);

  const handleMouseDown = useCallback((
    e: React.MouseEvent,
    containerRect: DOMRect,
    mode: DragMode = 'create'
  ) => {
    e.preventDefault();
    const x = ((e.clientX - containerRect.left) / containerRect.width) * 100;
    const y = ((e.clientY - containerRect.top) / containerRect.height) * 100;
    startPos.current = { x, y };
    startCrop.current = state.crop ? { ...state.crop } : null;

    if (mode === 'create') {
      setState({ crop: { x, y, w: 0, h: 0 }, dragMode: 'create' });
    } else {
      setState(prev => ({ ...prev, dragMode: mode }));
    }
  }, [state.crop]);

  const handleMouseMove = useCallback((
    e: React.MouseEvent,
    containerRect: DOMRect
  ) => {
    if (!state.dragMode) return;

    const x = ((e.clientX - containerRect.left) / containerRect.width) * 100;
    const y = ((e.clientY - containerRect.top) / containerRect.height) * 100;
    const dx = x - startPos.current.x;
    const dy = y - startPos.current.y;
    const sc = startCrop.current;

    setState(prev => {
      if (!prev.crop) return prev;
      let newCrop = { ...prev.crop };

      switch (prev.dragMode) {
        case 'create':
          newCrop = {
            x: Math.min(startPos.current.x, x),
            y: Math.min(startPos.current.y, y),
            w: Math.abs(x - startPos.current.x),
            h: Math.abs(y - startPos.current.y),
          };
          break;
        case 'move':
          if (sc) {
            newCrop.x = Math.max(0, Math.min(100 - sc.w, sc.x + dx));
            newCrop.y = Math.max(0, Math.min(100 - sc.h, sc.y + dy));
          }
          break;
        case 'nw':
          if (sc) { newCrop.x = sc.x + dx; newCrop.y = sc.y + dy; newCrop.w = sc.w - dx; newCrop.h = sc.h - dy; }
          break;
        case 'ne':
          if (sc) { newCrop.y = sc.y + dy; newCrop.w = sc.w + dx; newCrop.h = sc.h - dy; }
          break;
        case 'sw':
          if (sc) { newCrop.x = sc.x + dx; newCrop.w = sc.w - dx; newCrop.h = sc.h + dy; }
          break;
        case 'se':
          if (sc) { newCrop.w = sc.w + dx; newCrop.h = sc.h + dy; }
          break;
        case 'n':
          if (sc) { newCrop.y = sc.y + dy; newCrop.h = sc.h - dy; }
          break;
        case 's':
          if (sc) { newCrop.h = sc.h + dy; }
          break;
        case 'w':
          if (sc) { newCrop.x = sc.x + dx; newCrop.w = sc.w - dx; }
          break;
        case 'e':
          if (sc) { newCrop.w = sc.w + dx; }
          break;
      }

      // Clamp
      newCrop.w = Math.max(2, newCrop.w);
      newCrop.h = Math.max(2, newCrop.h);
      newCrop.x = Math.max(0, Math.min(100 - newCrop.w, newCrop.x));
      newCrop.y = Math.max(0, Math.min(100 - newCrop.h, newCrop.y));

      return { ...prev, crop: newCrop };
    });
  }, [state.dragMode]);

  const handleMouseUp = useCallback(() => {
    setState(prev => {
      // Remove tiny crops (accidental clicks)
      if (prev.crop && prev.crop.w < 2 && prev.crop.h < 2) {
        return { crop: null, dragMode: null };
      }
      return { ...prev, dragMode: null };
    });
  }, []);

  return {
    crop: state.crop,
    setCrop,
    isDragging: state.dragMode !== null,
    handleMouseDown,
    handleMouseMove,
    handleMouseUp,
  };
}
