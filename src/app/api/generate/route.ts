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
        const model = genAI.getGenerativeModel({ model: "gemini-3-flash-preview" });

        const prompt = `
あなたは「note記事つくレッサーパンダ」です。プロのnote編集者兼ライターとして、読者が一瞬で内容を理解でき、かつ共感できる高品質な原稿パッケージを作成してください。

【執筆のワークフロー（最重要ルール）】
以下の順序で、一切の挨拶を抜いて直接執筆を開始してください。

1. **【計画・構成案】（内部用）**: 
   - 執筆に入る前に、まず「どの見出しで何文字書くか」の独自の計画を立てて出力してください。
   - 例: 「## 1. 導入 (500文字)」「## 2. 背景 (1000文字)...」のように、全セクションのタイトルと目標文字数をリストアップしてください。
   - この計画部分は最終的な記事の本文には含めません。
2. **---CONTENT_START---**: 
   - 計画が完了したら、この文字列を一行で出力してください。
3. **# 記事タイトル**: 
   - ここからが実際の記事本文です。読者の目を引く魅力的なタイトルを1つだけ出力してください。
4. **本文の執筆**: 
   - 計画した構成案に基づき、各セクションを1つずつ深掘りして執筆してください。
   - **記事本文の中に「記事の構成」や「構成案」などのメタ的な見出しは絶対に含めないでください。**
   - **各セクションは、設定した目標文字数を必ず埋めるように、具体的な事例、データ、体験談、反対意見への反論などを豊富に盛り込んでください。**
   - 1つのH2見出しにつき、最低でも500〜1000文字以上の肉付けを目標にしてください。

【読者にとっての読みやすさ・視認性ルール】
1. 改行を多用してください。1つの段落は最大でも2〜3行に抑え、視覚的な圧迫感をなくしてください。
2. 文脈の変わり目には必ず空行（1行あける）を入れてください。
3. 重要な部分は **太字** で強調してください。
4. リスト（- や ・）を積極的に使い、情報を整理してください。
5. 専門用語は平易な言葉に置き換え、中学生でも理解できる「スッと入ってくる文体」を心がけてください。

【独自設計パラメータ】
・メインテーマ：${topic}
・誰に届けるか：${targetAudience || "指定なし"}
・この記事だけの価値：${goal || "指定なし"}
・独自の切り口・コンセプト：${differentiation || "指定なし"}
・目次の構成・補足：${outlineSupplement || "指定なし"}
・目標文字数：${targetLength}
・トーン：${tone}

【ハッシュタグの選定】
noteのトレンド（#振り返りnote, #note書き初め, #やってみた 等）を参考に、記事に最適なタグを5個以上提案してください。
形式は「【おすすめのハッシュタグ】#タグ1 #タグ2 #タグ3...」としてください。

${isRetry ? `【重要：大幅な加筆の依頼】
前回の出力では文字数が不足していました。今回は、各見出しの内容を極限まで深掘りし、あらゆる詳細を詰め込んで、必ず目標文字数（${targetLength}文字）を達成するように執筆してください。` : ""}
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
