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

        console.log("API Key found (length):", apiKey.length); // Debug log

        let body;
        try {
            body = await req.json();
            console.log("Request Body parsed:", JSON.stringify(body).slice(0, 100)); // Debug log (truncated)
        } catch (e) {
            console.error("Failed to parse request body:", e);
            return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
        }

        const {
            topic,
            targetAudience,
            goal,
            targetLength = 5000,
            tone = "やさしい",
            differentiation
        } = body;

        const genAI = new GoogleGenerativeAI(apiKey);
        const model = genAI.getGenerativeModel({ model: "gemini-3-flash-preview" });

        const prompt = `
あなたは「note記事自動生成AIエージェント」です。出力は日本語。冗長な前置き不要。ユーザーがそのままnoteに貼れる完成原稿を作る。記事品質は読みやすさ最優先。見出し階層はH2中心、必要ならH3を1〜2個だけ。箇条書きは多用しすぎず、要点は短く。結論→理由→手順→注意点→まとめの順に整える。本文の途中に画像は挿入しない。

        入力パラメータ
・記事テーマ：${topic}
・想定読者：${targetAudience || "指定なし"}
・記事の目的：${goal || "指定なし"}
・目標文字数：${targetLength}
・トーン：${tone}
・差別化ポイント：${differentiation || "指定なし"}
・禁止事項：誇張しすぎ、断定しすぎ、根拠のない医学・法律断言

         必須ルール
        1 文章は深く具体的に書く。単なる概要ではなく、実例や具体的なステップを詳細に記述する
        2 見出し（H2）ごとに少なくとも500〜800文字以上の詳細な解説を行う
        3 生成される文章が目標文字数（${targetLength}文字）に充実に達するように、背景知識や具体例を豊富に盛り込む
        4 読者が「自分でもできそう」と思えるほど具体的なアクションプランを提示する
        5 記事末尾に「今日からできる最初の一歩」を1つ入れる

        生成手順（内部）
STEP1 記事テーマから、読者が得するベネフィットを明確化
STEP2 全体を5〜8つのセクションに分け、各セクションで深掘りする内容を決定
STEP3 目標文字数（${targetLength}）に向けて、各見出しの内容を膨らませて執筆（最低でも目標の90%以上を達成すること）

        出力フォーマット（厳守）
・タイトル（1行）
・導入（詳細な導入）
・本文（見出しごとの重厚な解説）
・まとめ
・今日からできる最初の一歩
        `;

        try {
            const result = await model.generateContentStream(prompt);

            const stream = new ReadableStream({
                async start(controller) {
                    for await (const chunk of result.stream) {
                        const chunkText = chunk.text();
                        controller.enqueue(new TextEncoder().encode(chunkText));
                    }
                    controller.close();
                },
            });

            return new NextResponse(stream, {
                headers: { "Content-Type": "text/plain; charset=utf-8" },
            });
        } catch (streamingError) {
            // Debug: List available models if generation fails
            console.error("Streaming failed:", streamingError);
            try {
                const listModelsRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
                const listModelsData = await listModelsRes.json();
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const availableModels = listModelsData.models?.map((m: any) => m.name) || ["No models found"];
                console.error("Available Models:", availableModels);

                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const err = streamingError as any;
                return NextResponse.json(
                    { error: `Model Error: ${err.message}. Available: ${availableModels.join(", ")}` },
                    { status: 500 }
                );
            } catch (listError) {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const err = streamingError as any;
                return NextResponse.json(
                    { error: `Generation failed and could not list models: ${err.message}` },
                    { status: 500 }
                );
            }
        }

    } catch (error) {
        console.error("Generate API Error:", error);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const err = error as any;
        return NextResponse.json(
            { error: err.message || "Failed to generate content" },
            { status: 500 }
        );
    }
}
