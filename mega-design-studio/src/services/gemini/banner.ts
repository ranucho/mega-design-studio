import { Type } from "@google/genai";
import { getAI, parseDataUrl, retryOperation } from "./client";
import { ExtractedElement, BannerLayer } from "@/types";

/** Analyze a banner image and detect all visual elements with bounding boxes and roles */
export const analyzeBanner = async (
  imageDataUrl: string
): Promise<Array<{
  label: string;
  role: BannerLayer['role'];
  bbox: { x: number; y: number; w: number; h: number }; // percentages 0-100
  detectedText?: string;
}>> => {
  const ai = getAI();
  const { mimeType, data } = parseDataUrl(imageDataUrl);

  const response = await retryOperation(() =>
    ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: {
        parts: [
          { inlineData: { mimeType, data } },
          {
            text: `You are a senior designer deconstructing this banner/advertisement into individual layers for a design tool. Your job: identify EVERY distinct visual element that could be independently extracted, moved, resized, or replaced.

Think of it like reverse-engineering a Photoshop file — every element that a designer would have on its own layer.

For each element, return:
- label: A short descriptive name (e.g., "Main Character", "Game Logo", "CTA Button", "Headline Text", "Speech Bubble", "Prize Badge")
- role: One of: "background", "character", "text", "cta", "logo", "decoration", "other"
  • "background" — The main background layer (scene, gradient, environment). Exactly ONE.
  • "character" — Any person, mascot, creature, animal, or main illustrated subject.
  • "text" — Headings, titles, body copy, taglines, captions. NOT text that is part of a button/CTA.
  • "cta" — Call-to-action buttons INCLUDING their text (e.g., "Play Now" button = ONE cta element, not button + separate text).
  • "logo" — Brand logos, game logos, company marks, app icons.
  • "decoration" — Frames, borders, sparkles, particles, ornamental elements, coins, gems, ribbons, badges, stickers.
  • "other" — Anything that doesn't fit the above categories. This is a CATCH-ALL — use it liberally for: speech bubbles, callout boxes, price tags, rating stars, progress bars, game UI elements (slot reels, game trays, game screens), product screenshots, device mockups, QR codes, social icons, countdown timers, award seals, info boxes, etc.
- bbox: Bounding box as percentage of image dimensions (x, y = top-left corner, w, h = size). Values 0-100.
- detectedText: If the element contains readable text, include the exact text string. Otherwise omit.

COMPLETENESS — MISS NOTHING:
- Scan the ENTIRE image systematically: top-left to bottom-right, foreground to background.
- After your first pass, do a SECOND mental pass specifically looking for SMALL or SUBTLE elements you may have missed: small icons, tiny text, badges, labels, speech bubbles, overlays, watermarks, rating indicators, price tags, discount labels, social proof elements, trust badges, partner logos.
- Ask yourself: "If I were a designer recreating this in Photoshop from scratch, would I need any more layers?" If yes, add them.
- Common missed elements: speech/thought bubbles, callout boxes, "NEW"/"SALE" badges, star ratings, app store badges, small secondary logos, floating UI elements, game interface components.

CRITICAL RULES — NO DUPLICATES:
- Each pixel of the image should belong to AT MOST ONE element's bounding box (besides the background).
- NEVER detect the same visual content as two separate elements.
- Bounding boxes of non-background elements should NOT significantly overlap (max 10% overlap allowed).
- If two potential elements overlap by more than 30%, merge them into ONE element.

LAYOUT RULES:
- List elements in visual layer order: background first, then furthest-back, ending with foreground.
- The background should be ONE element covering the full image (bbox: {x:0, y:0, w:100, h:100}).
- Be PRECISE with bounding boxes — tightly frame each element with minimal extra space.
- Prefer FEWER well-defined elements over MANY overlapping ones.

BBOX PRECISION — CRITICAL:
- Each bbox must TIGHTLY frame ONLY its element — no extra padding, no surrounding content.
- A small badge/ribbon in one corner should have a SMALL bbox (e.g., w:10-15%, h:10-15%), NOT a large one covering the whole banner.
- Think carefully: if the element only occupies a small area of the image, its bbox must reflect that small area.
- WRONG: A "NEW" ribbon badge at top-left with bbox {x:0, y:0, w:80, h:70} — that covers most of the banner.
- RIGHT: A "NEW" ribbon badge at top-left with bbox {x:0, y:0, w:12, h:12} — tightly around just the badge.`
          }
        ]
      },
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              label: { type: Type.STRING },
              role: { type: Type.STRING },
              bbox: {
                type: Type.OBJECT,
                properties: {
                  x: { type: Type.NUMBER },
                  y: { type: Type.NUMBER },
                  w: { type: Type.NUMBER },
                  h: { type: Type.NUMBER },
                },
                required: ["x", "y", "w", "h"]
              },
              detectedText: { type: Type.STRING },
            },
            required: ["label", "role", "bbox"]
          }
        }
      }
    })
  );

  const parsed = JSON.parse(response.text || '[]');
  const validRoles: BannerLayer['role'][] = ['background', 'character', 'text', 'cta', 'logo', 'decoration', 'other'];

  // Post-process: validate and fix bbox issues
  const results = parsed.map((el: any) => ({
    label: el.label || 'Element',
    role: validRoles.includes(el.role) ? el.role : 'other' as BannerLayer['role'],
    bbox: {
      x: Math.max(0, Math.min(100, el.bbox?.x ?? 0)),
      y: Math.max(0, Math.min(100, el.bbox?.y ?? 0)),
      w: Math.max(1, Math.min(100, el.bbox?.w ?? 10)),
      h: Math.max(1, Math.min(100, el.bbox?.h ?? 10)),
    },
    detectedText: el.detectedText || undefined,
  }));

  // Sanity check: non-background elements covering >80% of the image are suspicious.
  // Decoration/other elements covering >50% are almost certainly wrong bbox.
  // Log warnings but don't remove — the user can recrop.
  for (const el of results) {
    if (el.role === 'background') continue;
    const area = (el.bbox.w * el.bbox.h) / 100;
    const maxArea = (el.role === 'decoration' || el.role === 'other') ? 50 : 80;
    if (area > maxArea) {
      console.warn(`[Banner] Suspiciously large bbox for "${el.label}" (${el.role}): ${area.toFixed(0)}% of image. May need recrop.`);
    }
  }

  return results;
};

