import { GoogleGenerativeAI } from "@google/generative-ai";
import { NextResponse } from "next/server";

export async function POST(req: Request) {
    try {
        const { topic } = await req.json();

        if (!topic) {
            return NextResponse.json({ error: "Topic is required" }, { status: 400 });
        }

        const genAI = new GoogleGenerativeAI(process.env.GOOGLE_GENERATIVE_AI_API_KEY || "");
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

        const prompt = `
あなたはプロのnote編集者エンジニアです。
ユーザーが入力した「記事テーマ・ノウハウメモ」に基づいて、最適な記事設計（誰に届けるか、この記事だけの価値、独自の切り口、目次の構成補足）を提案してください。

【入力されたテーマ】
${topic}

【出力形式】
JSON形式のみで出力してください。

【出力項目】
- targetAudience: 誰に届けるか（具体的かつ切実な悩みを持つ層）
- goal: この記事だけの価値（読了後のベネフィット）
- differentiation: 独自の切り口・コンセプト（他記事との差別化ポイント）
- outlineSupplement: 目次の構成・補足（具体的な構成案や追加すべき要素）

例:
{
  "targetAudience": "...",
  "goal": "...",
  "differentiation": "...",
  "outlineSupplement": "..."
}
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
