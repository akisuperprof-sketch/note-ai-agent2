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
あなたはプロのコンテンツプロデューサー兼、noteで月間10万PVを稼ぐ凄腕の編集者です。
ユーザーが入力した「記事テーマ・ノウハウメモ」を深く分析し、読者が「これは自分のための記事だ！」と即座に確信し、最後まで一気読みしたくなるような鋭い戦略を提案してください。

【厳守事項】
1. **「当たり前」の回答は禁止**: 例えばテーマが「SNS運用」なら「SNSでフォロワーを増やしたい人」のような広すぎたり誰にでも当てはまるターゲットは絶対に不可。「Xで1ヶ月毎日投稿したがフォロワーが10人も増えず、本気で悩んでいる副業パパ」など、生活背景や痛みが具体的に見えるまで絞り込んでください。
2. **情報の密度**: 提案内容は具体的であればあるほど良いです。抽象的な言葉（例：効率化、飛躍的、網羅的、独自性）をそのまま使わず、具体的なアクションやベネフィット、具体的なエピソードの切り出し方に変換してください。
3. **noteの文化に合わせる**: note読者が好む「個人の失敗からの学び」「独自の実験データ」「エモーショナルな気づき」という要素をどこに盛り込むべきかを含めて提案してください。

【入力されたテーマ/メモ】
${topic}

【出力形式】
JSON形式のみで出力してください。Markdownのコードブロック（\`\`\`json ... \`\`\`）で囲んでください。必ず以下の英語のキー名を使用してください。

【出力項目（日本語で回答）】
- targetAudience: 「誰に届けるか」。具体的かつ切実な、属性や状況まで踏み込んだターゲット層。
- goal: 「この記事だけの価値」。読了後に読者が得られる「具体的」な変化やベネフィット、次の具体的なアクション。
- differentiation: 「独自の切り口・コンセプト」。競合記事が触れていない、このメモから読み取れるユニークな視点。
- outlineSupplement: 「目次の構成・補足」。導入から結論まで、読者の感情を動かしながら納得させるための5つ前後の論理的なポイント。
`;

        const result = await model.generateContent(prompt);
        const response = await result.response;
        const text = response.text();

        console.log("Recommend AI raw output:", text);

        // Improved extraction
        let jsonStr = text;
        const jsonMatch = text.match(/```json\s*(\{[\s\S]*\})\s*```/) || text.match(/(\{[\s\S]*\})/);
        if (jsonMatch) {
            jsonStr = jsonMatch[1];
        }

        try {
            const recommendations = JSON.parse(jsonStr);
            return NextResponse.json({
                targetAudience: recommendations.targetAudience || "",
                goal: recommendations.goal || "",
                differentiation: recommendations.differentiation || "",
                outlineSupplement: recommendations.outlineSupplement || ""
            });
        } catch (parseError) {
            console.error("JSON Parse Error:", parseError, "Raw text:", text);
            return NextResponse.json({ error: "Invalid JSON from AI" }, { status: 500 });
        }
    } catch (error) {
        console.error("Recommend error:", error);
        return NextResponse.json({ error: "Failed to generate recommendations" }, { status: 500 });
    }
}