/**
 * Pure canvas-based element cropping from source image.
 * No AI involved — directly crops the bbox region from the source.
 */
export const canvasCropElement = (
  sourceImageDataUrl: string,
  bbox: { x: number; y: number; w: number; h: number },
  paddingPct = 2,
): Promise<{ dataUrl: string; width: number; height: number }> => {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const imgW = img.naturalWidth;
      const imgH = img.naturalHeight;

      const rawX = (bbox.x / 100) * imgW;
      const rawY = (bbox.y / 100) * imgH;
      const rawW = (bbox.w / 100) * imgW;
      const rawH = (bbox.h / 100) * imgH;

      const padX = (paddingPct / 100) * imgW;
      const padY = (paddingPct / 100) * imgH;

      const cropX = Math.max(0, Math.floor(rawX - padX));
      const cropY = Math.max(0, Math.floor(rawY - padY));
      const cropRight = Math.min(imgW, Math.ceil(rawX + rawW + padX));
      const cropBottom = Math.min(imgH, Math.ceil(rawY + rawH + padY));
      const cropW = cropRight - cropX;
      const cropH = cropBottom - cropY;

      if (cropW < 2 || cropH < 2) {
        resolve({ dataUrl: sourceImageDataUrl, width: imgW, height: imgH });
        return;
      }

      const canvas = document.createElement('canvas');
      canvas.width = cropW;
      canvas.height = cropH;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);
      resolve({ dataUrl: canvas.toDataURL('image/png'), width: cropW, height: cropH });
    };
    img.onerror = () => reject(new Error('canvasCropElement: failed to load image'));
    img.src = sourceImageDataUrl;
  });
};

/** Crop a data-URL image to a bounding box region (percentages 0-100) with element-relative padding.
 *  Padding is calculated relative to the ELEMENT size, not the full image — prevents neighbor bleed. */
export const cropImageToRegion = (
  imageDataUrl: string,
  bbox: { x: number; y: number; w: number; h: number },
  paddingPct = 8,
): Promise<string> => {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const imgW = img.naturalWidth;
      const imgH = img.naturalHeight;
      const rawX = (bbox.x / 100) * imgW;
      const rawY = (bbox.y / 100) * imgH;
      const rawW = (bbox.w / 100) * imgW;
      const rawH = (bbox.h / 100) * imgH;
      // Padding relative to ELEMENT dimensions, not full image
      const padX = (paddingPct / 100) * rawW;
      const padY = (paddingPct / 100) * rawH;
      const cropX = Math.max(0, Math.floor(rawX - padX));
      const cropY = Math.max(0, Math.floor(rawY - padY));
      const cropRight = Math.min(imgW, Math.ceil(rawX + rawW + padX));
      const cropBottom = Math.min(imgH, Math.ceil(rawY + rawH + padY));
      const cropW = cropRight - cropX;
      const cropH = cropBottom - cropY;
      if (cropW < 2 || cropH < 2) { resolve(imageDataUrl); return; }
      const canvas = document.createElement('canvas');
      canvas.width = cropW;
      canvas.height = cropH;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);
      resolve(canvas.toDataURL('image/png'));
    };
    img.onerror = () => reject(new Error('Failed to load image for cropping'));
    img.src = imageDataUrl;
  });
};

/**
 * Chroma-key: replace a solid background color with actual alpha transparency.
 * Kept for backwards compatibility / edge cases.
 */
export const chromaKeyToAlpha = (
  imageDataUrl: string,
  keyR = 0, keyG = 255, keyB = 0,
  tolerance = 80,
): Promise<string> => {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, 0, 0);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const d = imageData.data;
      for (let i = 0; i < d.length; i += 4) {
        const dr = d[i] - keyR;
        const dg = d[i + 1] - keyG;
        const db = d[i + 2] - keyB;
        const dist = Math.sqrt(dr * dr + dg * dg + db * db);
        if (dist < tolerance) {
          d[i + 3] = 0;
        } else if (dist < tolerance * 1.5) {
          const alpha = Math.min(255, Math.round(((dist - tolerance) / (tolerance * 0.5)) * 255));
          d[i + 3] = alpha;
        }
      }
      ctx.putImageData(imageData, 0, 0);
      resolve(canvas.toDataURL('image/png'));
    };
    img.onerror = () => reject(new Error('chromaKeyToAlpha: failed to load image'));
    img.src = imageDataUrl;
  });
};

/**
 * White-to-alpha: convert solid white background to transparency.
 * Much cleaner than green chroma-key — white doesn't spill color onto edges.
 * Uses luminance-weighted distance from pure white for smooth antialiased edges.
 */
