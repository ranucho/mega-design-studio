import { Type } from "@google/genai";
import { getAI, parseDataUrl, retryOperation } from "./client";
import { ExtractedElement, BannerLayer } from "@/types";
import { ALL_COMPOSITION_RULES, getLayerZOrder, isWideStrip, getSizeSpecificRules, isNarrowBanner, isTallBanner, CTA_ABBREVIATION_MAP } from "./banner-rules";

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

Think in THREE CATEGORIES to ensure complete coverage:
1. TEXT — All text elements: headlines, titles, taglines, body copy, captions. NOT text inside buttons.
2. UI — All interface elements: CTA buttons (with their text), logos, badges, ribbons, decorations, borders, sparkles, coins, gems.
3. IMAGES — All pictorial elements: the background scene, characters/mascots, game screenshots, product shots, slot reels.

For each element, return:
- label: A short descriptive name (e.g., "Main Character", "Game Logo", "CTA Button", "Headline Text", "Speech Bubble", "Prize Badge")
- role: One of: "background", "character", "text", "cta", "logo", "decoration", "other"
  • "background" — The main background layer (scene, gradient, environment). Exactly ONE.
  • "character" — Any person, mascot, creature, animal, or main illustrated subject. IMPORTANT: The bounding box MUST include the ENTIRE character from head to feet/tail. NEVER crop a character in the middle — if the character extends to the edge of the banner, extend the bbox all the way to that edge. Include ALL body parts, accessories, weapons, wings, tails, hats, hair, and shadows that are part of the character.
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
 * Uses edge-based flood-fill (same approach as whiteToAlpha) so ONLY connected
 * background pixels from the edges are removed — interior pixels matching the
 * key color are preserved (e.g. green clothing, magenta details).
 */
