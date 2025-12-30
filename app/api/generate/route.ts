import { GoogleGenerativeAI } from "@google/generative-ai";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// Note-specific prompt engineering (Same as before)
const SYSTEM_INSTRUCTION = `
あなたは日本で最も支持されている「note」の人気クリエイターであり、優秀な編集者です。
読了率が高く、スキ（いいね）が集まる、共感性の高い記事を執筆することが得意です。

【執筆のルール】
1. **タイトル**: 32文字以内で、クリックしたくなる魅力的で具体的なタイトルを考えてください（出力の先頭に # タイトル として記載）。
2. **構成**:
   - **導入**: 読者の課題に寄り添い、この記事を読むメリットを提示する。
   - **本文**: 具体的で分かりやすいエピソードや事例を交える。見出し（##, ###）を活用してリズムを作る。
   - **まとめ**: 行動を促すようなポジティブな締めくくり。
3. **表現**:
   - 漢字・ひらがな・カタカナのバランスを意識（ひらがな多めがnoteらしい）。
   - 難しい専門用語は噛み砕く。
   - 適度に絵文字😊や感嘆符！を使って感情を表現する（トーンによる）。
   - 重要箇所は **太字** で強調する。
4. **CTA**: 最後には必ず「この記事が良かったら『スキ』やフォローをお願いします！」という呼びかけを入れる。
`;

export async function POST(req: NextRequest) {
    try {
        // API Key from environment variable
        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) {
            return NextResponse.json(
                { error: "GEMINI_API_KEY is not set in environment variables." },
                { status: 500 }
            );
        }

        const { sourceText, tone, length, customInstructions } = await req.json();

        const genAI = new GoogleGenerativeAI(apiKey);
        const model = genAI.getGenerativeModel({
            model: "gemini-1.5-flash",
            systemInstruction: SYSTEM_INSTRUCTION,
        });

        let lengthPrompt = "";
        switch (length) {
            case "short": lengthPrompt = "800〜1200文字程度（サクッと読める分量）"; break;
            case "medium": lengthPrompt = "1500〜2500文字程度（充実した内容）"; break;
            case "long": lengthPrompt = "3000文字以上（網羅的な長編）"; break;
            case "auto": default: lengthPrompt = "内容に合わせて最適な長さ"; break;
        }

        let tonePrompt = "";
        switch (tone) {
            case "business": tonePrompt = "文体: プロフェッショナルで信頼感のある『です・ます』調。論理的で明確な表現。ビジネスパーソン向け。"; break;
            case "emotional": tonePrompt = "文体: エッセイのような、筆者の体温が伝わるエモーショナルな文体。独り言や問いかけを交える。"; break;
            case "casual": tonePrompt = "文体: 友人に話しかけるようなフランクな口調。絵文字多めで、改行も多めに。"; break;
            case "standard": default: tonePrompt = "文体: 読みやすく丁寧な標準的な『です・ます』調。noteの標準的なスタイル。"; break;
        }

        const prompt = `
    以下の【メモ・元ネタ】をベースに、最高のnote記事を書き上げてください。

    【設定】
    ${tonePrompt}
    目標文字数: ${lengthPrompt}
    ${customInstructions ? `追加指示: ${customInstructions}` : ""}

    【メモ・元ネタ】
    ${sourceText}
  `;

        const result = await model.generateContentStream(prompt);

        // Create a ReadableStream from the generator
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
            headers: {
                "Content-Type": "text/plain; charset=utf-8",
            },
        });
    } catch (error) {
        console.error("Generate API Error:", error);
        return NextResponse.json(
            { error: "Failed to generate content" },
            { status: 500 }
        );
    }
}