export const whiteToAlpha = (
  imageDataUrl: string,
  tolerance = 30,
): Promise<string> => {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const w = img.naturalWidth;
      const h = img.naturalHeight;
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, 0, 0);
      const imageData = ctx.getImageData(0, 0, w, h);
      const d = imageData.data;

      // Pass 1: Build a "whiteness" map to distinguish actual white bg from
      // light-colored content. We flood-fill from edges to find connected white regions.
      const isWhiteBg = new Uint8Array(w * h);
      const queue: number[] = [];

      const pixelIsWhite = (idx: number) => {
        const r = d[idx * 4], g = d[idx * 4 + 1], b = d[idx * 4 + 2];
        const dist = Math.sqrt((255 - r) ** 2 + (255 - g) ** 2 + (255 - b) ** 2);
        return dist < tolerance * 1.8;
      };

      // Seed from all 4 edges
      for (let x = 0; x < w; x++) {
        if (pixelIsWhite(x)) { isWhiteBg[x] = 1; queue.push(x); }
        const bot = (h - 1) * w + x;
        if (pixelIsWhite(bot)) { isWhiteBg[bot] = 1; queue.push(bot); }
      }
      for (let y = 1; y < h - 1; y++) {
        const left = y * w;
        if (pixelIsWhite(left)) { isWhiteBg[left] = 1; queue.push(left); }
        const right = y * w + w - 1;
        if (pixelIsWhite(right)) { isWhiteBg[right] = 1; queue.push(right); }
      }

      // BFS flood fill
      let qi = 0;
      while (qi < queue.length) {
        const idx = queue[qi++];
        const x = idx % w, y = (idx - x) / w;
        const neighbors = [
          y > 0 ? idx - w : -1,
          y < h - 1 ? idx + w : -1,
          x > 0 ? idx - 1 : -1,
          x < w - 1 ? idx + 1 : -1,
        ];
        for (const n of neighbors) {
          if (n >= 0 && !isWhiteBg[n] && pixelIsWhite(n)) {
            isWhiteBg[n] = 1;
            queue.push(n);
          }
        }
      }

      // Pass 2: Apply alpha only to flood-filled white background pixels
      for (let i = 0; i < w * h; i++) {
        const pi = i * 4;
        if (!isWhiteBg[i]) continue; // Not background — leave opaque

        const r = d[pi], g = d[pi + 1], b = d[pi + 2];
        const dist = Math.sqrt((255 - r) ** 2 + (255 - g) ** 2 + (255 - b) ** 2);

        if (dist < tolerance) {
          d[pi + 3] = 0; // Fully transparent
        } else if (dist < tolerance * 1.8) {
          // Soft edge — smooth alpha transition
          const alpha = Math.min(255, Math.round(((dist - tolerance) / (tolerance * 0.8)) * 255));
          d[pi + 3] = alpha;
        }
      }

      ctx.putImageData(imageData, 0, 0);
      resolve(canvas.toDataURL('image/png'));
    };
    img.onerror = () => reject(new Error('whiteToAlpha: failed to load image'));
    img.src = imageDataUrl;
  });
};

/**
 * Auto-trim transparent borders from an image.
 * Removes empty rows/cols from all 4 sides, keeping a small margin.
 */
export const autoTrimTransparent = (
  imageDataUrl: string,
  marginPx = 4,
): Promise<{ dataUrl: string; width: number; height: number }> => {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const w = img.naturalWidth;
      const h = img.naturalHeight;
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, 0, 0);
      const data = ctx.getImageData(0, 0, w, h).data;

      let top = h, bottom = 0, left = w, right = 0;
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const alpha = data[(y * w + x) * 4 + 3];
          if (alpha > 10) {
            if (y < top) top = y;
            if (y > bottom) bottom = y;
            if (x < left) left = x;
            if (x > right) right = x;
          }
        }
      }

      if (top >= bottom || left >= right) {
        resolve({ dataUrl: imageDataUrl, width: w, height: h });
        return;
      }

      // Add margin, clamped to image bounds
      top = Math.max(0, top - marginPx);
      left = Math.max(0, left - marginPx);
      bottom = Math.min(h - 1, bottom + marginPx);
      right = Math.min(w - 1, right + marginPx);

      const trimW = right - left + 1;
      const trimH = bottom - top + 1;
      const out = document.createElement('canvas');
      out.width = trimW;
      out.height = trimH;
      const outCtx = out.getContext('2d')!;
      outCtx.drawImage(img, left, top, trimW, trimH, 0, 0, trimW, trimH);
      resolve({ dataUrl: out.toDataURL('image/png'), width: trimW, height: trimH });
    };
    img.onerror = () => reject(new Error('autoTrimTransparent: failed to load image'));
    img.src = imageDataUrl;
  });
};


/**
 * Apply a black/white mask to a source image using canvas compositing.
 * White pixels in the mask → keep source pixels (opaque).
 * Black pixels in the mask → make transparent.
 * Includes mask cleanup: threshold to crisp black/white, then 1px dilate to
 * avoid losing edge pixels from imprecise AI masks.
 */
