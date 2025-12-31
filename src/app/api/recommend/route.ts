import { GoogleGenerativeAI } from "@google/generative-ai";
import { NextResponse } from "next/server";

export async function POST(req: Request) {
    try {
        const { topic } = await req.json();

        if (!topic) {
            return NextResponse.json({ error: "Topic is required" }, { status: 400 });
        }

        const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY;
        if (!apiKey) {
            return NextResponse.json({ error: "API Key is missing" }, { status: 500 });
        }

        const genAI = new GoogleGenerativeAI(apiKey);
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

        const prompt = `
あなたはプロのnote編集者エンジニアです。
ユーザーが入力した「記事テーマ・ノウハウメモ」に基づいて、読者が思わずクリックしたくなるような、鋭い視点の記事設計を提案してください。

【重要】
- 汎用的で抽象的な回答は避けてください。
- 「誰に届けるか」は、そのテーマに特有の具体的な悩みを持つ層を絞り込んでください。
- 例：テーマが「カレー」なら「20代会社員」ではなく「スパイスから凝りたいが時短も重視する独身男性」など。

【入力されたテーマ】
${topic}

【出力形式】
JSON形式のみで出力してください。Markdownのコードブロック（\`\`\`json ... \`\`\`）で囲んでください。

【出力項目】
- targetAudience: 誰に届けるか（具体的かつ切実な悩みを持つ層）
- goal: この記事だけの価値（読了後の具体的ベネフィット・読後の行動）
- differentiation: 独自の切り口・コンセプト（競合記事にはない、あなたならではのユニークな視点）
- outlineSupplement: 目次の構成・補足（記事の骨子となる具体的な4〜5つのポイント）
`;

        const result = await model.generateContent(prompt);
        const response = await result.response;
        const text = response.text();

        // Extract JSON from potential markdown blocks
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
            throw new Error("Failed to generate valid recommendations");
        }

        const recommendations = JSON.parse(jsonMatch[0]);
        return NextResponse.json(recommendations);
    } catch (error) {
        console.error("Recommend error:", error);
        return NextResponse.json({ error: "Failed to generate recommendations" }, { status: 500 });
    }
}
