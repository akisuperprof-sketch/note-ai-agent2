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
            // 1. Generate Image Prompt (Fallback)
            const genAI = new GoogleGenerativeAI(apiKey);
            const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

            const promptEngineering = `
        以下の記事の内容を象徴する、noteの見出し画像（ヘッダー画像）のための英語の画像生成プロンプトを作成してください。
        
        【要件】
        - 出力は **英語のプロンプトのみ** を返してください。余計な説明は不要です。
        - スタイル: フラットデザイン、ミニマル、モダン、抽象的、コーポレートメンフィス、パステルカラー、温かみのある雰囲気。
        - "No text" (文字を含まない) という指示を必ず含めてください。
        - 具体的すぎる描写よりも、記事のテーマや感情を表現する抽象的な概念ビジュアルが良いです。

        【記事の抜粋】
        ${articleText.substring(0, 1000)}...
      `;

            const promptResult = await model.generateContent(promptEngineering);
            imagePrompt = promptResult.response.text();
            console.log("Generated Image Prompt (Fallback):", imagePrompt);
        } else {
            console.log("Using Provided Image Prompt:", imagePrompt);
        }

        // 2. Call Image Generation Model
        // Using gemini-2.0-flash-exp which often supports Image Generation in the latest API
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent?key=${apiKey}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                contents: [{ parts: [{ text: imagePrompt }] }],
                generationConfig: {
                    responseMimeType: "image/jpeg"
                }
            })
        });

        if (!response.ok) {
            console.warn("gemini-2.0-flash-exp failed, trying fallback to imagen-3.0-generate-001");
            // Fallback: Try Imagen 3 Model
            const fallbackResponse = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/imagen-3.0-generate-001:generateContent?key=${apiKey}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{ parts: [{ text: imagePrompt }] }],
                    generationConfig: { responseMimeType: "image/jpeg" }
                })
            });

            if (!fallbackResponse.ok) {
                const errText = await fallbackResponse.text();
                throw new Error(`Image model request failed (Primary & Fallback): ${fallbackResponse.status} - ${errText}`);
            }
            // Use fallback response
            const data = await fallbackResponse.json();
            if (data.candidates && data.candidates[0]?.content?.parts?.[0]) {
                const part = data.candidates[0].content.parts[0];
                if (part.inline_data) {
                    const imageUrl = `data:${part.inline_data.mime_type};base64,${part.inline_data.data}`;
                    return NextResponse.json({ imageUrl, generatedPrompt: imagePrompt, model: "imagen-3.0-generate-001" });
                }
            }
            throw new Error("No image data found in fallback response");
        }

        const data = await response.json();

        if (data.candidates && data.candidates[0]?.content?.parts?.[0]) {
            const part = data.candidates[0].content.parts[0];
            // Check for inline data (base64)
            if (part.inline_data) {
                const imageUrl = `data:${part.inline_data.mime_type};base64,${part.inline_data.data}`;
                return NextResponse.json({ imageUrl, generatedPrompt: imagePrompt });
            }
            // Check for text url
            if (part.text && part.text.startsWith("http")) {
                return NextResponse.json({ imageUrl: part.text, generatedPrompt: imagePrompt });
            }
        }

        throw new Error("No image data found in response");

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