export const applyMaskToImage = (
  sourceDataUrl: string,
  maskDataUrl: string,
): Promise<string> => {
  return new Promise((resolve, reject) => {
    const srcImg = new Image();
    const maskImg = new Image();
    let srcLoaded = false, maskLoaded = false;

    const tryComposite = () => {
      if (!srcLoaded || !maskLoaded) return;

      const w = srcImg.naturalWidth;
      const h = srcImg.naturalHeight;

      // Draw source image
      const srcCanvas = document.createElement('canvas');
      srcCanvas.width = w;
      srcCanvas.height = h;
      const srcCtx = srcCanvas.getContext('2d')!;
      srcCtx.drawImage(srcImg, 0, 0, w, h);

      // Draw mask scaled to source dimensions
      const maskCanvas = document.createElement('canvas');
      maskCanvas.width = w;
      maskCanvas.height = h;
      const maskCtx = maskCanvas.getContext('2d')!;
      maskCtx.drawImage(maskImg, 0, 0, w, h);

      // === MASK CLEANUP ===
      // 1. Convert to luminance
      // 2. Threshold: >180 → 255 (keep), <60 → 0 (remove), middle → soft edge
      // 3. 1px dilate to avoid cutting edge pixels from AI imprecision
      const maskData = maskCtx.getImageData(0, 0, w, h);
      const md = maskData.data;
      const lumArr = new Uint8Array(w * h);

      // Pass 1: compute luminance + threshold
      for (let i = 0; i < w * h; i++) {
        const pi = i * 4;
        const lum = md[pi] * 0.299 + md[pi + 1] * 0.587 + md[pi + 2] * 0.114;
        // Hard threshold with antialiased band
        if (lum > 180) lumArr[i] = 255;
        else if (lum < 60) lumArr[i] = 0;
        else lumArr[i] = Math.round(((lum - 60) / 120) * 255); // smooth gradient in between
      }

      // Pass 2: 1px dilate — for each black pixel, if any neighbor is white, make it 128 (soft edge)
      // This prevents the mask from being slightly too tight (common AI error)
      const dilated = new Uint8Array(lumArr);
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const idx = y * w + x;
          if (lumArr[idx] > 0) continue; // already white/gray, skip
          // Check 4-connected neighbors
          const neighbors = [
            y > 0 ? lumArr[idx - w] : 0,
            y < h - 1 ? lumArr[idx + w] : 0,
            x > 0 ? lumArr[idx - 1] : 0,
            x < w - 1 ? lumArr[idx + 1] : 0,
          ];
          const maxN = Math.max(...neighbors);
          if (maxN > 180) dilated[idx] = 128; // soft edge at boundary
        }
      }

      // Pass 3: write cleaned mask as alpha channel
      for (let i = 0; i < w * h; i++) {
        const pi = i * 4;
        md[pi] = 255;
        md[pi + 1] = 255;
        md[pi + 2] = 255;
        md[pi + 3] = dilated[i];
      }
      maskCtx.putImageData(maskData, 0, 0);

      // Apply mask to source using destination-in compositing
      srcCtx.globalCompositeOperation = 'destination-in';
      srcCtx.drawImage(maskCanvas, 0, 0);

      resolve(srcCanvas.toDataURL('image/png'));
    };

    srcImg.onload = () => { srcLoaded = true; tryComposite(); };
    maskImg.onload = () => { maskLoaded = true; tryComposite(); };
    srcImg.onerror = () => reject(new Error('applyMaskToImage: failed to load source'));
    maskImg.onerror = () => reject(new Error('applyMaskToImage: failed to load mask'));
    srcImg.src = sourceDataUrl;
    maskImg.src = maskDataUrl;
  });
};

/**
 * Decode a native Gemini segmentation mask and composite it into a full-crop-sized mask.
 * The API returns a small mask PNG covering only the box_2d region.
 * We resize it to the bbox dimensions, threshold, then place it on a full-size black canvas.
 */
const decodeSegmentationMask = (
  maskBase64: string,
  box2d: [number, number, number, number], // [y0, x0, y1, x1] normalized 0-1000
  cropWidth: number,
  cropHeight: number,
): Promise<string> => {
  return new Promise((resolve, reject) => {
    // Decode bbox from normalized 0-1000 coords to pixel coords
    const [y0n, x0n, y1n, x1n] = box2d;
    const x0 = Math.round((x0n / 1000) * cropWidth);
    const y0 = Math.round((y0n / 1000) * cropHeight);
    const x1 = Math.round((x1n / 1000) * cropWidth);
    const y1 = Math.round((y1n / 1000) * cropHeight);
    const bboxW = Math.max(1, x1 - x0);
    const bboxH = Math.max(1, y1 - y0);

    // Load the mask PNG
    const maskImg = new Image();
    maskImg.onload = () => {
      // Create full-size black canvas (all transparent by default)
      const canvas = document.createElement('canvas');
      canvas.width = cropWidth;
      canvas.height = cropHeight;
      const ctx = canvas.getContext('2d')!;

      // Fill with black (transparent = remove everything)
      ctx.fillStyle = '#000000';
      ctx.fillRect(0, 0, cropWidth, cropHeight);

      // Draw the mask resized into the bbox region
      ctx.drawImage(maskImg, x0, y0, bboxW, bboxH);

      resolve(canvas.toDataURL('image/png'));
    };
    maskImg.onerror = () => reject(new Error('Failed to decode segmentation mask'));

    // Parse the base64 — may or may not have data URL prefix
    const cleanB64 = maskBase64.includes('base64,')
      ? maskBase64
      : `data:image/png;base64,${maskBase64}`;
    maskImg.src = cleanB64;
  });
};

/**
 * Generate an alpha mask using Gemini 2.5 Flash NATIVE SEGMENTATION.
 * This uses the model's built-in segmentation capability that returns
 * structured mask data (box_2d + mask PNG), NOT image generation.
 * Much more precise than asking an image-gen model to "draw" a mask.
 *
 * Falls back to image-generation mask if native segmentation fails.
 */
