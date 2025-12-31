import { GoogleGenerativeAI } from "@google/generative-ai";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
    try {
        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) {
            return NextResponse.json(
                { error: "GEMINI_API_KEY is not set in environment variables." },
                { status: 500 }
            );
        }

        const { title, articleText, promptOverride, visualStyle, character, referenceImage, strictCharacter } = await req.json();

        let imagePrompt = promptOverride;

        if (!imagePrompt) {
            try {
                // 1. Generate a CONCISE Visual Scene Description based ONLY on the Title (to keep it clean and symbolic)
                const genAI = new GoogleGenerativeAI(apiKey);
                const model = genAI.getGenerativeModel({ model: "gemini-3-flash-preview" });

                let subjectSetting = character;
                if (character === "note記事つくレッサーパンダ") {
                    subjectSetting = "A cute, fluffy red panda character with big sparkling eyes, holding a pencil and a notepad. It should look friendly and like a professional AI editor. Anime style, soft coloring.";
                } else if (character === "参考画像") {
                    subjectSetting = "The specific character and style from the attached reference image. Replicate the facial features and outfits exactly.";
                } else if (character === "指定なし") {
                    subjectSetting = "No specific character. Focus on environment, landscape, or symbolic objects.";
                }

                const strictInstruction = strictCharacter
                    ? "STRICTLY prioritize the original character's features, clothing, and art style from the provided reference image. THE CHARACTER IN THE IMAGE IS THE MAIN SUBJECT."
                    : "Use the reference image as a loose guide for style and vibes, but feel free to prioritize the topic's essence.";

                const promptEngineering = `
            You are a Visual Art Director. Based on the Article Title below, describe ONE singular, powerful visual scene (WITHOUT any text/letters) that captures the ATMOSPHERE and ESSENCE of the topic.
            
            【Article Title】
            ${title || articleText.substring(0, 100)}

            【Visual Strategy】
            - Visual Style: ${visualStyle || "Modern/Illustrative"}
            - Main Subject: ${subjectSetting}
            ${referenceImage ? `- Character/Style Reference: ${strictInstruction}` : ""}
            - Design Detail: ${strictCharacter ? "Center the character from the reference image." : "If a character is present, use a clean sticker-style."} If the topic involves a workflow, connect elements with thin glowing lines.
            - Atmosphere: ${title?.toLowerCase().includes("隠れ家") || title?.toLowerCase().includes("カフェ") ? "Cozy, quiet, hidden oasis, morning or warmth" : "Cinematic and appropriate for the title"}
            - Composition: High contrast, central focal point, 16:9 widescreen, clean and organized.

            【Output Rules】
            - STRICTLY NO TEXT, NO LETTERS.
            - Provide a detailed visual description of the scene including the character if applicable.
            - Max 40 words. Return ONLY English text.
          `;

                const promptResult = await model.generateContent(promptEngineering);
                let visualDescription = promptResult.response.text().trim();

                // Construct Final Strict Prompt
                imagePrompt = `${visualDescription}, high quality, extremely detailed, masterwork, 16:9 aspect ratio, textless, no text, no logo, no letters, no words.`;

                console.log("Final Polished Image Prompt:", imagePrompt);
            } catch (promptError) {
                console.error("Prompt generation failed:", promptError);
                imagePrompt = "Abstract modern header image, minimal flat design, textless, 16:9 aspect ratio";
            }
        } else {
            console.log("Using Provided Image Prompt:", imagePrompt);
        }

        const errors: any[] = [];

        // 2. Call Image Generation Model (Multimodal v1beta approach)
        const parts: any[] = [{ text: imagePrompt }];
        if (referenceImage) {
            const match = referenceImage.match(/^data:(image\/\w+);base64,(.+)$/);
            if (match) {
                parts.push({
                    inlineData: {
                        mimeType: match[1],
                        data: match[2]
                    }
                });
            }
        }

        const modelsToTry = [
            "gemini-3-pro-image-preview",
            "gemini-2.5-flash-image",
            "nano-banana-pro-preview",
            "gemini-2.0-flash-exp-image-generation",
            "imagen-3.0-generate-001"
        ];

        for (const modelName of modelsToTry) {
            // Variations of request bodies to ensure compatibility with preview models
            const requestVariations = [
                {
                    contents: [{ role: "user", parts }],
                    generationConfig: { responseModalities: ["IMAGE"], imageConfig: { aspectRatio: "16:9" } }
                }
            ];

            for (const body of requestVariations) {
                try {
                    console.log(`Trying multimodal image generation with model: ${modelName} var: ${Object.keys(body.generationConfig).join(",")}`);

                    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(body)
                    });

                    const responseText = await response.text();

                    if (!response.ok) {
                        errors.push({ model: modelName, status: response.status, error: responseText.slice(0, 300) });
                        console.warn(`${modelName} failing (multimodal): ${response.status}`);
                        continue;
                    }

                    let data;
                    try {
                        data = JSON.parse(responseText);
                    } catch (e) {
                        errors.push({ model: modelName, error: "Failed to parse JSON response" });
                        continue;
                    }

                    if (data.candidates && data.candidates[0]?.content?.parts) {
                        const parts = data.candidates[0].content.parts;
                        // Search for the image part (can be inline_data or inlineData in some previews)
                        const imagePart = parts.find((p: any) => p.inline_data || p.inlineData);
                        const actualPart = imagePart?.inline_data || imagePart?.inlineData;

                        if (actualPart?.data) {
                            const mimeType = actualPart.mime_type || actualPart.mimeType || "image/png";
                            const imageUrl = `data:${mimeType};base64,${actualPart.data}`;

                            console.log(`Success with native model: ${modelName}`);
                            return NextResponse.json({
                                imageUrl,
                                generatedPrompt: imagePrompt,
                                model: modelName,
                                success: true
                            });
                        }
                    }

                    errors.push({ model: modelName, error: "No image part found in multimodal response" });

                } catch (e: any) {
                    console.error(`Exception with ${modelName}:`, e);
                    errors.push({ model: modelName, exception: e.message });
                }
            }
        }

        // 3. Final Fallback: Pollinations AI (Watermarked placeholder)
        console.warn("All Native Gemini image models failed. Falling back to Pollinations.");
        const seed = Math.floor(Math.random() * 1000000);
        const pollinationUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(imagePrompt)}?width=1280&height=720&model=flux&seed=${seed}&nologo=true`;

        return NextResponse.json({
            imageUrl: pollinationUrl,
            generatedPrompt: imagePrompt,
            model: "flux (Fallback)",
            errors: errors,
            notice: "Gemini Native Image API failed. Used Pollinations for visibility."
        });
    } catch (error) {
        console.error("Generate Image API Error:", error);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const err = error as any;
        return NextResponse.json(
            { error: err.message || "Failed to generate image" },
            { status: 500 }
        );
    }
}
