/** Format seconds to MM:SS.ms display */
export const formatTime = (seconds: number): string => {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toFixed(1).padStart(4, '0')}`;
};

/** Format seconds to MM:SS display */
export const formatTimeShort = (seconds: number): string => {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${String(secs).padStart(2, '0')}`;
};

/** Convert pixel position to time based on zoom/PPS */
export const pixelToTime = (px: number, pixelsPerSecond: number): number => {
  return px / pixelsPerSecond;
};

/** Convert time to pixel position based on zoom/PPS */
export const timeToPixel = (time: number, pixelsPerSecond: number): number => {
  return time * pixelsPerSecond;
};

/** Generate unique ID */
export const generateId = (): string => {
  return Math.random().toString(36).substring(2, 10) + Date.now().toString(36);
};