export const generateElementMask = async (
  croppedImageDataUrl: string,
  element: { label: string; role: string },
  _fullBannerDataUrl?: string,
  attempt = 0,
): Promise<string> => {
  const ai = getAI();
  const cropParsed = parseDataUrl(croppedImageDataUrl);

  // Get crop dimensions for mask placement
  const cropDims = await new Promise<{ w: number; h: number }>((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
    img.onerror = () => resolve({ w: 512, h: 512 });
    img.src = croppedImageDataUrl;
  });

  const roleDesc: Record<string, string> = {
    text: `the text "${element.label}" including all effects (outlines, shadows, glow, gradients)`,
    cta: `the button "${element.label}" including its background shape and text`,
    logo: `the logo "${element.label}" including any accompanying text`,
    character: `the complete character/mascot "${element.label}" including all body parts, clothing, accessories`,
    decoration: `the decoration "${element.label}" (badge, ribbon, sticker, or icon)`,
    other: `the element "${element.label}"`,
  };

  const subjectDesc = roleDesc[element.role] || roleDesc.other;

  // === TRY NATIVE SEGMENTATION (Gemini 2.5 Flash) ===
  console.log(`[Mask] Attempting native segmentation for "${element.label}" (${element.role})`);
  try {
    const segResponse = await retryOperation(() =>
      ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: {
          parts: [
            { inlineData: { mimeType: cropParsed.mimeType, data: cropParsed.data } },
            {
              text: `Give the segmentation masks for ${subjectDesc}. Output a JSON list of segmentation masks where each entry contains the 2D bounding box in the key "box_2d", the segmentation mask in key "mask", and the text label in the key "label". Use descriptive labels.`,
            },
          ],
        },
        config: {
          thinkingConfig: { thinkingBudget: 0 },
        },
      })
    );

    const responseText = segResponse.text || '';
    // Parse JSON — might be wrapped in ```json ... ```
    let jsonStr = responseText;
    if (jsonStr.includes('```json')) {
      jsonStr = jsonStr.split('```json')[1].split('```')[0].trim();
    } else if (jsonStr.includes('```')) {
      jsonStr = jsonStr.split('```')[1].split('```')[0].trim();
    }

    const masks: Array<{ box_2d: [number, number, number, number]; mask: string; label: string }> = JSON.parse(jsonStr);

    if (masks.length > 0) {
      // Use the first/largest mask (or merge all if multiple parts)
      // For most elements, there will be exactly one mask
      if (masks.length === 1) {
        const m = masks[0];
        console.log(`[Segmentation] Native mask for "${element.label}": label="${m.label}", box=${JSON.stringify(m.box_2d)}`);
        return await decodeSegmentationMask(m.mask, m.box_2d, cropDims.w, cropDims.h);
      }

      // Multiple masks — merge them onto one canvas
      console.log(`[Segmentation] ${masks.length} masks for "${element.label}", merging...`);
      const canvas = document.createElement('canvas');
      canvas.width = cropDims.w;
      canvas.height = cropDims.h;
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = '#000000';
      ctx.fillRect(0, 0, cropDims.w, cropDims.h);

      for (const m of masks) {
        const singleMask = await decodeSegmentationMask(m.mask, m.box_2d, cropDims.w, cropDims.h);
        const img = await new Promise<HTMLImageElement>((res, rej) => {
          const i = new Image();
          i.onload = () => res(i);
          i.onerror = () => rej(new Error('Failed to load merged mask'));
          i.src = singleMask;
        });
        // Use 'lighter' compositing to merge masks (OR operation)
        ctx.globalCompositeOperation = 'lighter';
        ctx.drawImage(img, 0, 0);
      }

      return canvas.toDataURL('image/png');
    }
  } catch (err) {
    console.warn(`[Mask] Native segmentation FAILED for "${element.label}", falling back to image-gen mask:`, err);
  }

  // === FALLBACK: Image-generation mask (less precise but always works) ===
  console.log(`[Mask] Using image-gen fallback for "${element.label}" (${element.role})`);
  const temperature = Math.min(0.1 + attempt * 0.3, 1.0);
  const fallbackPrompt = `Generate a SEGMENTATION MASK for ${subjectDesc} in this image.

RULES:
- Output an image with the SAME aspect ratio as the input.
- PURE WHITE (#FFFFFF) everywhere the subject is.
- PURE BLACK (#000000) everywhere that is NOT the subject.
- GRAY only at the exact boundary for antialiasing.
- FILL the subject solidly white — no holes, no gaps inside.
- Interior white areas (white clothing, white fill) must be WHITE in the mask.`;

  const fallbackResponse = await retryOperation(() =>
    ai.models.generateContent({
      model: 'gemini-3.1-flash-image-preview',
      contents: {
        parts: [
          { inlineData: { mimeType: cropParsed.mimeType, data: cropParsed.data } },
          { text: fallbackPrompt },
        ],
      },
      config: {
        responseModalities: ['IMAGE', 'TEXT'],
        temperature,
      },
    })
  );

  const parts = fallbackResponse.candidates?.[0]?.content?.parts || [];
  for (const part of parts) {
    if (part.inlineData?.data) {
      const maskMime = part.inlineData.mimeType || 'image/png';
      return `data:${maskMime};base64,${part.inlineData.data}`;
    }
  }
  throw new Error(`Failed to generate mask for: ${element.label}`);
};


/** Extract a single element from the banner using MASK-BASED approach.
 *  1. Canvas-crop original pixels (no AI — pixel-perfect)
 *  2. AI generates a black/white mask (what to keep vs remove)
 *  3. Canvas composites mask onto original crop → transparent PNG
 *  4. Auto-trim transparent borders
 *
 *  For background: uses AI inpainting to remove foreground elements.
 *  @param attempt - retry attempt number (0=first, 1+=retry). Higher attempts use more temperature. */
