/**
 * VideoExportEngine - Shared Canvas + MediaRecorder + AudioContext export logic.
 * Used by both Animatix (MovieTab) and Video Extractor (EditorTab).
 */

interface ExportClip {
  url: string;
  trimStart: number;
  trimEnd: number;
  speed: number;
}

interface ExportOptions {
  clips: ExportClip[];
  width: number;
  height: number;
  audioUrl?: string;
  audioOffset?: number;
  onProgress?: (clipIndex: number, total: number) => void;
}

/** Detect best supported MIME type for MediaRecorder */
const getSupportedMimeType = (): string => {
  const types = [
    'video/mp4;codecs=avc1',
    'video/webm;codecs=h264',
    'video/webm;codecs=vp9',
    'video/webm'
  ];
  for (const type of types) {
    if (MediaRecorder.isTypeSupported(type)) return type;
  }
  return 'video/webm';
};

/** Capture frames from a video element at a specific time */
const captureFrameAtTime = (video: HTMLVideoElement, time: number): Promise<void> => {
  return new Promise((resolve) => {
    if (video.readyState < 1) {
      video.addEventListener('loadedmetadata', () => {
        video.currentTime = time;
      }, { once: true });
    } else {
      video.currentTime = time;
    }
    video.addEventListener('seeked', () => resolve(), { once: true });
  });
};

export const exportVideo = async (options: ExportOptions): Promise<Blob> => {
  const { clips, width, height, audioUrl, audioOffset = 0, onProgress } = options;

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;

  const mimeType = getSupportedMimeType();
  const stream = canvas.captureStream(30);

  // Audio setup
  let audioCtx: AudioContext | null = null;
  let destination: MediaStreamAudioDestinationNode | null = null;

  if (audioUrl) {
    audioCtx = new AudioContext();
    destination = audioCtx.createMediaStreamDestination();
    destination.stream.getAudioTracks().forEach(track => stream.addTrack(track));
  }

  const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 5000000 });
  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };

  const recorderDone = new Promise<void>((resolve) => {
    recorder.onstop = () => resolve();
  });

  recorder.start(100);

  // Process each clip
  for (let i = 0; i < clips.length; i++) {
    const clip = clips[i];
    onProgress?.(i, clips.length);

    const video = document.createElement('video');
    video.src = clip.url;
    video.muted = true;
    video.playsInline = true;

    await new Promise<void>((resolve) => {
      video.addEventListener('loadedmetadata', () => resolve(), { once: true });
      video.load();
    });

    const clipDuration = (clip.trimEnd - clip.trimStart) / clip.speed;

    await captureFrameAtTime(video, clip.trimStart);
    video.playbackRate = clip.speed;
    video.currentTime = clip.trimStart;

    await new Promise<void>((resolve) => {
      const startTime = Date.now();
      const watchdog = setTimeout(() => {
        console.warn(`Clip ${i} timed out, skipping...`);
        resolve();
      }, (clipDuration + 5) * 1000);

      const drawFrame = () => {
        if (video.currentTime >= clip.trimEnd || video.ended) {
          clearTimeout(watchdog);
          resolve();
          return;
        }
        ctx.drawImage(video, 0, 0, width, height);
        requestAnimationFrame(drawFrame);
      };

      video.play().then(drawFrame).catch(() => {
        clearTimeout(watchdog);
        resolve();
      });
    });

    video.pause();
    video.src = '';
  }

  recorder.stop();
  await recorderDone;

  if (audioCtx) {
    await audioCtx.close();
  }

  return new Blob(chunks, { type: mimeType });
};

/** Download a blob as a file */
export const downloadBlob = (blob: Blob, filename: string) => {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
};
