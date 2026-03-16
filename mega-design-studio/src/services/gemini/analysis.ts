import { Type } from "@google/genai";
import { getAI, parseDataUrl, createImageParts } from "./client";
import { ReelGridAnalysis, SymbolConsistencyMap } from "@/types";

/** Refine a video prompt by analyzing the scene image (Animatix) */
export const refineVideoPrompt = async (
  imageBase64: string,
  originalActionPrompt: string,
  cameraAngle: string
): Promise<string> => {
  const ai = getAI();
  const m = imageBase64.match(/^data:(image\/[a-zA-Z+]+);base64,(.+)$/);
  if (!m) return originalActionPrompt;
  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: {
        parts: [
          { inlineData: { mimeType: m[1], data: m[2] } },
          { text: `Analyze the composition. Action: "${originalActionPrompt}". Write a 1-sentence cinematic motion directive for Veo.` }
        ]
      }
    });
    return response.text?.trim() || originalActionPrompt;
  } catch {
    return originalActionPrompt;
  }
};

/** Describe a video segment for prompt generation (Video Extractor) */
export const describeVideoSegment = async (
  motionFrames: string[],
  styleFrames: string[],
  duration?: number
): Promise<{ description: string; prompt: string; cameraMotion: string; shotType: string }> => {
  const ai = getAI();

  const motionParts = createImageParts(motionFrames);
  const styleParts = createImageParts(styleFrames);
  const durationInfo = duration ? ` (Duration: ${duration.toFixed(1)}s)` : '';

  const contents = {
    parts: [
      { text: `SECTION 1: SOURCE VIDEO MOTION (Raw Frames)${durationInfo}\nThese frames represent the ORIGINAL VIDEO. Analyze them purely for PHYSICAL MOVEMENT, CAMERA WORK, and TIMING.` },
      ...motionParts,
      { text: "SECTION 2: TARGET STYLE (Modified Frames)\nThese frames represent the DESIRED LOOK (Reskin). Analyze them for the art style, character appearance, and lighting." },
      ...styleParts,
      {
        text: `
        TASK: Generate a precise video generation prompt that "Reskins" the Source Video into the Target Style.
        CONSTRUCTION RULES:
        The final prompt MUST follow this formula:
        "[Camera Motion], [Shot Type]. [Action Description using Target Visuals]. [Target Art Style & Atmosphere]."
        OUTPUT JSON:
        - "analysis_summary": Brief explanation of the transformation.
        - "camera_motion": Specific camera movement detected.
        - "shot_type": Specific shot scale.
        - "prompt": The final optimized prompt.
      `
      }
    ]
  };

  const response = await ai.models.generateContent({
    model: 'gemini-3-flash-preview',
    contents,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          analysis_summary: { type: Type.STRING },
          camera_motion: { type: Type.STRING },
          shot_type: { type: Type.STRING },
          prompt: { type: Type.STRING }
        },
        required: ["analysis_summary", "camera_motion", "shot_type", "prompt"]
      }
    }
  });

  const data = JSON.parse(response.text || '{}');
  return {
    description: data.analysis_summary || "Segment analyzed.",
    cameraMotion: data.camera_motion || "Unknown",
    shotType: data.shot_type || "Unknown",
    prompt: data.prompt || "Cinematic video."
  };
};

