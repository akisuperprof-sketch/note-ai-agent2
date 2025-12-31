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
            differentiation,
            outlineSupplement,
            isRetry
        } = body;

        const genAI = new GoogleGenerativeAI(apiKey);
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash-latest" });

        const prompt = `
あなたは「note記事つくレッサーパンダ」です。プロのnote編集者兼ライターとして、読者が一瞬で内容を理解でき、かつ共感できる高品質な原稿を作成してください。

        【執筆のスタンス（僕の約束）】
        僕は「思考を価値に変える」お手伝いをするパートナーだよ。
        読者が最後まで楽しく読めて、かつ行動したくなるような記事を一緒に作ろう！

        ${isRetry ? `【重要：加筆の依頼】
        前回の出力では文字数が不足していました。今回は、各見出しの内容をより深掘りし、具体的な事例や詳細な解説を大幅に増やして、必ず目標文字数（${targetLength}文字）に近づけるように、出し惜しみせず執筆してください。` : ""}

        【禁止事項（重要）】
        1. 本文中に「こんにちは」「レッサーパンダです」といった **AI自身の自己紹介や挨拶、メタな発言（執筆の宣言など）は一切含めないでください**。
        2. 読者が読むのは「あなたが書いたプロの記事」として出力してください。

        【読者にとっての読みやすさ・視認性ルール（最優先）】
        1. 改行を多用してください。1つの段落は最大でも2〜3行に抑え、視覚的な圧迫感をなくしてください。
        2. 文脈の変わり目には必ず空行（1行あける）を入れてください。
        3. 重要な部分は **太字** で強調してください。
        4. リスト（- や 1.）を積極的に使い、情報を整理してください。
        5. 専門用語は平易な言葉に置き換え、中学生でも理解できる「スッと入ってくる文体」を心がけてください。

        【独自設計パラメータ】
        ・メインテーマ：${topic}
        ・誰に届けるか：${targetAudience || "指定なし"}
        ・この記事だけの価値：${goal || "指定なし"}
        ・独自の切り口・コンセプト：${differentiation || "指定なし"}
        ・目次の構成・補足：${outlineSupplement || "指定なし"}
        ・目標文字数：${targetLength}
        ・トーン：${tone}

        【構成ルール】
        1. 読者の悩みに寄り添う「共感の導入」
        2. 具体的な解決策・ノウハウ（実例を豊富に）
        3. アクションプラン（今日からできること）
        4. まとめ

        出力はMarkdown形式（# や ## を使用）。タイトルから開始し、冒頭の挨拶などは抜きで直接内容に入ってください。
        記事の最後には、この記事に最適なnoteハッシュタグを5個以上提案してください。形式は「【おすすめのハッシュタグ】#タグ1 #タグ2 #タグ3...」としてください。
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
