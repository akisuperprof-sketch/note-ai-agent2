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

                const promptEngineering = `
            You are a Visual Art Director. Based on the Article Title below, describe ONE singular, powerful visual scene (WITHOUT any text/letters) that works as a blog header.
            
            【Article Title】
            ${title || articleText.substring(0, 100)}

            【Target Vibe】
            - Visual Style: ${visualStyle || "Anime/Illustration"}
            - Main Subject: ${character || "Context-dependent"}
            ${referenceImage ? "- Style Guide: Match the art style and characteristics of the provided image." : ""}
            - Thumbnail Goal: Clear focal point, high-contrast, captures attention in 3 seconds.

            【Instructions for Output】
            - STRICTLY NO TEXT, NO LETTERS, NO WORDS in the image.
            - Focus on a symbolic visual metaphor for the title.
            - Describe lighting, color, composition (e.g., Rim lighting, vibrant colors, central focus).
            - Max 40 words.
            - Return ONLY the English prompt string.
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

        // 2. Call Image Generation Model
        const modelsToTry = [
            "gemini-3-pro-image-preview",
            "nano-banana-pro-preview",
            "gemini-2.0-flash-exp-image-generation",
            "imagen-3.0-generate-001",
            "imagen-3.0-generate-002",
            "imagen-3.1-generate-001"
        ];

        for (const modelName of modelsToTry) {
            let triedWithMimeType = true;
            let currentBody: any;
            let response: Response;
            let responseText: string;
            let data: any;

            // Loop to try with and without response_mime_type
            for (let i = 0; i < 2; i++) { // Try at most twice: once with, once without
                try {
                    console.log(`Trying image generation with model: ${modelName} (attempt ${i + 1}, with_mime_type: ${triedWithMimeType})`);

                    currentBody = {
                        contents: [{ parts: [{ text: imagePrompt }] }]
                    };

                    if (triedWithMimeType) {
                        currentBody.generationConfig = {
                            response_mime_type: "image/png"
                        };
                    }

                    response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(currentBody)
                    });

                    responseText = await response.text();

                    if (!response.ok) {
                        // Check if the error is related to unsupported generationConfig
                        if (responseText.includes("generationConfig") && triedWithMimeType) {
                            console.warn(`Model ${modelName} failed with generationConfig error. Retrying without response_mime_type.`);
                            triedWithMimeType = false; // Set flag to retry without mime type
                            continue; // Retry the inner loop
                        } else {
                            errors.push({ model: modelName, status: response.status, error: responseText, triedWithMimeType });
                            console.warn(`${modelName} failed: ${response.status} - ${responseText}`);
                            break; // Exit inner loop, try next model
                        }
                    }

                    try {
                        data = JSON.parse(responseText);
                    } catch (e) {
                        errors.push({ model: modelName, error: "Failed to parse JSON response", triedWithMimeType });
                        break; // Exit inner loop, try next model
                    }

                    // Check for valid image in candidates
                    if (data.candidates && data.candidates[0]?.content?.parts?.[0]) {
                        const part = data.candidates[0].content.parts[0];
                        if (part.inline_data) {
                            const imageUrl = `data:${part.inline_data.mime_type};base64,${part.inline_data.data}`;
                            return NextResponse.json({
                                imageUrl,
                                generatedPrompt: imagePrompt,
                                model: modelName,
                                success: true
                            });
                        }
                    }

                    errors.push({ model: modelName, error: "Response OK but no image data/parts found", data, triedWithMimeType });
                    break; // Exit inner loop, try next model

                } catch (e: any) {
                    console.error(`Exception with ${modelName} (triedWithMimeType: ${triedWithMimeType}):`, e);
                    errors.push({ model: modelName, exception: e.message, triedWithMimeType });
                    break; // Exit inner loop, try next model
                }
            }
        }

        // 3. Final Fallback: Pollinations AI (If all Google models failed)
        // Adding seed and explicit flux model for better quality, but user is right about the watermark.
        console.warn("All Google image models failed. Falling back to Pollinations.");
        const seed = Math.floor(Math.random() * 1000000);
        const pollinationUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(imagePrompt)}?width=1280&height=720&model=flux&seed=${seed}&nologo=true&enhance=true`;

        return NextResponse.json({
            imageUrl: pollinationUrl,
            generatedPrompt: imagePrompt,
            model: "flux (Pollinations Fallback)",
            errors: errors,
            notice: "Gemini Image Generation models currently unavailable. Falling back to Pollinations."
        });

        // If all failed
        // List available models for debug
        const listModelsRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
        const listData = await listModelsRes.json();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const available = listData.models?.map((m: any) => m.name) || [];

        // Return error but INCLUDE the generated prompt so the user can see it
        return NextResponse.json({
            error: `All image models failed. Errors: ${JSON.stringify(errors)}`,
            debugAvailable: available,
            generatedPrompt: imagePrompt
        }, { status: 500 });


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