export const chromaKeyToAlpha = (
  imageDataUrl: string,
  keyR = 0, keyG = 255, keyB = 0,
  tolerance = 80,
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

      const matchesKey = (idx: number) => {
        const dr = d[idx * 4] - keyR;
        const dg = d[idx * 4 + 1] - keyG;
        const db = d[idx * 4 + 2] - keyB;
        return Math.sqrt(dr * dr + dg * dg + db * db) < tolerance * 1.5;
      };

      // Flood-fill from edges
      const isBg = new Uint8Array(w * h);
      const queue: number[] = [];

      for (let x = 0; x < w; x++) {
        if (matchesKey(x)) { isBg[x] = 1; queue.push(x); }
        const bot = (h - 1) * w + x;
        if (matchesKey(bot)) { isBg[bot] = 1; queue.push(bot); }
      }
      for (let y = 1; y < h - 1; y++) {
        const left = y * w;
        if (matchesKey(left)) { isBg[left] = 1; queue.push(left); }
        const right = y * w + w - 1;
        if (matchesKey(right)) { isBg[right] = 1; queue.push(right); }
      }

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
          if (n >= 0 && !isBg[n] && matchesKey(n)) {
            isBg[n] = 1;
            queue.push(n);
          }
        }
      }

      // Apply alpha only to flood-filled background pixels
      for (let i = 0; i < w * h; i++) {
        if (!isBg[i]) continue;
        const pi = i * 4;
        const dr = d[pi] - keyR;
        const dg = d[pi + 1] - keyG;
        const db = d[pi + 2] - keyB;
        const dist = Math.sqrt(dr * dr + dg * dg + db * db);
        if (dist < tolerance) {
          d[pi + 3] = 0;
        } else if (dist < tolerance * 1.5) {
          const alpha = Math.min(255, Math.round(((dist - tolerance) / (tolerance * 0.5)) * 255));
          d[pi + 3] = alpha;
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
/** Find elements whose bboxes overlap or are near the target element */
export const findNeighbors = (
  target: { bbox: { x: number; y: number; w: number; h: number } },
  allElements: Array<{ label: string; role: string; bbox: { x: number; y: number; w: number; h: number } }>,
  expandPct = 10,
): Array<{ label: string; role: string; bbox: { x: number; y: number; w: number; h: number } }> => {
  const tx0 = target.bbox.x - expandPct;
  const ty0 = target.bbox.y - expandPct;
  const tx1 = target.bbox.x + target.bbox.w + expandPct;
  const ty1 = target.bbox.y + target.bbox.h + expandPct;
  return allElements.filter(el => {
    if (el === target as any) return false;
    if (el.role === 'background') return false;
    const ex0 = el.bbox.x, ey0 = el.bbox.y;
    const ex1 = el.bbox.x + el.bbox.w, ey1 = el.bbox.y + el.bbox.h;
    return ex0 < tx1 && ex1 > tx0 && ey0 < ty1 && ey1 > ty0;
  });
};

export const extractElement = async (
  imageDataUrl: string,
  element: { label: string; role: string; bbox: { x: number; y: number; w: number; h: number } },
  croppedImageDataUrl?: string,
  attempt = 0,
  neighbors?: Array<{ label: string; role: string; bbox: { x: number; y: number; w: number; h: number } }>,
): Promise<string> => {
  const ai = getAI();
  const isBackground = element.role === 'background';

  if (isBackground) {
    // Background: send full image, ask AI to inpaint/remove all foreground elements
    const { mimeType, data } = parseDataUrl(imageDataUrl);

    // Build exclusion list from neighbors so coins/decorations don't bleed into background
    const fgList = neighbors && neighbors.length > 0
      ? `\n\nFOREGROUND ELEMENTS TO REMOVE:\n${neighbors.map(n => `- "${n.label}" (${n.role})`).join('\n')}\nRemove ALL of these completely — no traces of any foreground element should remain.`
      : '';

    const response = await retryOperation(() =>
      ai.models.generateContent({
        model: 'gemini-3.1-flash-image-preview',
        contents: {
          parts: [
            { inlineData: { mimeType, data } },
            { text: `Remove all foreground elements from this banner and output ONLY the clean background.

Remove: characters, mascots, text, headlines, logos, buttons, CTAs, ribbons, badges, coins, decorations — everything except the background scene.
Inpaint removed areas with the surrounding background texture/gradient so it looks natural.
Output at the SAME dimensions as input.${fgList}` }
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
  // DIRECT AI ISOLATION — WHITE BACKGROUND (proven approach)
  // 1. Crop the element region from the banner
  // 2. Send to AI: "isolate this element on white background"
  // 3. whiteToAlpha (edge flood-fill) removes white → transparent
  //    (flood-fill only removes white connected to edges, preserving
  //    interior white content like white clothing, text, etc.)
  // 4. Auto-trim transparent borders
  // ═══════════════════════════════════════════════════════════════

  // Step 1: Crop the element region
  // Wider padding for decorations (coins need space) and on retries
  const isDecoration = element.role === 'decoration';
  const padPercent = attempt >= 2 ? 35 : isDecoration ? 25 : 15;
  const cropDataUrl = croppedImageDataUrl || await cropImageToRegion(imageDataUrl, element.bbox, padPercent);
  const { mimeType: cropMime, data: cropData } = parseDataUrl(cropDataUrl);

  // Short, focused role-specific prompts — less is more with AI image gen
  const rolePrompts: Record<string, string> = {
    text: `Extract this text element onto a solid dark gray (#222222) background.

CRITICAL — this is a VISUAL EXTRACTION, not re-typing:
1. The text must look EXACTLY like a screenshot cut from the banner — same 3D extrusion, same gradient fills, same stroke/outline colors, same drop shadows, same glow effects, same perspective/angle.
2. Output the text EXACTLY ONCE. Do NOT duplicate, mirror, or repeat it.
3. Do NOT re-type, re-render, or redesign the text in a different font/style. COPY the pixels.
4. The only change: replace the scene behind the text with solid dark gray #222222.
5. Keep the text's own shadow, stroke, and glow effects — just remove the banner background scene.`,
    cta: `Isolate ONLY this button from the crop onto a white background.
Include the button shape and its text. Preserve exact colors and effects.`,
    logo: `Isolate ONLY this logo from the crop onto a white background.
Preserve exact colors, details, and any text.`,
    character: `Isolate ONLY the character/person/mascot from this crop onto a white background.
COMPLETELY REMOVE the background scene — no buildings, no interior, no sky, no patterns.
Include the FULL character head to feet. If any part is cut off, complete it naturally.
Do NOT add any outline, stroke, or border around the character.`,
    decoration: `Isolate ONLY this decorative element from the crop onto a white background.
Include the COMPLETE element — do NOT crop it at any edge.
If it contains coins: keep them perfectly round, include entire coins/piles.`,
    other: `Isolate ONLY this element from the crop onto a white background.
Remove everything else. Preserve exact appearance.`,
  };

  const rolePrompt = rolePrompts[element.role] || rolePrompts.other;

  // Retry escalation
  let retryNote = '';
  if (attempt === 1) {
    retryNote = '\n\nRETRY — Previous result was bad. Be more careful: remove ALL background, do NOT crop the element, do NOT add outlines/strokes.';
  } else if (attempt === 2) {
    retryNote = '\n\nRETRY #2 — Still failing. The background MUST be pure white. The element must be COMPLETE with no cropping. No outlines. No duplicating.';
  } else if (attempt >= 3) {
    retryNote = `\n\nFINAL RETRY — Start from a blank white canvas. Carefully reconstruct ONLY "${element.label}" matching its exact appearance in the original. Nothing else.`;
  }

  // Build neighbor exclusion block
  const exclusion = neighbors && neighbors.length > 0
    ? `\nDo NOT include these neighboring elements in the output: ${neighbors.map(n => `"${n.label}"`).join(', ')}.`
    : '';

  const fullParsed = parseDataUrl(imageDataUrl);
  const temperature = Math.min(0.15 + attempt * 0.25, 1.2);

  // Characters: send ONLY the crop (no full banner context).
  // The full banner confuses the AI into reproducing the background scene.
  // Same proven approach as isolateSymbol in Symbol Gen tab.
  const isCharacter = element.role === 'character';
  const contentParts = isCharacter
    ? [
        { inlineData: { mimeType: cropMime, data: cropData } },
        { text: `IMAGE PROCESSING TASK: Background Removal / Character Isolation.

INPUT: A crop from a banner containing "${element.label}".
GOAL: Output the EXACT SAME character on a SOLID WHITE background RGB(255,255,255).

CRITICAL CONSTRAINTS:
1. BACKGROUND: Must be PURE WHITE #FFFFFF — completely remove the scene/environment behind the character.
2. PRESERVE: Do not re-draw or redesign the character. Keep the original art style, colors, pose, and details exactly as they are.
3. COMPLETENESS: Include the FULL character from head to feet — all clothing, accessories, held items, hair, hat.
4. NO OUTLINES: Do NOT add any stroke, border, outline, or glow around the character.
5. NO CROPPING: If any body part is cut off at the edge, reconstruct it naturally.${exclusion}${retryNote}` },
      ]
    : [
        { inlineData: { mimeType: fullParsed.mimeType, data: fullParsed.data } },
        { text: `Full banner for context. Below is a crop containing "${element.label}" (${element.role}).` },
        { inlineData: { mimeType: cropMime, data: cropData } },
        { text: `${rolePrompt}${exclusion}${retryNote}` },
      ];

  const response = await retryOperation(() =>
    ai.models.generateContent({
      model: 'gemini-3.1-flash-image-preview',
      contents: { parts: contentParts },
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

      // Step 3: Remove background → transparent
      // Text: detect if AI used dark gray or white bg, remove accordingly
      // Others: white bg + whiteToAlpha
      let transparent: string;
      if (element.role === 'text') {
        // Detect dominant corner color to determine which bg was used
        const detectBg = await new Promise<'dark' | 'white'>((resolve) => {
          const testImg = new Image();
          testImg.onload = () => {
            const c = document.createElement('canvas');
            c.width = testImg.naturalWidth; c.height = testImg.naturalHeight;
            const cx = c.getContext('2d')!;
            cx.drawImage(testImg, 0, 0);
            // Sample 4 corners
            const samples = [
              cx.getImageData(0, 0, 1, 1).data,
              cx.getImageData(c.width - 1, 0, 1, 1).data,
              cx.getImageData(0, c.height - 1, 1, 1).data,
              cx.getImageData(c.width - 1, c.height - 1, 1, 1).data,
            ];
            const avgBrightness = samples.reduce((sum, d) => sum + (d[0] + d[1] + d[2]) / 3, 0) / 4;
            resolve(avgBrightness < 128 ? 'dark' : 'white');
          };
          testImg.onerror = () => resolve('white');
          testImg.src = rawDataUrl;
        });
        if (detectBg === 'dark') {
          transparent = await chromaKeyToAlpha(rawDataUrl, 0x22, 0x22, 0x22, 70);
        } else {
          transparent = await whiteToAlpha(rawDataUrl, 30);
        }
      } else {
        transparent = await whiteToAlpha(rawDataUrl, 30);
      }

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

COLOUR & CONTRAST REQUIREMENTS — THIS IS CRITICAL:
- Use a RICH, VIBRANT colour palette with HIGH CONTRAST between all elements.
- The background must clearly contrast with ALL foreground elements (characters, text, CTA buttons, logos).
- CTA buttons must POP — use bold, saturated colours (gold, red, bright green) with strong outlines or glow effects.
- Text must be HIGHLY READABLE against its background — use drop shadows, outlines, or contrasting colours.
- Characters/mascots should have bright, saturated colours with visible edges — NO blending into the background.
- Decorative elements (sparkles, coins, badges) should have glow or shine effects to stand out.
- AVOID low-contrast muddy palettes. AVOID monochrome or washed-out colours.
- Think MOBILE GAMING AD: every element must be instantly recognizable at small sizes.
- The overall image must look PROFESSIONAL, POLISHED, and APPEALING with rich lighting and rendering.

LOGO RULES:
- You may slightly resize or sharpen the logo to improve clarity, but do NOT change the logo design, colors, fonts, or add new elements to it. The logo must remain recognizable and identical in content.

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
// SPARKLE — AI final touch & rendering pass
// ============================================================================

/**
 * "Sparkle" pass: sends a rendered banner composition to AI for a final
 * polishing touch. Keeps the image exactly as-is but adds professional
 * rendering: subtle light effects on CTA/screenshot, depth-of-field,
 * color grading, and a designer-finish look.
 */
export interface FineTuneOptions {
  /** Layer names/roles to enhance (checked = fine tune this element) */
  enhanceLayers: string[];
  /** Layer names/roles to protect (unchecked = keep exactly as-is) */
  protectLayers: string[];
  /** Custom text instructions */
  customInstructions: string;
}

export const DEFAULT_FINE_TUNE: FineTuneOptions = {
  enhanceLayers: [],
  protectLayers: [],
  customInstructions: '',
};

export const sparkleBanner = async (
  compositionImageDataUrl: string,
  options: FineTuneOptions = DEFAULT_FINE_TUNE,
): Promise<string> => {
  const ai = getAI();
  const { mimeType, data } = parseDataUrl(compositionImageDataUrl);

  // Build enhance/protect blocks from layer selections
  // Logo is ALWAYS protected — move it from enhance to protect automatically
  const logoNames = options.enhanceLayers.filter(name => name.toLowerCase().includes('logo'));
  const actualEnhance = options.enhanceLayers.filter(name => !name.toLowerCase().includes('logo'));
  const actualProtect = [...new Set([...options.protectLayers, ...logoNames])];

  const enhanceBlock = actualEnhance.length > 0
    ? `\n\nELEMENTS TO ENHANCE (apply rendering polish to these):\n${actualEnhance.map((l, i) => `${i + 1}. "${l}" — Improve rendering quality: better lighting, sharper details, subtle glow/shine, professional finish.`).join('\n')}`
    : '';

  const protectBlock = actualProtect.length > 0
    ? `\n\n🚫 PROTECTED ELEMENTS — DO NOT TOUCH THESE AT ALL:\n${actualProtect.map((l, i) => `${i + 1}. "${l}" — ABSOLUTELY NO CHANGES. Same exact colors, same rendering style, same shape, same everything. If this is a green button it stays green. If it's 2D it stays 2D. Copy these pixels unchanged.`).join('\n')}\nThis is the HIGHEST PRIORITY rule — protected elements must be pixel-identical to the input.`
    : '';

  const customBlock = options.customInstructions.trim()
    ? `\n\nADDITIONAL INSTRUCTIONS FROM THE USER (highest priority):\n${options.customInstructions.trim()}`
    : '';

  const response = await retryOperation(() =>
    ai.models.generateContent({
      model: 'gemini-3.1-flash-image-preview',
      contents: {
        parts: [
          { inlineData: { mimeType, data } },
          {
            text: `You are a senior graphic designer applying a FINAL POLISH PASS to this banner advertisement.

YOUR TASK: Keep the image EXACTLY as it is — same layout, same text, same elements, same positions — but enhance the RENDERING QUALITY of selected elements to make it look like a designer spent time on final touch-up.

Enhancements include: better lighting, subtle glow/shine effects, sharper details, professional color grading, and a polished finish.${enhanceBlock}${protectBlock}

CRITICAL RULES:
- DO NOT change the layout, text content, element positions, or overall composition.
- DO NOT add new elements, remove existing elements, or change any text.
- DO NOT change the aspect ratio or dimensions.
- The result should look like the SAME banner, just with professional polish.
- Keep changes SUBTLE — this is a rendering pass, not a redesign.
- Output the image at the EXACT SAME pixel dimensions as the input. Do NOT resize.
- DO NOT change any background colors (white stays white, black stays black, etc.).
- DO NOT change the art style (2D stays 2D, cartoon stays cartoon, 3D stays 3D).
- DO NOT change element colors (a green button stays green, a red badge stays red).
- LOGO PROTECTION (ALWAYS ENFORCED — even if not in the protected list): NEVER modify, redesign, or add effects to any logo. The logo must be pixel-identical to the input. The ONLY acceptable change is a very subtle light/shine/sparkle reflection. No new shapes, no color changes, no extra elements, no artifacts around the logo.
- COIN PROTECTION: If the image contains gold coins — they MUST remain perfectly round. Do NOT distort coins.
- NO ARTIFACTS: Do not add halos, blurs, smudges, or distortions around any element edges. Keep all edges clean and sharp.${customBlock}`
          }
        ],
      },
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
  throw new Error('Fine tune pass failed — no image returned');
};

// ============================================================================
// REFERENCE-BASED LAYOUT TEMPLATES — measured from professional banners
// ============================================================================

/** Position template: xPct, yPct = top-left corner %; wPct, hPct = size % of canvas */
interface PosTemplate { xPct: number; yPct: number; wPct: number; hPct: number }

const LAYOUT_TEMPLATES: Record<string, Record<string, PosTemplate | null>> = {
  LANDSCAPE: {
    ribbon:    { xPct: 0,  yPct: 0,  wPct: 8,   hPct: 13 },
    logo:      { xPct: 86, yPct: 0,  wPct: 13,  hPct: 11 },
    headline:  { xPct: 14, yPct: 0,  wPct: 57,  hPct: 19 },
    bubble:    { xPct: 71, yPct: 11, wPct: 19,  hPct: 18 },
    character: { xPct: 72, yPct: 21, wPct: 28,  hPct: 73 },
    slot:      { xPct: 5,  yPct: 21, wPct: 54,  hPct: 65 },
    cta:       { xPct: 18, yPct: 85, wPct: 42,  hPct: 13 },
    coins:     { xPct: 54, yPct: 69, wPct: 21,  hPct: 31 },
  },
  PORTRAIT: {
    ribbon:    { xPct: 0,  yPct: 0,  wPct: 12,  hPct: 6 },
    logo:      { xPct: 42, yPct: 1,  wPct: 20,  hPct: 5 },
    headline:  { xPct: 5,  yPct: 4,  wPct: 89,  hPct: 13 },
    bubble:    { xPct: 48, yPct: 16, wPct: 32,  hPct: 9 },
    character: { xPct: 40, yPct: 13, wPct: 50,  hPct: 31 },
    slot:      { xPct: 2,  yPct: 40, wPct: 67,  hPct: 37 },
    cta:       { xPct: 12, yPct: 86, wPct: 76,  hPct: 9 },
    coins:     { xPct: 60, yPct: 68, wPct: 34,  hPct: 20 },
  },
  SQUARE: {
    ribbon:    { xPct: 0,  yPct: 0,  wPct: 11,  hPct: 11 },
    logo:      { xPct: 82, yPct: 0,  wPct: 17,  hPct: 10 },
    headline:  { xPct: 9,  yPct: 2,  wPct: 74,  hPct: 18 },
    bubble:    { xPct: 71, yPct: 18, wPct: 24,  hPct: 13 },
    character: { xPct: 70, yPct: 28, wPct: 30,  hPct: 55 },
    slot:      { xPct: 3,  yPct: 24, wPct: 65,  hPct: 54 },
    cta:       { xPct: 15, yPct: 82, wPct: 68,  hPct: 14 },
    coins:     { xPct: 53, yPct: 67, wPct: 38,  hPct: 33 },
  },
};

function getLayoutCategory(w: number, h: number): string {
  if (h <= 100 && w / h >= 3) return 'STRIP';
  const r = w / h;
  if (r > 1.2) return 'LANDSCAPE';
  if (r < 0.9) return 'PORTRAIT';
  return 'SQUARE';
}

function classifyElement(el: { label: string; role: string }): string {
  const n = el.label.toLowerCase();
  if (el.role === 'background') return 'background';
  if (el.role === 'character') return 'character';
  if (el.role === 'cta' || n.includes('cta')) return 'cta';
  if (el.role === 'logo') return 'logo';
  if (el.role === 'text' || n.includes('headline')) return 'headline';
  if (n.includes('slot') || n.includes('reel') || n.includes('tray')) return 'slot';
  if (n.includes('coin') || n.includes('gold')) return 'coins';
  if (n.includes('speech') || n.includes('bubble')) return 'bubble';
  if (n.includes('badge') || (n.includes('new') && el.role === 'decoration')) return 'ribbon';
  return 'other';
}

/**
 * Template-based layout: places elements at positions measured from reference banners.
 * No AI needed — pure deterministic calculation from reference templates.
 * Used for LANDSCAPE, PORTRAIT, SQUARE categories.
 */
export function generateTemplateLayout(
  elements: ExtractedElement[],
  targetWidth: number,
  targetHeight: number,
  shortenCTAs?: boolean,
): Array<{ elementId: string; x: number; y: number; scaleX: number; scaleY: number; visible: boolean }> {
  const W = targetWidth;
  const H = targetHeight;
  const cat = getLayoutCategory(W, H);
  const tmpl = LAYOUT_TEMPLATES[cat];
  if (!tmpl) return []; // strips handled separately

  const results: Array<{ elementId: string; x: number; y: number; scaleX: number; scaleY: number; visible: boolean }> = [];
  const usedClasses = new Set<string>();

  // Determine which variant to use for each group
  const isSlim = isNarrowBanner(W, H);
  const isTall = isTallBanner(W, H);

  for (const el of elements) {
    const cls = classifyElement(el);

    // Handle variants: pick the right one per group
    if (el.variantOfId) {
      // This is a variant — check if we should use it or the parent
      const parent = elements.find(e => e.id === el.variantOfId);
      if (parent) {
        const parentCls = classifyElement(parent);
        // Short CTA: use on slim/strip only
        if (el.variantKind === 'short') {
          if (!isSlim) { results.push({ elementId: el.id, x: 0, y: 0, scaleX: 0.1, scaleY: 0.1, visible: false }); continue; }
        }
        // 2-line headline: use on tall/portrait
        if (el.variantKind === 'multiline') {
          if (!isTall && cat !== 'PORTRAIT') { results.push({ elementId: el.id, x: 0, y: 0, scaleX: 0.1, scaleY: 0.1, visible: false }); continue; }
        }
      }
    } else {
      // This is a parent — check if a variant should replace it
      const variants = elements.filter(e => e.variantOfId === el.id);
      if (variants.length > 0) {
        const shortVariant = variants.find(v => v.variantKind === 'short');
        const multilineVariant = variants.find(v => v.variantKind === 'multiline');
        // If slim and has short variant, hide the parent CTA
        if (isSlim && shortVariant && cls === 'cta') {
          results.push({ elementId: el.id, x: 0, y: 0, scaleX: 0.1, scaleY: 0.1, visible: false }); continue;
        }
        // If portrait and has multiline variant, hide the parent headline
        if ((isTall || cat === 'PORTRAIT') && multilineVariant && cls === 'headline') {
          results.push({ elementId: el.id, x: 0, y: 0, scaleX: 0.1, scaleY: 0.1, visible: false }); continue;
        }
      }
    }

    // Background: cover mode
    if (cls === 'background') {
      const coverScale = Math.max(W / el.nativeWidth, H / el.nativeHeight);
      results.push({
        elementId: el.id,
        x: Math.round((W - el.nativeWidth * coverScale) / 2),
        y: Math.round((H - el.nativeHeight * coverScale) / 2),
        scaleX: coverScale, scaleY: coverScale, visible: true,
      });
      continue;
    }

    // Skip if this class was already placed (duplicate roles)
    if (usedClasses.has(cls) && cls !== 'other') {
      results.push({ elementId: el.id, x: 0, y: 0, scaleX: 0.1, scaleY: 0.1, visible: false });
      continue;
    }

    const pos = tmpl[cls];
    if (!pos) {
      // Unknown element — place at center, small
      results.push({ elementId: el.id, x: Math.round(W * 0.3), y: Math.round(H * 0.3), scaleX: 0.2, scaleY: 0.2, visible: true });
      continue;
    }

    usedClasses.add(cls);

    // Calculate target pixel size from template percentages
    const targetW = W * pos.wPct / 100;
    const targetH = H * pos.hPct / 100;
    // Uniform scale: fit element into the template box
    const scale = Math.min(targetW / el.nativeWidth, targetH / el.nativeHeight);
    const actualW = el.nativeWidth * scale;
    const actualH = el.nativeHeight * scale;

    // Position: center the element within the template box
    const boxX = W * pos.xPct / 100;
    const boxY = H * pos.yPct / 100;
    const x = Math.round(boxX + (targetW - actualW) / 2);
    const y = Math.round(boxY + (targetH - actualH) / 2);

    // Ribbon always flush to (0,0)
    const finalX = cls === 'ribbon' ? 0 : x;
    const finalY = cls === 'ribbon' ? 0 : y;

    results.push({
      elementId: el.id,
      x: finalX, y: finalY,
      scaleX: scale, scaleY: scale,
      visible: true,
    });
  }

  return results;
}

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
  templateComposition?: { width: number; height: number; layers: Array<{ name: string; role: string; x: number; y: number; scaleX: number; scaleY: number; nativeWidth: number; nativeHeight: number }> } | null,
  referenceImages?: Array<{ label: string; dataUrl: string; width: number; height: number }>,
  shortenCTAs?: boolean,
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
    // Variant info — AI should pick ONE per variant-group (original OR variant, not both)
    variantOfId: el.variantOfId || null,
    variantKind: el.variantKind || null,
    // Original position in source banner (for context)
    sourcePosition: el.sourceBbox ? {
      xPct: Math.round(el.sourceBbox.x),
      yPct: Math.round(el.sourceBbox.y),
      wPct: Math.round(el.sourceBbox.w),
      hPct: Math.round(el.sourceBbox.h),
    } : null,
  }));

  const isStrip = isWideStrip(targetWidth, targetHeight) || (targetHeight <= 100 && targetWidth / targetHeight >= 3);
  const is728x90 = targetWidth === 728 && targetHeight === 90;
  const sizeSpecificRules = getSizeSpecificRules(targetWidth, targetHeight);
  const slim = isNarrowBanner(targetWidth, targetHeight);

  const ctaAbbrevMappings = Object.entries(CTA_ABBREVIATION_MAP)
    .map(([from, to]) => `"${from}" → "${to}"`)
    .join(', ');

  const templateBlock = templateComposition
    ? `\n\nREFERENCE LAYOUT (follow this composition style — an approved design with a similar aspect ratio):
Canvas: ${templateComposition.width}×${templateComposition.height}
Layers (in EXACT z-order, index 0 = bottom/back, higher = front/top): ${JSON.stringify(
      templateComposition.layers.map((l, i) => ({
        zIndex: i,
        name: l.name,
        role: l.role,
        xPct: +((l.x / templateComposition.width) * 100).toFixed(1),
        yPct: +((l.y / templateComposition.height) * 100).toFixed(1),
        wPct: +(((l.nativeWidth * l.scaleX) / templateComposition.width) * 100).toFixed(1),
        hPct: +(((l.nativeHeight * l.scaleY) / templateComposition.height) * 100).toFixed(1),
      })),
      null,
      2,
    )}
CRITICAL: Match this reference layout as closely as possible:
- LAYER STACKING: Return elements in the SAME z-order as shown above (zIndex 0 first in array, highest zIndex last). If the character is behind the game shot in the reference, it MUST be behind in your result too.
- POSITIONS: Use the xPct/yPct/wPct/hPct as targets — adapt only as needed for the new aspect ratio
- SIZING: Maintain the same proportional relationships between elements
- HIERARCHY: Same overall composition and visual hierarchy
Only deviate when the new aspect ratio absolutely forces it. Do NOT redesign — adapt.`
    : '';

  const prompt = `You are a senior banner ad designer. Design the layout for a ${targetWidth}×${targetHeight}px (${aspectLabel}) banner.${isStrip ? ' THIS IS A WIDE STRIP BANNER — follow the strip layout rules below.' : ''}${slim && shortenCTAs !== false ? `\n\nThis is a SLIM banner. When the CTA text is long, shorten per these mappings: ${ctaAbbrevMappings}` : ''}${slim && shortenCTAs === false ? '\n\nThis is a SLIM banner, but keep the original CTA text intact (user has disabled CTA shortening).' : ''}${templateBlock}

SOURCE BANNER: ${sourceWidth}×${sourceHeight}px. The following elements were extracted from it:

${JSON.stringify(elementDescs, null, 2)}

DESIGN THIS ${targetWidth}×${targetHeight} COMPOSITION:

For each element, return its position and uniform scale factor. The scale is relative to the element's native dimensions — a scale of 1.0 means the element renders at its original pixel size.

TECHNICAL RULES:
1. BACKGROUND uses COVER mode (like CSS background-size:cover): uniform scale to FILL the canvas, then center it. Calculate: scale = Math.max(targetWidth/nativeWidth, targetHeight/nativeHeight). Then x = (targetWidth - nativeWidth*scale)/2, y = (targetHeight - nativeHeight*scale)/2. scaleX === scaleY (NO stretching — background must maintain its proportions).
2. ALL elements use UNIFORM scale: scaleX === scaleY (preserve aspect ratio, NEVER stretch any element).
3. ALL extracted elements MUST appear (visible: true). Even on small canvases, include every element.${isStrip ? `\n   STRIP BANNER EXCEPTION: On this strip banner, set visible:false for these element types: slot machine/game screenshots/reels, coin piles, decorative elements. ${is728x90 ? 'Speech bubbles CAN be visible on 728x90.' : 'Also hide speech bubbles on this small strip.'} Only show: background, ribbon, logo, headline, character (face/bust crop), and CTA.` : ' NEVER set visible to false.'}
4. VARIANT ELEMENTS: Some elements have a "variantOfId" pointing to a parent element. These are alternate renderings of the same content (e.g. a SHORT CTA or a 2-LINE headline). For each variant-group (parent + its variants), pick EXACTLY ONE to include — hide the others by setting their visible:false. Rules:
   This banner is ${targetWidth}×${targetHeight} (aspect ratio width/height = ${(targetWidth / targetHeight).toFixed(2)}). Classify:
     • SLIM/STRIP  if aspect >= 2.2 (e.g. 728x90, 970x250, 320x50)
     • TOWER/SKY   if aspect <= 0.45 (e.g. 160x600, 300x600, 120x600)
     • TALL/PORTRAIT if aspect < 0.72 but > 0.45 (e.g. 1080x1920, 1080x1350)
     • STANDARD    otherwise (square, landscape, most rectangles)

   - variantKind "short": pick this ONLY when the banner is SLIM/STRIP or TOWER/SKY. On STANDARD and TALL/PORTRAIT banners, use the ORIGINAL (parent) CTA — the full phrase fits.
   - variantKind "multiline" (2-line): pick this on TOWER/SKY and TALL/PORTRAIT banners where the original 1-line headline would be too wide. On SLIM/STRIP banners use the ORIGINAL (one-line text fits the strip width). On STANDARD banners use the ORIGINAL.
   - Never include both the parent AND its variant as visible — that would duplicate the asset.
   - The layout engine will auto-align variants to the parent's position/size; focus on picking the right one.

${ALL_COMPOSITION_RULES}
${sizeSpecificRules ? `\nSIZE-SPECIFIC RULES:\n${sizeSpecificRules}\n` : ''}
Return a JSON array with one entry per element:
[{ "elementId": "...", "x": number, "y": number, "scaleX": number, "scaleY": number, "visible": boolean }]

CRITICAL — USE THE POSITION TEMPLATES: The layout rules above contain EXACT percentage positions measured from professional reference banners. Place each element AT those positions. Adapt slightly for the specific canvas dimensions but stay within ~5% of the template values. Do NOT invent your own layout — follow the template.

CRITICAL — MATCH THE REFERENCES: If reference images are provided, replicate their composition style EXACTLY — element sizes, positions, overlaps, and visual density. The references are the ground truth.

CRITICAL — LOGO MUST BE SMALL: The company logo must be 10-17% of canvas width maximum. NEVER make it larger. On landscape, it goes top-right. On strips, it goes left after the ribbon.

CRITICAL — ARRAY ORDER IS Z-INDEX: Return elements in BACK-TO-FRONT order. First element = bottommost layer (background), last element = topmost layer (CTA/foreground). This order defines the visual stacking. If a reference template is provided, match its layer order EXACTLY.

x,y are the TOP-LEFT corner position in pixels. Scale is a multiplier on native dimensions.`;

  // Build multi-modal parts: reference images first, then text prompt
  const refImageParts: any[] = [];
  if (referenceImages && referenceImages.length > 0) {
    for (const ref of referenceImages) {
      try {
        const parsed = parseDataUrl(ref.dataUrl);
        refImageParts.push({
          text: `[Reference: user-approved ${ref.label} layout at ${ref.width}×${ref.height}]`,
        });
        refImageParts.push({ inlineData: { mimeType: parsed.mimeType, data: parsed.data } });
      } catch {
        // skip invalid data urls
      }
    }
    if (refImageParts.length > 0) {
      refImageParts.unshift({
        text: `VISUAL REFERENCES (CRITICAL — YOU MUST FOLLOW THESE): The following ${referenceImages.length} image(s) are user-approved layouts that define the visual language for this project. When designing the ${targetWidth}×${targetHeight} canvas you MUST:
1. Replicate the element ORDERING (which element is in front/behind)
2. Preserve the HIERARCHY (which element is dominant, secondary, tertiary)
3. Match the COMPOSITION (where things sit — top/center/bottom, left/center/right)
4. Keep the same relative SIZING ratios between elements
5. Keep the same CTA placement and prominence
Only deviate from the references when the aspect ratio absolutely forces it (e.g., slim strip needs horizontal reflow). Do NOT redesign. These references are the ground truth.`,
      });
    }
  }

  try {
    const response = await retryOperation(() =>
      ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: { parts: [...refImageParts, { text: prompt }] },
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

    // Validate and sanitize the AI response.
    // IMPORTANT: preserve the AI's response ORDER — it defines z-index (layer stacking).
    // The AI is instructed to return elements in visual layer order matching the template.
    const results: Array<{
      elementId: string; x: number; y: number;
      scaleX: number; scaleY: number; visible: boolean;
    }> = [];
    const processedIds = new Set<string>();

    // Phase 1: Process elements in the AI's response order (preserves z-index intent)
    for (const aiLayout of parsed) {
      const el = elements.find(e => e.id === aiLayout.elementId);
      if (!el || processedIds.has(el.id)) continue;
      processedIds.add(el.id);

      const isBackground = el.role === 'background';
      const sx = Math.max(0.01, aiLayout.scaleX || 1);
      const sy = Math.max(0.01, aiLayout.scaleY || 1);

      // ALL elements use uniform scale — even backgrounds (cover mode)
      const uniformScale = isBackground
        ? Math.max(targetWidth / el.nativeWidth, targetHeight / el.nativeHeight) // cover
        : Math.min(sx, sy); // use AI's suggestion but enforce uniform

      // Background: center it (cover mode crops edges)
      const bgX = isBackground ? Math.round((targetWidth - el.nativeWidth * uniformScale) / 2) : Math.round(Math.max(0, aiLayout.x || 0));
      const bgY = isBackground ? Math.round((targetHeight - el.nativeHeight * uniformScale) / 2) : Math.round(Math.max(0, aiLayout.y || 0));

      // Respect AI's visibility choice for variant elements and strip banners
      const isVariantElement = !!el.variantOfId || elements.some(other => other.variantOfId === el.id);
      // On strip banners, respect AI's visible:false (it's told to hide slots/coins/decorations)
      // On non-strip, non-variants always visible:true
      const visible = isVariantElement
        ? (aiLayout.visible !== false)
        : isStrip
          ? (aiLayout.visible !== false) // respect AI hiding on strips
          : true;

      results.push({
        elementId: el.id,
        x: bgX,
        y: bgY,
        scaleX: uniformScale,
        scaleY: uniformScale,
        visible,
      });
    }

    // Phase 2: Append any elements the AI missed (sensible defaults)
    for (const el of elements) {
      if (processedIds.has(el.id)) continue;
      const isBackground = el.role === 'background';
      const coverScale = Math.max(targetWidth / el.nativeWidth, targetHeight / el.nativeHeight);
      results.push({
        elementId: el.id,
        x: isBackground ? Math.round((targetWidth - el.nativeWidth * coverScale) / 2) : 0,
        y: isBackground ? Math.round((targetHeight - el.nativeHeight * coverScale) / 2) : 0,
        scaleX: isBackground ? coverScale : 0.5,
        scaleY: isBackground ? coverScale : 0.5,
        visible: true,
      });
    }

    // Phase 3: Post-processing — enforce hard layout constraints
    const isStripBanner = isStrip;

    // Strip banners: force-hide slots, coins, decorations, and bubbles (except 728x90 for bubbles)
    // Force-SHOW logo, ribbon/badge, headline, character, CTA, background
    if (isStripBanner) {
      for (const layout of results) {
        const el = elements.find(e => e.id === layout.elementId);
        if (!el) continue;
        const ll = el.label.toLowerCase();
        const isSlot = ll.includes('slot') || ll.includes('game') || ll.includes('screenshot') || ll.includes('reel') || ll.includes('tray');
        const isCoin = ll.includes('coin') || ll.includes('gold');
        const isDecoration = el.role === 'decoration' && !ll.includes('ribbon') && !ll.includes('badge') && !ll.includes('new');
        const isBubble = ll.includes('speech') || ll.includes('bubble');

        if (isSlot || isCoin || isDecoration) layout.visible = false;
        if (isBubble && !is728x90) layout.visible = false;

        // Force logo VISIBLE on strip banners (AI sometimes hides it)
        if (el.role === 'logo') layout.visible = true;
      }

      // --- STRIP LAYOUT ENFORCEMENT: left-to-right flow ---
      // Ribbon→Logo→Headline+Character→CTA(right)
      // Elements should fill ~70-80% of strip height, vertically centered
      const stripH = targetHeight;
      const stripW = targetWidth;
      const fillH = stripH * 0.75; // target element height

      for (const layout of results) {
        const el = elements.find(e => e.id === layout.elementId);
        if (!el || el.role === 'background' || !layout.visible) continue;
        const ll = el.label.toLowerCase();

        // Scale all visible strip elements to fill ~75% of strip height
        const isRibbon = ll.includes('ribbon') || ll.includes('badge') || ll.includes('new');
        const isLogo = el.role === 'logo';
        const isChar = el.role === 'character';
        const isCTA = el.role === 'cta' || ll.includes('cta') || ll.includes('button');
        const isText = el.role === 'text';

        if (isRibbon || isLogo || isChar || isCTA) {
          const targetElemH = isRibbon ? stripH * 0.80 : fillH;
          const scale = targetElemH / el.nativeHeight;
          layout.scaleX = scale;
          layout.scaleY = scale;
        }

        // Vertically center all non-background elements
        const elemH = el.nativeHeight * layout.scaleY;
        layout.y = Math.round((stripH - elemH) / 2);

        // Horizontal positioning: ribbon flush left, logo next, then headline/char center, CTA right
        const elemW = el.nativeWidth * layout.scaleX;
        if (isRibbon) {
          layout.x = 0;
          layout.y = 0; // ribbon flush top-left corner
        } else if (isLogo) {
          // Place logo right after the ribbon
          const ribbonLayout = results.find(r => {
            const re = elements.find(e => e.id === r.elementId);
            return re && r.visible && (re.label.toLowerCase().includes('ribbon') || re.label.toLowerCase().includes('badge') || re.label.toLowerCase().includes('new'));
          });
          const ribbonRight = ribbonLayout ? ribbonLayout.x + elements.find(e => e.id === ribbonLayout.elementId)!.nativeWidth * ribbonLayout.scaleX : 0;
          layout.x = Math.round(ribbonRight + stripW * 0.01);
        } else if (isCTA) {
          // CTA right-aligned with small margin
          layout.x = Math.round(stripW - elemW - stripW * 0.02);
        }
      }

      // Position headline and character in the center zone
      const logoLayout = results.find(r => {
        const el = elements.find(e => e.id === r.elementId);
        return el?.role === 'logo' && r.visible;
      });
      const ctaLayout = results.find(r => {
        const el = elements.find(e => e.id === r.elementId);
        return (el?.role === 'cta' || el?.label.toLowerCase().includes('cta')) && r.visible;
      });
      const logoRight = logoLayout ? logoLayout.x + elements.find(e => e.id === logoLayout.elementId)!.nativeWidth * logoLayout.scaleX : stripW * 0.15;
      const ctaLeft = ctaLayout ? ctaLayout.x : stripW * 0.75;
      const centerZoneStart = logoRight + stripW * 0.02;
      const centerZoneEnd = ctaLeft - stripW * 0.02;
      const centerZoneW = Math.max(stripW * 0.15, centerZoneEnd - centerZoneStart);

      for (const layout of results) {
        const el = elements.find(e => e.id === layout.elementId);
        if (!el || !layout.visible || el.role === 'background') continue;
        const ll = el.label.toLowerCase();
        const isText = el.role === 'text';
        const isChar = el.role === 'character';

        if (isText) {
          // Scale headline to fill center zone width (~80%) and fit strip height
          const textTargetW = Math.max(20, centerZoneW * 0.75);
          const textTargetH = stripH * 0.60;
          const textScale = Math.max(0.01, Math.min(textTargetW / el.nativeWidth, textTargetH / el.nativeHeight));
          layout.scaleX = textScale;
          layout.scaleY = textScale;
          const textW = el.nativeWidth * textScale;
          const textH = el.nativeHeight * textScale;
          layout.x = Math.round(centerZoneStart + (centerZoneW - textW) / 2);
          layout.y = Math.round((stripH - textH) / 2);
        } else if (isChar) {
          // Character: bust/face closeup, positioned center-right in the center zone
          const charTargetH = stripH * 0.85;
          const charScale = charTargetH / el.nativeHeight;
          layout.scaleX = charScale;
          layout.scaleY = charScale;
          const charW = el.nativeWidth * charScale;
          const charH = el.nativeHeight * charScale;
          // Place character in right portion of center zone
          layout.x = Math.round(centerZoneEnd - charW - centerZoneW * 0.05);
          layout.y = Math.round((stripH - charH) / 2);
        }
      }
    }

    // --- Build lookup maps for cross-element constraints ---
    const layoutMap = new Map<string, typeof results[0]>();
    const elMap = new Map<string, typeof elements[0]>();
    for (const layout of results) {
      layoutMap.set(layout.elementId, layout);
      const el = elements.find(e => e.id === layout.elementId);
      if (el) elMap.set(el.id, el);
    }

    // Helper: get element bounding box
    const getBox = (layout: typeof results[0], el: typeof elements[0]) => ({
      x: layout.x, y: layout.y,
      w: el.nativeWidth * layout.scaleX, h: el.nativeHeight * layout.scaleY,
      right: layout.x + el.nativeWidth * layout.scaleX,
      bottom: layout.y + el.nativeHeight * layout.scaleY,
    });

    console.log(`[POST-PROCESS] ${targetWidth}x${targetHeight} — ${results.length} elements, isStrip=${isStripBanner}`);
    for (const layout of results) {
      const el = elMap.get(layout.elementId);
      if (!el || el.role === 'background' || !layout.visible) continue;

      const lowerLabel = el.label.toLowerCase();
      console.log(`  [PP] "${el.label}" role=${el.role} pos=(${layout.x},${layout.y}) scale=${layout.scaleX.toFixed(3)}`);

      // --- Post-processing: enforce critical constraints only ---

      // Ribbon: always flush to (0,0)
      const isRibbon = lowerLabel.includes('ribbon') || lowerLabel.includes('badge') || (lowerLabel.includes('new') && el.role === 'decoration');
      if (isRibbon) {
        layout.x = 0;
        layout.y = 0;
      }

      // Logo: max 20% of canvas width (AI sometimes makes it huge)
      const isLogo = el.role === 'logo';
      if (isLogo) {
        const maxLogoW = targetWidth * 0.20;
        const logoW = el.nativeWidth * layout.scaleX;
        if (logoW > maxLogoW) {
          const shrink = maxLogoW / el.nativeWidth;
          layout.scaleX = shrink;
          layout.scaleY = shrink;
        }
      }

      // CTA: ensure 3% margin from canvas edges
      const isCTA = el.role === 'cta' || lowerLabel.includes('cta') || lowerLabel.includes('button');
      if (isCTA && !isStripBanner) {
        const ctaW = el.nativeWidth * layout.scaleX;
        const ctaH = el.nativeHeight * layout.scaleY;
        const minM = Math.max(4, targetWidth * 0.03);
        if (layout.y + ctaH > targetHeight - minM) layout.y = Math.round(targetHeight - ctaH - minM);
        if (layout.x < minM) layout.x = Math.round(minM);
        if (layout.x + ctaW > targetWidth - minM) layout.x = Math.round(targetWidth - ctaW - minM);
      }

      // Prevent elements from being completely off-canvas (except background and coins)
      const isCoin = lowerLabel.includes('coin') || lowerLabel.includes('gold');
      if (!isCoin && el.role !== 'background') {
        const elW = el.nativeWidth * layout.scaleX;
        const elH = el.nativeHeight * layout.scaleY;
        // At least 50% of element must be visible
        if (layout.x + elW < elW * 0.5) layout.x = 0;
        if (layout.y + elH < elH * 0.5) layout.y = 0;
        if (layout.x > targetWidth - elW * 0.5) layout.x = Math.round(targetWidth - elW);
        if (layout.y > targetHeight - elH * 0.5) layout.y = Math.round(targetHeight - elH);
      }
    }

    // --- FIX 2: Speech bubble must NOT overlap character face ---
    for (const layout of results) {
      const el = elMap.get(layout.elementId);
      if (!el || !layout.visible) continue;
      const ll = el.label.toLowerCase();
      if (!(ll.includes('speech') || ll.includes('bubble'))) continue;

      // Find the character element
      const charLayout = results.find(r => {
        const e = elMap.get(r.elementId);
        return e && r.visible && (e.role === 'character' || e.label.toLowerCase().includes('character'));
      });
      if (!charLayout) continue;
      const charEl = elMap.get(charLayout.elementId)!;
      const charBox = getBox(charLayout, charEl);
      const bubbleBox = getBox(layout, el);

      // Face = top 35% of character
      const faceBottom = charBox.y + charBox.h * 0.35;
      const faceTop = charBox.y;

      // Check if bubble overlaps the face zone at all (generous detection)
      const safeMargin = Math.max(10, targetHeight * 0.02);
      const hOverlap = Math.min(bubbleBox.right, charBox.right + safeMargin) - Math.max(bubbleBox.x, charBox.x - safeMargin);
      const vOverlap = Math.min(bubbleBox.bottom, faceBottom + safeMargin) - Math.max(bubbleBox.y, faceTop - safeMargin);

      if (hOverlap > 0 && vOverlap > 0) {
        const gap = Math.max(8, targetHeight * 0.03);
        // Strategy 1: Place bubble ABOVE character head
        const aboveY = Math.round(faceTop - bubbleBox.h - gap);
        if (aboveY >= 0) {
          layout.y = aboveY;
          // Keep x near character but not overlapping face
          layout.x = Math.round(Math.max(0, Math.min(charBox.x, targetWidth - bubbleBox.w)));
        } else {
          // Strategy 2: Place bubble to the RIGHT of character
          const rightX = Math.round(charBox.right + gap);
          if (rightX + bubbleBox.w <= targetWidth) {
            layout.x = rightX;
            layout.y = Math.round(Math.max(0, charBox.y));
          } else {
            // Strategy 3: Place bubble to the LEFT of character
            const leftX = Math.round(charBox.x - bubbleBox.w - gap);
            if (leftX >= 0) {
              layout.x = leftX;
              layout.y = Math.round(Math.max(0, charBox.y));
            } else {
              // Strategy 4: Above with y=0, shifted horizontally
              layout.y = 0;
              layout.x = Math.round(Math.min(charBox.x - bubbleBox.w * 0.5, targetWidth - bubbleBox.w));
              layout.x = Math.max(0, layout.x);
            }
          }
        }
        console.log(`    → BUBBLE FIX: moved to (${layout.x},${layout.y}) away from face zone`);
      }
    }

    // --- FIX 5: Character must not cover slot machine ---
    for (const layout of results) {
      const el = elMap.get(layout.elementId);
      if (!el || !layout.visible) continue;
      if (!(el.role === 'character' || el.label.toLowerCase().includes('character'))) continue;

      // Find the slot/game element
      const slotLayout = results.find(r => {
        const e = elMap.get(r.elementId);
        if (!e || !r.visible) return false;
        const sl = e.label.toLowerCase();
        return sl.includes('slot') || sl.includes('game') || sl.includes('reel') || sl.includes('tray') || sl.includes('screenshot');
      });
      if (!slotLayout) continue;
      const slotEl = elMap.get(slotLayout.elementId)!;
      const slotBox = getBox(slotLayout, slotEl);
      const charBox = getBox(layout, el);

      // Calculate horizontal overlap
      const overlapLeft = Math.max(charBox.x, slotBox.x);
      const overlapRight = Math.min(charBox.right, slotBox.right);
      const hOverlap = Math.max(0, overlapRight - overlapLeft);

      // If character overlaps slot by more than 10% of slot width, push character beside it
      if (hOverlap > slotBox.w * 0.10) {
        const isPortraitCanvas = targetHeight > targetWidth;
        const charCenter = charBox.x + charBox.w / 2;
        const slotCenter = slotBox.x + slotBox.w / 2;

        // Decide which side: put character to the right if it's mostly right of slot center
        if (charCenter >= slotCenter || isPortraitCanvas) {
          // Character goes RIGHT of slot
          const newX = Math.round(slotBox.right + targetWidth * 0.01);
          if (newX + charBox.w <= targetWidth * 1.02) {
            layout.x = newX;
          } else {
            // Doesn't fit right — scale character down to fit
            const available = targetWidth - slotBox.right - targetWidth * 0.02;
            if (available > charBox.w * 0.4) {
              layout.x = Math.round(slotBox.right + targetWidth * 0.01);
              const newScale = available / el.nativeWidth;
              layout.scaleX = Math.min(layout.scaleX, newScale);
              layout.scaleY = layout.scaleX;
            } else {
              // Last resort: put character LEFT of slot
              layout.x = Math.round(Math.max(0, slotBox.x - charBox.w - targetWidth * 0.01));
            }
          }
        } else {
          // Character goes LEFT of slot
          layout.x = Math.round(Math.max(0, slotBox.x - charBox.w - targetWidth * 0.01));
        }
        console.log(`    → CHAR-SLOT FIX: char moved to x=${layout.x} (slot at ${Math.round(slotBox.x)}-${Math.round(slotBox.right)})`);
      }
    }

    // --- FIX 6: Headline must not overlap ribbon ---
    for (const layout of results) {
      const el = elMap.get(layout.elementId);
      if (!el || !layout.visible) continue;
      if (!(el.role === 'text' || el.label.toLowerCase().includes('headline') || el.label.toLowerCase().includes('title'))) continue;

      // Find ribbon
      const ribbonLayout = results.find(r => {
        const e = elMap.get(r.elementId);
        if (!e || !r.visible) return false;
        const rl = e.label.toLowerCase();
        return rl.includes('ribbon') || rl.includes('badge') || rl.includes('new');
      });
      if (!ribbonLayout) continue;
      const ribbonEl = elMap.get(ribbonLayout.elementId)!;
      const ribbonBox = getBox(ribbonLayout, ribbonEl);
      const headlineBox = getBox(layout, el);

      // Check overlap (with margin)
      const ribbonMargin = Math.max(5, targetHeight * 0.02);
      if (headlineBox.x < ribbonBox.right + ribbonMargin && headlineBox.y < ribbonBox.bottom + ribbonMargin &&
          headlineBox.right > ribbonBox.x - ribbonMargin && headlineBox.bottom > ribbonBox.y - ribbonMargin) {
        // Push headline below the ribbon with clear gap
        layout.y = Math.round(ribbonBox.bottom + ribbonMargin);
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
  const isNarrow = isNarrowBanner(targetWidth, targetHeight);
  const isTall = targetHeight > targetWidth;

  for (const el of elements) {
    // Variant handling: on narrow banners prefer 'short' variants; on tall banners prefer 'multiline'
    // On standard banners, only use parents (non-variants).
    if (el.variantOfId) {
      const useThisVariant =
        (el.variantKind === 'short' && isNarrow) ||
        (el.variantKind === 'multiline' && (isTall || isNarrow));
      if (!useThisVariant) {
        results.push({ elementId: el.id, x: 0, y: 0, scaleX: 1, scaleY: 1, visible: false });
        continue;
      }
    } else {
      // This is a parent — if any of its variants will be used, hide the parent
      const replacedByVariant = elements.some(v =>
        v.variantOfId === el.id &&
        ((v.variantKind === 'short' && isNarrow) ||
         (v.variantKind === 'multiline' && (isTall || isNarrow)))
      );
      if (replacedByVariant) {
        results.push({ elementId: el.id, x: 0, y: 0, scaleX: 1, scaleY: 1, visible: false });
        continue;
      }
    }

    if (el.role === 'background') {
      // Cover mode: uniform scale, centered
      const coverScale = Math.max(targetWidth / el.nativeWidth, targetHeight / el.nativeHeight);
      results.push({
        elementId: el.id,
        x: Math.round((targetWidth - el.nativeWidth * coverScale) / 2),
        y: Math.round((targetHeight - el.nativeHeight * coverScale) / 2),
        scaleX: coverScale,
        scaleY: coverScale,
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
