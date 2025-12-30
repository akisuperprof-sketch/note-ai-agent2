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

        const { articleText, promptOverride } = await req.json();

        let imagePrompt = promptOverride;

        if (!imagePrompt) {
            try {
                // 1. Generate Image Prompt (Fallback)
                // Use gemini-2.0-flash-exp as it is more stable than 3-preview for pure text sometimes, 
                // or stick to gemini-3-flash-preview but handle error.
                const genAI = new GoogleGenerativeAI(apiKey);
                const model = genAI.getGenerativeModel({ model: "gemini-3-flash-preview" });

                const promptEngineering = `
            以下の記事の内容を象徴する、noteの見出し画像（ヘッダー画像）のための英語の画像生成プロンプトを作成してください。
            
            【要件】
            - 出力は **英語のプロンプトのみ** を返してください。余計な説明は不要です。
            - スタイル: フラットデザイン、ミニマル、モダン、抽象的、コーポレートメンフィス、パステルカラー、温かみのある雰囲気。
            - "No text" (文字を含まない) という指示を必ず含めてください。
            
            【記事の抜粋】
            ${articleText.substring(0, 800)}...
          `;

                const promptResult = await model.generateContent(promptEngineering);
                imagePrompt = promptResult.response.text();
                // Basic cleanup
                imagePrompt = imagePrompt.replace(/^```(json|text)?\n/, '').replace(/\n```$/, '').trim();
                console.log("Generated Image Prompt (Fallback):", imagePrompt);
            } catch (promptError) {
                console.error("Prompt generation failed:", promptError);
                // Fallback prompt if AI fails
                imagePrompt = "Abstract modern header image, minimal flat design, pastel colors, no text, corporate memphis style";
            }
        } else {
            console.log("Using Provided Image Prompt:", imagePrompt);
        }

        const errors: string[] = [];

        // 2. Call Image Generation Model
        // Priority 1: Gemini 3 Pro Image Preview
        let usedModel = "gemini-3-pro-image-preview";
        let response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3-pro-image-preview:generateContent?key=${apiKey}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts: [{ text: imagePrompt }] }],
                // generationConfig removed to fix INVALID_ARGUMENT
            })
        });

        if (!response.ok) {
            const txt = await response.text();
            errors.push(`${usedModel}: ${response.status} - ${txt}`);
            console.warn(`${usedModel} failed, trying fallback to gemini-2.0-flash-exp`);

            // Priority 2: Gemini 2.0 Flash Exp
            usedModel = "gemini-2.0-flash-exp";
            response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent?key=${apiKey}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{ parts: [{ text: imagePrompt }] }],
                    // generationConfig removed
                })
            });
        }

        if (!response.ok) {
            const txt = await response.text();
            errors.push(`${usedModel}: ${response.status} - ${txt}`);
            console.warn(`${usedModel} failed, trying fallback to gemini-2.0-flash`);

            // Priority 2.5: Gemini 2.0 Flash (Standard)
            usedModel = "gemini-2.0-flash";
            response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{ parts: [{ text: imagePrompt }] }],
                    // generationConfig removed
                })
            });
        }

        if (!response.ok) {
            const txt = await response.text();
            errors.push(`${usedModel}: ${response.status} - ${txt}`);
            console.warn(`${usedModel} failed, trying fallback to imagen-3.0-generate-001`);

            // Priority 3: Imagen 3.0
            usedModel = "imagen-3.0-generate-001";
            response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/imagen-3.0-generate-001:generateContent?key=${apiKey}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{ parts: [{ text: imagePrompt }] }],
                    // generationConfig removed
                })
            });
        }

        if (!response.ok) {
            const txt = await response.text();
            errors.push(`${usedModel}: ${response.status} - ${txt}`);
            // If completely failed, list available models for debug
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
        }

        const data = await response.json();

        if (data.candidates && data.candidates[0]?.content?.parts?.[0]) {
            const part = data.candidates[0].content.parts[0];
            // Check for inline data (base64)
            if (part.inline_data) {
                const imageUrl = `data:${part.inline_data.mime_type};base64,${part.inline_data.data}`;
                return NextResponse.json({ imageUrl, generatedPrompt: imagePrompt, model: usedModel });
            }
            // Check for text url
            if (part.text && part.text.startsWith("http")) {
                return NextResponse.json({ imageUrl: part.text, generatedPrompt: imagePrompt, model: usedModel });
            }
        }

        throw new Error(`No image data found in response from ${usedModel}`);


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
