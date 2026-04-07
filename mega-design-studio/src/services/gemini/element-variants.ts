/**
 * Element Variant Generation
 *
 * After extracting CTA buttons and headline text from a source banner, this module
 * generates AI-edited variants optimized for different banner sizes:
 *
 *  - Short CTA: original button graphic but with a 1-word label (e.g. "SPIN NOW" → "SPIN")
 *    for use on narrow/small banners where full copy would be cropped.
 *  - 2-Line Headline: original headline text reflowed to 2 lines for tall / narrow banners.
 */
import { modifyImage } from './image';
import { whiteToAlpha, autoTrimTransparent } from './banner';
import { CTA_ABBREVIATION_MAP } from './banner-rules';

interface VariantResult {
  dataUrl: string;
  nativeWidth: number;
  nativeHeight: number;
  detectedText: string;
}

/** Pick a short version of a CTA phrase (for the AI prompt). */
export function pickShortCta(fullText: string): string {
  const upper = fullText.trim().toUpperCase();
  if (CTA_ABBREVIATION_MAP[upper]) return CTA_ABBREVIATION_MAP[upper];
  // Fallback: take first meaningful word
  const words = upper.replace(/[^A-Z0-9 ]/g, '').split(/\s+/).filter(Boolean);
  return words[0] || fullText;
}

/**
 * Generate a short-text CTA variant (same button style, shorter label).
 * Returns null on failure.
 */
export async function generateShortCtaVariant(
  sourceDataUrl: string,
  originalText: string,
): Promise<VariantResult | null> {
  const shortText = pickShortCta(originalText);
  if (!shortText || shortText === originalText.trim().toUpperCase()) return null;

  const prompt = `You are editing a call-to-action button. The input image shows a CTA button that currently reads "${originalText}".

TASK: Replace the text on this button with "${shortText}" (one short word) while keeping:
- The SAME button shape, color, gradient, border, and style
- The SAME font, weight, and text color
- The SAME stroke/shadow effects on the text

The new text should be centered and scaled to fit nicely inside the button.
Output: the button on a pure WHITE background (#FFFFFF), no additional elements.
Do NOT change the button itself — ONLY swap the text. Keep the button looking identical.`;

  try {
    const raw = await modifyImage(sourceDataUrl, prompt, '1:1', [], true);
    if (!raw) return null;
    const transparent = await whiteToAlpha(raw, 25);
    const trimmed = await autoTrimTransparent(transparent, 2);

    const dims = await new Promise<{ w: number; h: number }>((resolve) => {
      const img = new Image();
      img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
      img.onerror = () => resolve({ w: 100, h: 40 });
      img.src = trimmed.dataUrl;
    });

    return {
      dataUrl: trimmed.dataUrl,
      nativeWidth: dims.w,
      nativeHeight: dims.h,
      detectedText: shortText,
    };
  } catch (err) {
    console.warn('generateShortCtaVariant failed:', err);
    return null;
  }
}

/**
 * Generate a 2-line headline variant (text reflowed for tall/narrow banners).
 * Returns null on failure.
 */
export async function generateMultilineTextVariant(
  sourceDataUrl: string,
  originalText: string,
): Promise<VariantResult | null> {
  const words = originalText.trim().split(/\s+/).filter(Boolean);
  if (words.length < 2) return null;

  // Balanced split: find the break point that makes both lines closest in character length
  let bestSplit = Math.ceil(words.length / 2);
  let bestDiff = Infinity;
  for (let i = 1; i < words.length; i++) {
    const l1 = words.slice(0, i).join(' ');
    const l2 = words.slice(i).join(' ');
    const diff = Math.abs(l1.length - l2.length);
    if (diff < bestDiff) {
      bestDiff = diff;
      bestSplit = i;
    }
  }

  const line1 = words.slice(0, bestSplit).join(' ');
  const line2 = words.slice(bestSplit).join(' ');

  const prompt = `You are editing a headline text graphic. The input image shows text that currently reads "${originalText}" on one line.

TASK: Reflow the SAME text as EXACTLY 2 lines (TWO lines, not three):
  Line 1: "${line1}"
  Line 2: "${line2}"

ABSOLUTE RULES:
- Output EXACTLY 2 lines of text. NOT 1 line, NOT 3 lines. Exactly 2.
- "${line2}" must be ONE SINGLE line — do NOT break it further.
- The "&" symbol must stay on the same line as the word next to it.
- Each line should be roughly the same width (balanced).

Keep ALL of the following IDENTICAL:
- Font family, weight, and style
- Text color, stroke, and shadow effects
- Any gradient or texture on the letters
- Overall text treatment and mood

The two lines should be centered, stacked vertically with comfortable line-height.
Output: the text on a pure WHITE background (#FFFFFF), no additional elements.
Do NOT change the wording or spelling — ONLY change the line-break layout.`;

  try {
    // Use 16:9 aspect ratio to give horizontal room — prevents AI from breaking into 3 lines
    const raw = await modifyImage(sourceDataUrl, prompt, '16:9', [], true);
    if (!raw) return null;
    const transparent = await whiteToAlpha(raw, 25);
    const trimmed = await autoTrimTransparent(transparent, 2);

    const dims = await new Promise<{ w: number; h: number }>((resolve) => {
      const img = new Image();
      img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
      img.onerror = () => resolve({ w: 200, h: 80 });
      img.src = trimmed.dataUrl;
    });

    return {
      dataUrl: trimmed.dataUrl,
      nativeWidth: dims.w,
      nativeHeight: dims.h,
      detectedText: `${line1}\n${line2}`,
    };
  } catch (err) {
    console.warn('generateMultilineTextVariant failed:', err);
    return null;
  }
}
