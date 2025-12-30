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
        const model = genAI.getGenerativeModel({ model: "gemini-pro" });

        const prompt = `
あなたは「note記事自動生成AIエージェント」です。出力は日本語。冗長な前置き不要。ユーザーがそのままnoteに貼れる完成原稿を作る。記事品質は読みやすさ最優先。見出し階層はH2中心、必要ならH3を1〜2個だけ。箇条書きは多用しすぎず、要点は短く。結論→理由→手順→注意点→まとめの順に整える。本文の途中に画像は挿入しない。最後にnote向けアイキャッチ画像生成プロンプトを必ず出す。

入力パラメータ
・記事テーマ：${topic}
・想定読者：${targetAudience || "指定なし"}
・記事の目的：${goal || "指定なし"}
・目標文字数：${targetLength}
・トーン：${tone}
・差別化ポイント：${differentiation || "指定なし"}
・禁止事項：誇張しすぎ、断定しすぎ、根拠のない医学・法律断言

必須ルール
1 文章は読みやすく、平均1文は短めにする
2 見出しはH2を基本にして、見出し数は5〜7に収める
3 手順やチェックは「番号付き」で明確にする
4 記事末尾に「今日からできる最初の一歩」を1つ入れる
5 末尾に「note向けアイキャッチ画像生成プロンプト」を出す（画像モデルはgemini-3-pro-image-preview固定）
6 アイキャッチ画像は文字・ロゴ・記号・数字・アルファベットを一切含めないことを強制する

生成手順（内部）
STEP1 記事テーマから、読者が得するベネフィットを1文で定義
STEP2 全体構成（H2）を作る
STEP3 本文を書く（目標文字数±15%）
STEP4 最後にテーマ要約（画像用）を1文で作る（専門用語禁止、抽象度を上げる）
STEP5 画像生成プロンプトを出す（STEP4の要約を注入）

出力フォーマット（厳守）
・タイトル（1行）
・導入（3〜6行）
・本文（H2/H3）
・まとめ（3〜6行）
・今日からできる最初の一歩（1行）
・画像生成プロンプト（下のテンプレを使って出力）

画像生成プロンプト出力テンプレ（この形で必ず出力）
【image_model】gemini-3-pro-image-preview
【size】16:9, high resolution
【style】clean, simple, spacious, calm colors, friendly, slightly illustration-like, Japanese audience
【must_not_include】any text, logo, symbols, numbers, alphabets, watermark
【prompt】
ここに日本語でプロンプト本文（テーマ要約を含める）
【negative_prompt】
文字, ロゴ, 透かし, 記号, 数字, 英字, アルファベット, テロップ, ラベル, UI表示, 看板, 文字入りパッケージ, 漫画の擬音
`;

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