export const extractElement = async (
  imageDataUrl: string,
  element: { label: string; role: string; bbox: { x: number; y: number; w: number; h: number } },
  croppedImageDataUrl?: string,
  attempt = 0,
): Promise<string> => {
  const ai = getAI();
  const isBackground = element.role === 'background';

  if (isBackground) {
    // Background: send full image, ask AI to inpaint/remove all foreground elements
    const { mimeType, data } = parseDataUrl(imageDataUrl);
    const response = await retryOperation(() =>
      ai.models.generateContent({
        model: 'gemini-3.1-flash-image-preview',
        contents: {
          parts: [
            { inlineData: { mimeType, data } },
            { text: `IMAGE PROCESSING TASK: Background Extraction / Inpainting.

This is a banner/advertisement image. Extract ONLY the background scene/environment.

REQUIREMENTS:
1. REMOVE every foreground element: all characters, mascots, text, headlines, logos, buttons, CTAs, ribbons, badges, speech bubbles, decorations.
2. INPAINT the removed areas cleanly — fill with the surrounding background texture, gradient, or pattern so it looks natural.
3. PRESERVE the background's atmosphere, lighting, colors, and mood exactly.
4. Output at the SAME dimensions as input, filling the full canvas.
5. The result should look like a clean empty background ready for new elements to be placed on top.` }
          ]
        },
        config: { responseModalities: ['IMAGE', 'TEXT'] }
      })
    );

    const parts = response.candidates?.[0]?.content?.parts || [];
    for (const part of parts) {
      if (part.inlineData?.data) {
        const resMime = part.inlineData.mimeType || 'image/png';
        return `data:${resMime};base64,${part.inlineData.data}`;
      }
    }
    throw new Error('Failed to extract background');
  }

  // ═══════════════════════════════════════════════════════════════
  // DIRECT AI ISOLATION (non-background elements)
  // Same proven approach as isolateSymbol in the Symbol Gen tab:
  // 1. Crop the element region from the banner
  // 2. Send to AI: "isolate ONLY this element on white background"
  // 3. AI returns clean isolated element on white
  // 4. whiteToAlpha removes white → transparent
  // 5. Auto-trim transparent borders
  // ═══════════════════════════════════════════════════════════════

  // Step 1: Crop the element region (canvas-based, pixel-perfect)
  const cropDataUrl = croppedImageDataUrl || await cropImageToRegion(imageDataUrl, element.bbox, 15);
  const { mimeType: cropMime, data: cropData } = parseDataUrl(cropDataUrl);

  // Build role-specific isolation prompt
  const roleIsolation: Record<string, string> = {
    text: `Isolate ONLY the text/headline from this crop. Preserve the EXACT font, colors, effects (outlines, shadows, glow, gradients, 3D). Output it on a pure white background.`,
    cta: `Isolate ONLY the call-to-action button from this crop. Include the button shape AND its text. Preserve EXACT colors, gradients, and effects. Output it on a pure white background.`,
    logo: `Isolate ONLY the logo/brand mark from this crop. Preserve EXACT colors, details, and any accompanying text. Output it on a pure white background.`,
    character: `Isolate ONLY the character/person/mascot from this crop. Include their COMPLETE body, clothing, accessories, held items. If any part is cropped or cut off, reconstruct it naturally. Output on a pure white background.`,
    decoration: `Isolate ONLY this decorative element (badge, ribbon, coins, sparkles, etc.) from this crop. Preserve EXACT colors and details. Output it on a pure white background.`,
    other: `Isolate ONLY this specific element from the crop. Remove all other elements and background. Preserve EXACT original appearance. Output it on a pure white background.`,
  };

  const isolationPrompt = roleIsolation[element.role] || roleIsolation.other;

  // Step 2: Send BOTH the full banner (for context) AND the crop to AI
  const fullParsed = parseDataUrl(imageDataUrl);
  const temperature = Math.min(0.2 + attempt * 0.3, 1.0);

  const response = await retryOperation(() =>
    ai.models.generateContent({
      model: 'gemini-3.1-flash-image-preview',
      contents: {
        parts: [
          { inlineData: { mimeType: fullParsed.mimeType, data: fullParsed.data } },
          { text: `Above is the FULL banner/advertisement for context. Below is a CROPPED REGION from it.` },
          { inlineData: { mimeType: cropMime, data: cropData } },
          { text: `IMAGE PROCESSING TASK: Element Isolation.

This cropped region contains "${element.label}" (${element.role}).

${isolationPrompt}

CRITICAL RULES:
1. Output ONLY the isolated element — NO other elements, NO background scene, NO other text.
2. The element must look EXACTLY like it does in the original — same art style, same colors, same effects.
3. Background must be PURE WHITE #FFFFFF everywhere except the element itself.
4. Do NOT crop or cut off any part of the element.
5. Do NOT add margins, borders, or extra space.
6. Preserve the original aspect ratio of the element.` },
        ],
      },
      config: {
        responseModalities: ['IMAGE', 'TEXT'],
        temperature,
      },
    })
  );

  const parts = response.candidates?.[0]?.content?.parts || [];
  for (const part of parts) {
    if (part.inlineData?.data) {
      const rawMime = part.inlineData.mimeType || 'image/png';
      const rawDataUrl = `data:${rawMime};base64,${part.inlineData.data}`;

      // Step 3: Remove white background → transparent
      const transparent = await whiteToAlpha(rawDataUrl, 30);

      // Step 4: Auto-trim transparent borders
      const trimmed = await autoTrimTransparent(transparent, 2);
      return trimmed.dataUrl;
    }
  }

  throw new Error(`Failed to isolate element: ${element.label}`);
};

