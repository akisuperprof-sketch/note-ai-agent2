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

        const errors: string[] = [];

        // 2. Call Image Generation Model
        const modelsToTry = [
            "gemini-3-pro-image-preview",
            "gemini-2.0-flash-exp",
            "gemini-2.0-flash",
            "imagen-3.0-generate-001"
        ];

        for (const modelName of modelsToTry) {
            try {
                console.log(`Trying image generation with model: ${modelName}`);
                const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        contents: [{ parts: [{ text: imagePrompt }] }]
                        // generationConfig removed to avoid INVALID_ARGUMENT
                    })
                });

                if (!response.ok) {
                    const txt = await response.text();
                    errors.push(`${modelName}: ${response.status} - ${txt}`);
                    console.warn(`${modelName} failed with status ${response.status}`);
                    continue; // Try next model
                }

                const data = await response.json();

                // Validate Data
                if (data.candidates && data.candidates[0]?.content?.parts?.[0]) {
                    const part = data.candidates[0].content.parts[0];
                    if (part.inline_data) {
                        const imageUrl = `data:${part.inline_data.mime_type};base64,${part.inline_data.data}`;
                        return NextResponse.json({ imageUrl, generatedPrompt: imagePrompt, model: modelName });
                    }
                    if (part.text && part.text.startsWith("http")) {
                        return NextResponse.json({ imageUrl: part.text, generatedPrompt: imagePrompt, model: modelName });
                    }
                }

                // If we get here, response was OK but data was missing/invalid
                errors.push(`${modelName}: 200 OK but no image data found.`);
                console.warn(`${modelName} returned 200 but no valid image data.`);

            } catch (e) {
                console.error(`Error trying ${modelName}:`, e);
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                errors.push(`${modelName}: Exception - ${(e as any).message}`);
            }
        }

        // 3. Final Fallback: Pollinations AI (If all Google models failed)
        // We force this fallback even if Google models fail, to ensure user gets SOMETHING.
        if (errors.length === modelsToTry.length) {
            console.log("All Google models failed. Using Pollinations AI as guaranteed fallback.");
            const encodedPrompt = encodeURIComponent(imagePrompt);
            const pollinationUrl = `https://image.pollinations.ai/prompt/${encodedPrompt}?width=1280&height=720&model=flux&seed=${Math.floor(Math.random() * 1000)}`;

            // Return URL immediately. Let the client browser handle the loading.
            // Server-side fetching might timeout or be blocked, but client might succeed.
            return NextResponse.json({
                imageUrl: pollinationUrl,
                generatedPrompt: imagePrompt,
                model: "pollinations-ai-flux (Fallback)"
            });
        }

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
