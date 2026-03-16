import { GoogleGenAI } from "@google/genai";

let genAI: GoogleGenAI | null = null;

export const getAI = (): GoogleGenAI => {
    if (!genAI) {
        const key = process.env.API_KEY || '';
        genAI = new GoogleGenAI({ apiKey: key });
    }
    return genAI;
};

export const resetAI = () => {
    genAI = null;
};

export const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/** Parse data URL to get mimeType and base64 data. Handles whitespace/newlines. */
export const parseDataUrl = (dataUrl: string) => {
  const cleanUrl = dataUrl.trim().replace(/[\n\r]/g, '');
  const matches = cleanUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (matches && matches.length === 3) {
    return { mimeType: matches[1], data: matches[2] };
  }
  const parts = cleanUrl.split(',');
  return {
    mimeType: 'image/png',
    data: parts.length > 1 ? parts[1] : cleanUrl
  };
};

/** Parse inline regex (Animatix-style) for backward compat */
export const parseImageBase64 = (imageBase64: string) => {
  const m = imageBase64.match(/^data:(image\/[a-zA-Z+]+);base64,(.+)$/);
  if (!m) throw new Error("Invalid image format");
  return { mimeType: m[1], data: m[2] };
};

/** Retry with exponential backoff. Selective retry on transient errors. */
export async function retryOperation<T>(operationFn: () => Promise<T>, maxRetries: number = 3): Promise<T> {
  let lastError: any;
  for (let i = 0; i <= maxRetries; i++) {
    try {
      return await operationFn();
    } catch (error: any) {
      lastError = error;
      const msg = error.message || "";
      const isRetryable =
        msg.includes("internal server issue") ||
        msg.includes("500") ||
        msg.includes("503") ||
        msg.includes("timed out") ||
        msg.includes("quota") ||
        msg.includes("reason: OTHER");

      if (!isRetryable || i === maxRetries) {
        throw error;
      }

      const delayMs = 2000 * Math.pow(2, i);
      console.warn(`Attempt ${i + 1} failed, retrying in ${delayMs}ms... Error: ${msg}`);
      await delay(delayMs);
    }
  }
  throw lastError;
}

/** Simple retry (Animatix-style) for model fallback chains */
export async function runWithRetry<T>(fn: () => Promise<T>, retries = 2): Promise<T> {
  let attempt = 0;
  while (attempt <= retries) {
    try {
      return await fn();
    } catch (error: any) {
      if (attempt === retries) throw error;
      const delayMs = 1500 * Math.pow(2, attempt);
      await delay(delayMs);
      attempt++;
    }
  }
  throw new Error("Generation failed after retries.");
}

/** Sanitize prompts when Veo blocks for copyright/safety */
export const rewritePromptForSafety = async (prompt: string): Promise<string> => {
  try {
    const ai = getAI();
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: {
        parts: [{
          text: `Rewrite the following video generation prompt to be "Safety Compliant".
          Remove any specific names of real people, trademarked characters (like Marvel, DC, Disney, etc), or branded terms.
          Replace them with generic visual descriptions (e.g. replace "Spiderman" with "A man in a red and blue spider costume").
          Keep the action description intact.

          Input Prompt: "${prompt}"`
        }]
      }
    });
    return response.text?.trim() || prompt;
  } catch {
    return prompt;
  }
};

/** Create inline image parts from data URLs */
export const createImageParts = (urls: string[]) =>
  urls.map(url => {
    const { mimeType, data } = parseDataUrl(url);
    return { inlineData: { data, mimeType } };
  });

/** Poll a Veo video operation until completion */
export async function pollVideoOperation(operation: any, ai: GoogleGenAI): Promise<{ url: string; asset: any }> {
  const startTime = Date.now();
  const TIMEOUT_MS = 600000;

  while (!operation.done) {
    if (Date.now() - startTime > TIMEOUT_MS) {
      throw new Error("Video generation request timed out on client side.");
    }
    await delay(10000);
    operation = await ai.operations.getVideosOperation({ operation });
  }

  if (operation.error) {
    throw new Error(`Video generation failed: ${operation.error.message || 'Unknown error code ' + operation.error.code}`);
  }

  const responseData = operation.response || (operation as any).result;

  if (responseData?.raiMediaFilteredReasons?.length > 0) {
    const reasons = responseData.raiMediaFilteredReasons.join('. ');
    let errorMessage = `Video generation blocked by safety guardrails: ${reasons}`;
    if (reasons.toLowerCase().includes("third-party")) {
      errorMessage += "\n\nHINT: The AI detected potential copyright issues. Modify your prompt to be more generic.";
    }
    throw new Error(errorMessage);
  }

  const downloadLink = responseData?.generatedVideos?.[0]?.video?.uri;
  if (!downloadLink) {
    throw new Error("Video generation completed but no video URI was returned.");
  }

  const videoAsset = responseData?.generatedVideos?.[0]?.video;
  const videoResponse = await fetch(`${downloadLink}&key=${process.env.API_KEY}`);
  if (!videoResponse.ok) {
    throw new Error(`Failed to download video bytes: ${videoResponse.statusText}`);
  }
  const blob = await videoResponse.blob();
  const mp4Blob = new Blob([blob], { type: 'video/mp4' });
  const url = URL.createObjectURL(mp4Blob);

  return { url, asset: videoAsset };
}
