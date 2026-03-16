import { useState, useCallback, useRef } from 'react';
import { TIMELINE } from '@/utils/constants';

interface TimelineState {
  zoom: number;
  playheadTime: number;
  isPlaying: boolean;
}

export function useTimeline(defaultZoom: number = TIMELINE.DEFAULT_ZOOM) {
  const [state, setState] = useState<TimelineState>({
    zoom: defaultZoom,
    playheadTime: 0,
    isPlaying: false,
  });
  const animationRef = useRef<number | null>(null);

  const pixelsPerSecond = state.zoom * 2;

  const setZoom = useCallback((zoom: number) => {
    setState(prev => ({ ...prev, zoom: Math.max(5, Math.min(100, zoom)) }));
  }, []);

  const setPlayheadTime = useCallback((time: number) => {
    setState(prev => ({ ...prev, playheadTime: Math.max(0, time) }));
  }, []);

  const setIsPlaying = useCallback((playing: boolean) => {
    setState(prev => ({ ...prev, isPlaying: playing }));
  }, []);

  const timeToPixel = useCallback((time: number) => {
    return time * pixelsPerSecond;
  }, [pixelsPerSecond]);

  const pixelToTime = useCallback((px: number) => {
    return px / pixelsPerSecond;
  }, [pixelsPerSecond]);

  return {
    ...state,
    pixelsPerSecond,
    setZoom,
    setPlayheadTime,
    setIsPlaying,
    timeToPixel,
    pixelToTime,
    animationRef,
  };
}