/** Analyze motion between keyframes for transition prompts (Video Extractor) */
export const analyzeMotionInterval = async (
  frames: string[],
  duration: number,
  contextPrompt?: string
): Promise<string> => {
  const ai = getAI();
  const parts: any[] = createImageParts(frames);

  parts.push({
    text: `
    Analyze the sequence of frames provided (Duration: ${duration.toFixed(2)}s).
    ${contextPrompt ? `Context: ${contextPrompt}` : ""}
    TASK: Write a PRECISE MECHANICAL DESCRIPTION of the action.
    CRITICAL INSTRUCTIONS FOR ACCURACY:
    1. IDENTIFY SPECIFIC ELEMENTS: If this is a slot machine, do not say "stuff moves". Say "Reel 3 spins down", "The 'Wild' symbol enlarges", "Coins explode from center".
    2. TRACK VISIBILITY: Explicitly state if an object APPEARS, DISAPPEARS, or is OBSCURED.
    3. TRACK TRAJECTORY: Use vector terms like "translates left-to-right", "rotates 90 degrees", "scales up 2x".
    4. CHARACTER ACTION: If a character is present, define their exact limb movement.
    BAD EXAMPLE: "A dynamic scene with lights."
    GOOD EXAMPLE: "The central character lunges forward with a sword. In the background, three red sevens spin vertically on a reel and stop abruptly. Gold particles rain from the top."
    OUTPUT:
    A single, highly detailed descriptive paragraph (50-80 words). No intro, no markdown.
    `
  });

  const response = await ai.models.generateContent({
    model: 'gemini-3-flash-preview',
    contents: { parts }
  });

  return response.text?.trim() || "";
};

/** Analyze a source frame to detect slot machine reel grid structure */
export const analyzeReelGrid = async (
  imageDataUrl: string
): Promise<ReelGridAnalysis> => {
  const ai = getAI();
  const { mimeType, data } = parseDataUrl(imageDataUrl);

  const response = await ai.models.generateContent({
    model: 'gemini-3-flash-preview',
    contents: {
      parts: [
        { inlineData: { mimeType, data } },
        {
          text: `Analyze this image and determine if it contains a slot machine reel grid.

IF this is a slot machine / reel grid image:
- Count the EXACT number of visible rows and columns of symbol positions
- For each cell position (row, col), describe the symbol briefly (e.g., "golden coin", "red cherry", "blue diamond", "letter A in gothic font")
- Describe the cabinet/frame surrounding the grid (colors, materials, decorative elements)
- Note grid layout specifics (cell spacing, alignment, partial symbols above/below)

IF this is NOT a slot machine grid (e.g., a character scene, landscape, UI screenshot):
- Set isReelContent to false and leave other fields empty/default

Be precise with row/column counts. Rows are horizontal, columns are vertical reels. A typical slot has 3-5 columns and 3-4 visible rows per reel.`
        }
      ]
    },
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          isReelContent: { type: Type.BOOLEAN },
          rows: { type: Type.NUMBER },
          cols: { type: Type.NUMBER },
          symbols: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                row: { type: Type.NUMBER },
                col: { type: Type.NUMBER },
                description: { type: Type.STRING }
              },
              required: ["row", "col", "description"]
            }
          },
          cabinetDescription: { type: Type.STRING },
          gridLayoutNotes: { type: Type.STRING }
        },
        required: ["isReelContent", "rows", "cols", "symbols", "cabinetDescription", "gridLayoutNotes"]
      }
    }
  });

  return JSON.parse(response.text || '{"isReelContent":false,"rows":0,"cols":0,"symbols":[],"cabinetDescription":"","gridLayoutNotes":""}');
};

/** Compare original and reskinned frames to build a symbol consistency map */
export const analyzeReskinResult = async (
  originalImageDataUrl: string,
  reskinImageDataUrl: string,
  originalGrid: ReelGridAnalysis
): Promise<SymbolConsistencyMap[]> => {
  const ai = getAI();
  const originalParts = parseDataUrl(originalImageDataUrl);
  const reskinParts = parseDataUrl(reskinImageDataUrl);

  const symbolList = originalGrid.symbols
    .map(s => `  (${s.row},${s.col}): "${s.description}"`)
    .join('\n');

  const response = await ai.models.generateContent({
    model: 'gemini-3-flash-preview',
    contents: {
      parts: [
        { text: "IMAGE 1 (ORIGINAL):" },
        { inlineData: { mimeType: originalParts.mimeType, data: originalParts.data } },
        { text: "IMAGE 2 (RESKINNED RESULT):" },
        { inlineData: { mimeType: reskinParts.mimeType, data: reskinParts.data } },
        {
          text: `The original image contained these symbols:
${symbolList}

Compare the original and reskinned images. For each UNIQUE original symbol type, identify what it was transformed into in the reskinned version.
Group identical symbols (e.g., if "cherry" appears at (1,1) and (2,3), they should map to the same new symbol).
Return one entry per unique symbol type, not per cell.`
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
            originalDescription: { type: Type.STRING },
            reskinDescription: { type: Type.STRING }
          },
          required: ["originalDescription", "reskinDescription"]
        }
      }
    }
  });

  return JSON.parse(response.text || '[]');
};

