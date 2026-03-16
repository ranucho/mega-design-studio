import { Type, Schema } from "@google/genai";
import { getAI } from "./client";
import { Character, GeneratedSceneRaw } from "@/types";

export const generateRandomStoryConcept = async (): Promise<{
  characters: Character[];
  style: string;
  brief: string;
  sceneCount: number;
  aspectRatio: string;
}> => {
  const ai = getAI();

  const themes = [
    "Cyberpunk City", "High Fantasy Forest", "Space Opera", "Noir Detective",
    "Steampunk Invention", "Post-Apocalyptic Solarpunk", "1980s Retro VHS",
    "Gothic Horror", "Abstract Surrealism", "Spaghetti Western", "Underwater Kingdom",
    "Microscopic World", "Toy Story style", "Ancient Egypt", "Futuristic Sports"
  ];
  const randomTheme = themes[Math.floor(Math.random() * themes.length)];
  const seed = Date.now();

  const prompt = `
    TASK: Generate a completely random, creative, and unique story concept for a short animated video.
    SYSTEM_ENTROPY_SEED: ${seed} (Do not ignore this, use it to randomize choices).
    MANDATORY GENRE/THEME: ${randomTheme}.
    REQUIREMENTS:
    1. Create 2-3 unique characters that fit the ${randomTheme} theme.
    2. Choose a visually striking art style that fits ${randomTheme}.
    3. Write a concise but interesting plot brief (max 2 sentences).
    4. Pick a scene count between 4 and 8.
    5. Pick an aspect ratio (16:9 or 9:16).
    Output JSON: { "characters": [{ "name": "string", "description": "string", "type": "character" }], "style": "string", "brief": "string", "sceneCount": number, "aspectRatio": "string" }
  `;

  const responseSchema: Schema = {
    type: Type.OBJECT,
    properties: {
      characters: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: { name: { type: Type.STRING }, description: { type: Type.STRING }, type: { type: Type.STRING } }
        }
      },
      style: { type: Type.STRING },
      brief: { type: Type.STRING },
      sceneCount: { type: Type.INTEGER },
      aspectRatio: { type: Type.STRING }
    }
  };

  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      responseSchema,
      temperature: 1.2,
      topK: 40
    }
  });

  const data = JSON.parse(response.text || "{}");
  return {
    ...data,
    characters: data.characters.map((c: any, i: number) => ({ ...c, id: String(i + 1), inputReferences: [] }))
  };
};

export const generateStoryStructure = async (
  characters: Character[],
  style: string,
  brief: string,
  sceneCount: number
): Promise<{ title: string; scenes: GeneratedSceneRaw[]; key_elements?: any[] }> => {
  const ai = getAI();
  const charDesc = characters.map((c) => `${c.name}: ${c.description}`).join("\n");

  const prompt = `
    Role: Professional Screenwriter.
    Characters: ${charDesc}
    Visual Aesthetic: ${style}
    Story Brief: ${brief}
    TASK: Write a ${sceneCount}-scene script.
    MANDATORY INSTRUCTION: In the "visual_prompt" for EACH scene, explicitly mention the character's clothing and specific traits (e.g., "John in his blue surfsuit, NO glasses, NO beard"). This acts as a reinforcement loop for the image generator.
    Output JSON: { "title": "string", "scenes": [{ "title": "string", "dialogue": "string", "visual_prompt": "string", "video_prompt": "string", "camera_angle": "string" }] }
  `;

  const responseSchema: Schema = {
    type: Type.OBJECT,
    properties: {
      title: { type: Type.STRING },
      scenes: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            title: { type: Type.STRING },
            dialogue: { type: Type.STRING },
            visual_prompt: { type: Type.STRING },
            video_prompt: { type: Type.STRING },
            camera_angle: { type: Type.STRING },
          },
          required: ["title", "dialogue", "visual_prompt", "video_prompt", "camera_angle"],
        },
      },
    },
    required: ["title", "scenes"],
  };

  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: prompt,
    config: { responseMimeType: "application/json", responseSchema },
  });
  return JSON.parse(response.text || "{}");
};
