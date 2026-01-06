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

        // Calculate constraints for long articles
        const isLongContent = targetLength >= 10000;
        const minSectionCount = isLongContent ? Math.floor(targetLength / 1200) : 5; // Assuming ~1200 chars per section for very long content
        const minCharsPerSection = isLongContent ? 1200 : 500;

        const prompt = `
あなたは「note記事つくレッサーパンダ」です。プロのnote編集者兼ライターとして、読者が一瞬で内容を理解でき、かつ共感できる高品質な原稿パッケージを作成してください。

【執筆のワークフロー（最重要ルール）】
以下の順序で、一切の挨拶を抜いて直接執筆を開始してください。

1. **【計画・構成案】（内部用）**: 
   - 執筆に入る前に、まず「どの見出しで何文字書くか」の独自の計画を立てて出力してください。
   - **目標文字数（${targetLength}文字）を達成するために、必ず${minSectionCount}個以上のH2見出しを立ててください。**
   - **各H2見出しの目標文字数は、平均${minCharsPerSection}文字以上に設定してください。**
   - 例: 「## 1. 導入 (1000文字)」「## 2. 背景 (2000文字)...」のように、全セクションのタイトルと目標文字数をリストアップしてください。
   - この計画部分は最終的な記事の本文には含めません。
2. **---CONTENT_START---**: 
   - 計画が完了したら、この文字列を一行で出力してください。
3. **# 記事タイトル**: 
   - 読者の目を一瞬で奪う、極めて魅力的なタイトルを1つだけ出力してください。
4. **【序章：リード文】**:
   - **「【序章...】」などの見出しは一切出力せず**、いきなり本文（リード文）から書き始めてください。
   - 読者が「これは自分のことだ」と確信するためのプロローグを執筆してください。
5. **【目次】について**:
   - **テキストでの目次は絶対に出力しないでください。**（noteの機能で自動生成されるため、重複すると邪魔になります）
   - そのまま本文の執筆に進んでください。
6. **本文の執筆**: 
   - 計画した構成案に基づき、各セクションを1つずつ深掘りして執筆してください。
   - **「【...】」のような内部的なセクション区切りや、メタな説明文は本文に一切含めないでください。**
   - **各セクションは、設定した目標文字数を必ず埋めるように、具体的な事例、データ、体験談、反対意見への反論などを豊富に盛り込んでください。**
   ${isLongContent ? `
   - **【重要：長文執筆モード】目標文字数が${targetLength}文字と非常に多いため、以下のテクニックを駆使して内容を膨らませてください：**
     1. **具体例の多用**: 抽象的な説明の後に、必ず「例えば～」として具体的なシーンや会話劇を入れてください。
     2. **「なぜ」の深掘り**: 理由を1つだけでなく、3つ以上挙げてください（個人的理由、社会的理由、心理的理由など）。
     3. **反対意見への言及**: 「よくある反論」を挙げ、それに対する回答を用意することで深みを出してください。
     4. **ステップ・バイ・ステップ**: 手順解説は細かく分け、初心者でも躓かないように詳細に描写してください。
   ` : ""}
   - **各セクションは、設定した目標文字数を必ず埋めるように詳細に執筆してください。不足する場合は具体的な事例を追加してください。**
   
【読者にとっての読みやすさ・視認性ルール】
1. 改行を多用してください。1つの段落は最大でも2〜3行に抑え、視覚的な圧迫感をなくしてください。
2. 文脈の変わり目には必ず空行（1行あける）を入れてください。
3. **強調表現について**: アスタリスク（**）による太字強調は使用しないでください。AI臭さが強くなります。代わりに、重要な語句は「」『』などのカギカッコを使って自然に強調してください。
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

【メタディスクリプション（SEO用）】
Google検索結果やSNSシェア時に表示される記事の紹介文を、100文字〜120文字以内で作成してください。
単なる要約ではなく、「〜とは？」「衝撃の結末」などのフックを入れ、読者が思わずクリックしたくなるような魅力的なコピーライティングを行ってください。
形式は「【メタディスクリプション】ここに文章...」としてください。

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