/** Detect all unique symbols in a slot machine image and return their bounding boxes.
 *  Returns deduplicated list — each unique symbol appears once with a tight bbox (% of image). */
export interface DetectedSymbol {
  name: string;
  role: 'low' | 'high' | 'wild' | 'scatter';
  bbox: { x: number; y: number; w: number; h: number }; // percentages 0-100
  isLongTile: boolean;
}

export const detectSymbolPositions = async (
  imageDataUrl: string
): Promise<DetectedSymbol[]> => {
  const ai = getAI();
  const { mimeType, data } = parseDataUrl(imageDataUrl);

  const response = await ai.models.generateContent({
    model: 'gemini-3-flash-preview',
    contents: {
      parts: [
        { inlineData: { mimeType, data } },
        { text: `Analyze this slot machine / reel grid image. Find every UNIQUE game symbol visible in the grid.

For each unique symbol, return:
- name: A short name. Use standard names for card symbols: "9", "10", "J", "Q", "K", "A". For themed symbols describe them briefly: "Golden Dragon", "Ruby Gem", "Blue Crystal", etc. For special symbols use: "Wild", "Scatter", "Bonus".
- role: MUST be one of these four values:
  • "low" — Low-paying card/letter symbols: 9, 10, J, Q, K, A (and similar plain text/number symbols)
  • "high" — High-paying themed/illustrated symbols: characters, objects, animals, gems, artifacts, any pictorial game symbol that is NOT a simple card rank
  • "wild" — Wild symbol (usually says "WILD" on it)
  • "scatter" — Scatter or Bonus symbol (usually says "SCATTER" or "BONUS")
- bbox: The bounding box of ONE clear instance of this symbol as percentages of the full image (x, y = top-left corner; w, h = dimensions). Values must be 0-100. The box should tightly fit the symbol with minimal padding.
- isLongTile: true if the symbol spans multiple rows vertically (tall/elongated tile), false for normal single-cell symbols.

RULES:
- Return each UNIQUE symbol only ONCE — pick the clearest/most visible instance for its bbox.
- Do NOT return duplicate entries for the same symbol appearing in multiple grid positions.
- Be PRECISE with bounding boxes — they should tightly frame each symbol, not the entire cell.
- Include ALL visible symbols, even partially visible ones at edges if identifiable.
- IMPORTANT: Correctly classify role. Card symbols (9,10,J,Q,K,A) = "low". Illustrated/themed symbols = "high". Only use "wild"/"scatter" for those specific special symbols.
- Order them: low symbols first (9, 10, J, Q, K, A), then high/themed symbols, then special (Wild, Scatter, Bonus) last.` }
      ]
    },
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            name: { type: Type.STRING },
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
            isLongTile: { type: Type.BOOLEAN },
          },
          required: ["name", "role", "bbox", "isLongTile"]
        }
      }
    }
  });

  const parsed = JSON.parse(response.text || '[]');
  // Validate and clamp bounding boxes
  return parsed.map((s: any) => ({
    name: s.name || 'Symbol',
    role: (['low', 'high', 'wild', 'scatter'].includes(s.role) ? s.role : 'low') as 'low' | 'high' | 'wild' | 'scatter',
    bbox: {
      x: Math.max(0, Math.min(100, s.bbox?.x || 0)),
      y: Math.max(0, Math.min(100, s.bbox?.y || 0)),
      w: Math.max(1, Math.min(100, s.bbox?.w || 10)),
      h: Math.max(1, Math.min(100, s.bbox?.h || 10)),
    },
    isLongTile: !!s.isLongTile,
  }));
};