/** Resize a data URL image to exact pixel dimensions using canvas. */
export const resizeImageExact = (
  dataUrl: string,
  targetW: number,
  targetH: number,
): Promise<{ dataUrl: string; width: number; height: number }> => {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = targetW;
      canvas.height = targetH;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, 0, 0, targetW, targetH);
      resolve({ dataUrl: canvas.toDataURL('image/png'), width: targetW, height: targetH });
    };
    img.onerror = () => resolve({ dataUrl, width: targetW, height: targetH });
    img.src = dataUrl;
  });
};

/** Reskin a banner with new theme, character, and palette */
export const reskinBanner = async (
  sourceImageDataUrl: string,
  config: {
    theme: string;
    characterRef?: string;
    palette?: string;
    textChanges?: Record<string, string>;
    keepElements?: string[];
  },
): Promise<string> => {
  const ai = getAI();
  const { mimeType, data } = parseDataUrl(sourceImageDataUrl);
  const parts: any[] = [{ inlineData: { mimeType, data } }];

  if (config.characterRef) {
    const charParsed = parseDataUrl(config.characterRef);
    parts.push({ inlineData: { mimeType: charParsed.mimeType, data: charParsed.data } });
  }

  const textChangesStr = config.textChanges
    ? Object.entries(config.textChanges).map(([from, to]) => `- Change "${from}" to "${to}"`).join('\n')
    : 'Keep all text as-is.';

  parts.push({
    text: `Reskin this banner advertisement with a new theme while maintaining the EXACT SAME LAYOUT.
NEW THEME: ${config.theme}
${config.characterRef ? 'Use the second image as the new character reference.' : 'Generate a character that fits the new theme.'}
${config.palette ? `COLOR PALETTE: ${config.palette}` : 'Derive colors from the theme.'}
TEXT CHANGES:\n${textChangesStr}
ELEMENTS TO KEEP: ${config.keepElements?.join(', ') || 'None — reskin everything.'}
Maintain the EXACT SAME visual layout, spacing, and element sizes as the original. Output at same dimensions.`
  });

  const response = await retryOperation(() =>
    ai.models.generateContent({
      model: 'gemini-3.1-flash-image-preview',
      contents: { parts },
      config: { responseModalities: ['IMAGE', 'TEXT'] }
    })
  );

  const responseParts = response.candidates?.[0]?.content?.parts || [];
  for (const part of responseParts) {
    if (part.inlineData?.data) {
      const resMime = part.inlineData.mimeType || 'image/png';
      return `data:${resMime};base64,${part.inlineData.data}`;
    }
  }
  throw new Error('Failed to generate reskinned banner');
};

// ============================================================================
// AI-DRIVEN LAYOUT ENGINE — Gemini designs each composition individually
// ============================================================================

/**
 * AI-driven layout engine: Gemini analyzes the elements and designs
 * a proper layout for each target size with real design intelligence.
 * Understands hierarchy, readability, proportions, and composition.
 */
export const generateBannerLayout = async (
  elements: ExtractedElement[],
  targetWidth: number,
  targetHeight: number,
  sourceWidth: number,
  sourceHeight: number,
): Promise<Array<{
  elementId: string;
  x: number;
  y: number;
  scaleX: number;
  scaleY: number;
  visible: boolean;
}>> => {
  const ai = getAI();
  const ratio = targetWidth / targetHeight;
  const aspectLabel = ratio > 4 ? 'ultra-wide banner' :
                      ratio > 2 ? 'wide banner' :
                      ratio > 1.2 ? 'landscape' :
                      ratio > 0.8 ? 'square' :
                      ratio > 0.4 ? 'portrait' : 'tall/skyscraper';

  // Build element descriptions for the AI
  const elementDescs = elements.map(el => ({
    id: el.id,
    label: el.label,
    role: el.role,
    nativeWidth: el.nativeWidth,
    nativeHeight: el.nativeHeight,
    aspectRatio: +(el.nativeWidth / el.nativeHeight).toFixed(2),
    detectedText: el.detectedText || null,
    // Original position in source banner (for context)
    sourcePosition: el.sourceBbox ? {
      xPct: Math.round(el.sourceBbox.x),
      yPct: Math.round(el.sourceBbox.y),
      wPct: Math.round(el.sourceBbox.w),
      hPct: Math.round(el.sourceBbox.h),
    } : null,
  }));

  const prompt = `You are a senior banner ad designer. Design the layout for a ${targetWidth}×${targetHeight}px (${aspectLabel}) banner.

SOURCE BANNER: ${sourceWidth}×${sourceHeight}px. The following elements were extracted from it:

${JSON.stringify(elementDescs, null, 2)}

DESIGN THIS ${targetWidth}×${targetHeight} COMPOSITION:

For each element, return its position and uniform scale factor. The scale is relative to the element's native dimensions — a scale of 1.0 means the element renders at its original pixel size.

DESIGN RULES (follow these strictly):
1. BACKGROUND always fills the entire canvas: x=0, y=0, scaleX=targetWidth/nativeWidth, scaleY=targetHeight/nativeHeight (this is the ONE exception where scaleX≠scaleY is allowed — backgrounds stretch to fill).
2. ALL other elements use UNIFORM scale: scaleX === scaleY (preserve aspect ratio, NEVER stretch).
3. HIERARCHY: The main visual element (character, game screenshot, game tray) should be LARGE and prominent — it's the hero of the banner. Don't shrink it to a tiny corner.
4. TEXT/HEADLINE: Must be readable. Place near the top or in a visually prominent position. Scale it large enough to be legible at the target size.
5. CTA BUTTON: Always visible and clickable. Place at the bottom or in a clear action area. Never too small.
6. LOGO: Keep at reasonable size — not too large, not too small. Typically top-left or top-right.
7. DECORATIONS: Fill remaining space, add visual interest. Can be behind other elements.
8. NO OVERLAPPING of key elements (text shouldn't cover the hero element, CTA shouldn't be hidden).
9. Elements should have breathing room — don't cram everything edge-to-edge.
10. ALL extracted elements should be visible (visible: true) unless the canvas is too small to fit them readably (e.g., a 320×50 mobile banner can't fit everything).
11. Think about what makes this banner EFFECTIVE as an advertisement — clear message, strong visual, obvious CTA.

Return a JSON array with one entry per element:
[{ "elementId": "...", "x": number, "y": number, "scaleX": number, "scaleY": number, "visible": boolean }]

x,y are the TOP-LEFT corner position in pixels. Scale is a multiplier on native dimensions.`;

  try {
    const response = await retryOperation(() =>
      ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: { parts: [{ text: prompt }] },
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                elementId: { type: Type.STRING },
                x: { type: Type.NUMBER },
                y: { type: Type.NUMBER },
                scaleX: { type: Type.NUMBER },
                scaleY: { type: Type.NUMBER },
                visible: { type: Type.BOOLEAN },
              },
              required: ['elementId', 'x', 'y', 'scaleX', 'scaleY', 'visible'],
            },
          },
        },
      })
    );

    const parsed = JSON.parse(response.text || '[]');

    // Validate and sanitize the AI response
    const results: Array<{
      elementId: string; x: number; y: number;
      scaleX: number; scaleY: number; visible: boolean;
    }> = [];

    for (const el of elements) {
      const aiLayout = parsed.find((p: any) => p.elementId === el.id);
      if (aiLayout) {
        // Enforce uniform scale for non-background
        const sx = Math.max(0.01, aiLayout.scaleX || 1);
        const sy = Math.max(0.01, aiLayout.scaleY || 1);
        const isBackground = el.role === 'background';

        results.push({
          elementId: el.id,
          x: Math.round(Math.max(0, aiLayout.x || 0)),
          y: Math.round(Math.max(0, aiLayout.y || 0)),
          scaleX: isBackground ? sx : Math.min(sx, sy), // Uniform for non-bg
          scaleY: isBackground ? sy : Math.min(sx, sy),
          visible: aiLayout.visible !== false,
        });
      } else {
        // AI didn't return this element — use sensible defaults
        const isBackground = el.role === 'background';
        results.push({
          elementId: el.id,
          x: 0,
          y: 0,
          scaleX: isBackground ? targetWidth / el.nativeWidth : 0.5,
          scaleY: isBackground ? targetHeight / el.nativeHeight : 0.5,
          visible: true,
        });
      }
    }

    return results;
  } catch (err) {
    console.error('AI layout generation failed, using fallback:', err);
    // Fallback: simple stacked layout
    return fallbackLayout(elements, targetWidth, targetHeight);
  }
};

