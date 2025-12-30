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

        const { title, articleText, promptOverride, visualStyle, character, referenceImage } = await req.json();

        let imagePrompt = promptOverride;

        if (!imagePrompt) {
            try {
                // 1. Generate a CONCISE Visual Scene Description based ONLY on the Title (to keep it clean and symbolic)
                const genAI = new GoogleGenerativeAI(apiKey);
                const model = genAI.getGenerativeModel({ model: "gemini-3-flash-preview" });

                const subjectSetting = character === "指定なし" ? "No specific character. Focus on environment, landscape, or symbolic objects." : character;

                const promptEngineering = `
            You are a Visual Art Director. Based on the Article Title below, describe ONE singular, powerful visual scene (WITHOUT any text/letters) that captures the ATMOSPHERE and ESSENCE of the topic.
            
            【Article Title】
            ${title || articleText.substring(0, 100)}

            【Visual Strategy】
            - Visual Style: ${visualStyle || "Modern/Illustrative"}
            - Focus: ${subjectSetting}
            - Atmosphere: ${title?.includes("隠れ家") || title?.includes("カフェ") ? "Cozy, quiet, hidden oasis, morning or warm lighting" : "Consistent with the title's vibe"}
            ${referenceImage ? "- Character/Style Reference: Follow the appearance and style of the attached image." : ""}
            - Thumbail Rule: High contrast, one clear focal point, 16:9 cinematic shot.

            【Output Rules】
            - STRICTLY NO TEXT, NO LETTERS.
            - Focus on sensory details: light, shadow, texture, color.
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
                    contents: [{ role: "user", parts: [{ text: imagePrompt }] }],
                    generationConfig: { responseModalities: ["IMAGE"], imageConfig: { aspectRatio: "16:9" } }
                },
                {
                    contents: [{ role: "user", parts: [{ text: imagePrompt }] }],
                    generationConfig: { response_modalities: ["IMAGE"], image_config: { aspect_ratio: "16:9" } }
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
