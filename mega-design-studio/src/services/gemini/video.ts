import { getAI, parseDataUrl, parseImageBase64, retryOperation, delay, rewritePromptForSafety, pollVideoOperation } from "./client";

/** Generate video from a scene image (Animatix) */
export const generateSceneVideo = async (
  imageBase64: string,
  prompt: string,
  duration: number = 10,
  aspectRatio: string = "16:9"
): Promise<string> => {
  const ai = getAI();
  const { mimeType, data } = parseImageBase64(imageBase64);

  let op = await ai.models.generateVideos({
    model: "veo-3.1-fast-generate-preview",
    prompt: `Cinematic motion. ${prompt}`,
    image: { imageBytes: data, mimeType },
    config: { numberOfVideos: 1, resolution: "720p", aspectRatio }
  });

  const startTime = Date.now();
  while (!op.done) {
    if (Date.now() - startTime > 300000) throw new Error("Video timeout");
    await delay(10000);
    op = await ai.operations.getVideosOperation({ operation: op });
  }

  if (op.error) throw new Error(`Veo Rejected: ${op.error.message}`);
  const uri = op.response?.generatedVideos?.[0]?.video?.uri;
  const res = await fetch(`${uri}&key=${process.env.API_KEY}`);
  const blob = await res.blob();
  return URL.createObjectURL(blob);
};

/** Generate animation with start/end frames (Video Extractor) */
export const generateAnimation = async (
  startFrame: string,
  endFrame: string | null,
  prompt: string,
  aspectRatio: '16:9' | '9:16' = '16:9',
  quality: 'fast' | 'pro' = 'fast'
): Promise<{ url: string; asset: any }> => {
  return retryOperation(async () => {
    const ai = getAI();

    let modelName = quality === 'pro' ? 'veo-3.1-generate-preview' : 'veo-3.1-fast-generate-preview';
    if (endFrame) {
      modelName = 'veo-3.1-fast-generate-preview';
    }

    const config: any = {
      numberOfVideos: 1,
      resolution: '720p',
      aspectRatio
    };

    if (endFrame) {
      config.lastFrame = {
        imageBytes: endFrame.split(',')[1],
        mimeType: 'image/png'
      };
    }

    const attemptGeneration = async (currentPrompt: string) => {
      const operation = await ai.models.generateVideos({
        model: modelName,
        prompt: currentPrompt,
        image: {
          imageBytes: startFrame.split(',')[1],
          mimeType: 'image/png'
        },
        config
      });
      return pollVideoOperation(operation, ai);
    };

    try {
      return await attemptGeneration(prompt);
    } catch (err: any) {
      const msg = err.message || "";
      if (msg.includes("safety guardrails") || msg.includes("third-party")) {
        console.warn("Veo safety block detected (Animation). Attempting to sanitize prompt...");
        const safePrompt = await rewritePromptForSafety(prompt);
        if (safePrompt !== prompt) {
          return await attemptGeneration(safePrompt);
        }
      }
      throw err;
    }
  });
};

/** Generate green/blue/pink screen character video (Video Extractor - CharacterStudio) */
export const generateGreenScreenVideo = async (
  imageDataUrl: string,
  prompt: string,
  backgroundColor: 'green' | 'blue' | 'pink',
  aspectRatio: '16:9' | '9:16' = '16:9',
  loop: boolean = false
): Promise<{ url: string; asset: any }> => {
  return retryOperation(async () => {
    const ai = getAI();
    const { mimeType, data } = parseDataUrl(imageDataUrl);

    let bgHex = "#00fa15";
    if (backgroundColor === 'green') bgHex = "#00fa15";
    if (backgroundColor === 'blue') bgHex = "#0072ff";
    if (backgroundColor === 'pink') bgHex = "#ff4dfd";
    // Support custom hex colors passed directly
    if (backgroundColor.startsWith('#')) bgHex = backgroundColor;

    const bgPrompt = `The character must appear on a SOLID ${backgroundColor.toUpperCase()} SCREEN background (Exact Hex: ${bgHex}) for chroma keying. No shadows, no gradients on the background.`;

    const attemptGeneration = async (currentPrompt: string) => {
      const loopHint = loop ? ' The action loops seamlessly — the final frame must match the starting pose exactly so the video can play on repeat without a visible jump.' : '';
      const fullPrompt = `${currentPrompt}. ${bgPrompt} The character performs the action while staying in frame.${loopHint} High quality animation.`;
      const config: any = { numberOfVideos: 1, resolution: '720p', aspectRatio };
      if (loop) {
        config.lastFrame = { imageBytes: data, mimeType };
      }
      const operation = await ai.models.generateVideos({
        model: 'veo-3.1-fast-generate-preview',
        prompt: fullPrompt,
        image: { imageBytes: data, mimeType },
        config
      });
      return pollVideoOperation(operation, ai);
    };

    try {
      return await attemptGeneration(prompt);
    } catch (err: any) {
      const msg = err.message || "";
      if (msg.includes("safety guardrails") || msg.includes("third-party")) {
        console.warn("Veo safety block detected. Attempting to sanitize prompt...");
        const safePrompt = await rewritePromptForSafety(prompt);
        if (safePrompt !== prompt) {
          return await attemptGeneration(safePrompt);
        }
      }
      throw err;
    }
  });
};

/** Extend an existing video animation (Video Extractor) */
export const extendAnimation = async (
  previousAsset: any,
  prompt: string,
  aspectRatio: '16:9' | '9:16' = '16:9'
): Promise<{ url: string; asset: any }> => {
  return retryOperation(async () => {
    const ai = getAI();

    const attemptGeneration = async (currentPrompt: string) => {
      const operation = await ai.models.generateVideos({
        model: 'veo-3.1-generate-preview',
        prompt: currentPrompt + " Continue the action smoothly.",
        video: previousAsset,
        config: { numberOfVideos: 1, resolution: '720p', aspectRatio }
      });
      return pollVideoOperation(operation, ai);
    };

    try {
      return await attemptGeneration(prompt);
    } catch (err: any) {
      const msg = err.message || "";
      if (msg.includes("safety guardrails") || msg.includes("third-party")) {
        console.warn("Veo safety block detected (Extension). Attempting to sanitize prompt...");
        const safePrompt = await rewritePromptForSafety(prompt);
        if (safePrompt !== prompt) {
          return await attemptGeneration(safePrompt);
        }
      }
      throw err;
    }
  });
};