/** Simple fallback layout when AI is unavailable */
function fallbackLayout(
  elements: ExtractedElement[],
  targetWidth: number,
  targetHeight: number,
): Array<{ elementId: string; x: number; y: number; scaleX: number; scaleY: number; visible: boolean }> {
  const results: Array<{ elementId: string; x: number; y: number; scaleX: number; scaleY: number; visible: boolean }> = [];

  for (const el of elements) {
    if (el.role === 'background') {
      results.push({
        elementId: el.id, x: 0, y: 0,
        scaleX: targetWidth / el.nativeWidth,
        scaleY: targetHeight / el.nativeHeight,
        visible: true,
      });
    } else {
      // Scale to fit ~60% of canvas width, center
      const scale = Math.min(
        (targetWidth * 0.6) / el.nativeWidth,
        (targetHeight * 0.3) / el.nativeHeight,
        1,
      );
      results.push({
        elementId: el.id,
        x: Math.round((targetWidth - el.nativeWidth * scale) / 2),
        y: Math.round((targetHeight - el.nativeHeight * scale) / 2),
        scaleX: scale,
        scaleY: scale,
        visible: true,
      });
    }
  }
  return results;
}

// Keep composeBannerAtSize for potential future use but it's not the primary path
export const composeBannerAtSize = async (
  sourceImageDataUrl: string,
  targetWidth: number,
  targetHeight: number,
  presetName: string,
): Promise<string> => {
  const ai = getAI();
  const { mimeType, data } = parseDataUrl(sourceImageDataUrl);
  const aspectLabel = targetWidth > targetHeight * 2 ? 'ultra-wide' :
                      targetWidth > targetHeight ? 'landscape' :
                      targetHeight > targetWidth * 2 ? 'ultra-tall' :
                      targetHeight > targetWidth ? 'portrait' : 'square';

  const response = await retryOperation(() =>
    ai.models.generateContent({
      model: 'gemini-3.1-flash-image-preview',
      contents: {
        parts: [
          { inlineData: { mimeType, data } },
          { text: `Redesign this banner for "${presetName}" (${targetWidth}x${targetHeight}, ${aspectLabel}). Keep same brand, elements, text. Redesign layout for new dimensions. No stretching. All text readable. CTA visible. Professional quality.` }
        ]
      },
      config: { responseModalities: ['IMAGE', 'TEXT'] }
    })
  );

  const parts = response.candidates?.[0]?.content?.parts || [];
  for (const part of parts) {
    if (part.inlineData?.data) {
      const resMime = part.inlineData.mimeType || 'image/png';
      const rawDataUrl = `data:${resMime};base64,${part.inlineData.data}`;
      const resized = await resizeImageExact(rawDataUrl, targetWidth, targetHeight);
      return resized.dataUrl;
    }
  }
  throw new Error(`Failed to compose banner at ${targetWidth}x${targetHeight}`);
};
