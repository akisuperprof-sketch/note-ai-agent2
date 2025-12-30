export type ScoreDetail = {
    score: number;
    value: number;
    label: string;
};

export type ArticleScore = {
    total: number;
    summary: string;
    details: {
        length: ScoreDetail;
        readability: ScoreDetail;
        structure: ScoreDetail;
        richness: ScoreDetail;
        seo: ScoreDetail;
        logicality: ScoreDetail;
        empathy: ScoreDetail;
        uniqueness: ScoreDetail;
    };
    metrics: {
        actualLength: number;
        targetLength: number;
        avgSentenceLength: number;
        h2Count: number;
        h3Count: number;
        paragraphCount: number;
        hasList: boolean;
        titleLength: number;
        logicKeywords: number;
        empathyKeywords: number;
        uniqueKeywords: number;
    };
};

export function calculateArticleScore(
    articleText: string,
    targetLength: number = 5000
): ArticleScore {
    const lines = articleText.split("\n");
    const title = lines.find((l) => l.trim().length > 0) || "";

    const actualLength = articleText.replace(/\s/g, "").length;

    const sentences = articleText
        .split("。")
        .map((s) => s.trim())
        .filter(Boolean);

    const avgSentenceLength =
        sentences.length === 0
            ? 0
            : Math.round(
                sentences.reduce((sum, s) => sum + s.length, 0) / sentences.length
            );

    const h2Count = lines.filter((l) => l.startsWith("## ")).length;
    const h3Count = lines.filter((l) => l.startsWith("### ")).length;

    const paragraphCount = articleText
        .split(/\n\s*\n/)
        .map((p) => p.trim())
        .filter(Boolean).length;

    const hasList =
        articleText.includes("- ") ||
        articleText.includes("・") ||
        /\n\d+\./.test(articleText);

    const titleLength = title.length;

    // --- Heuristics for new metrics ---
    const logicWords = ["なぜなら", "したがって", "つまり", "しかし", "ゆえに", "結果として", "根拠"];
    const empathyWords = ["悩み", "不安", "感じます", "ですね", "でしょう", "気持ち", "ではないでしょうか"];
    const uniqueWords = ["私の", "僕の", "体験", "経験", "オリジナル", "独自", "発見した"];

    const countMatches = (words: string[]) =>
        words.reduce((count, word) => count + (articleText.split(word).length - 1), 0);

    const logicKeywords = countMatches(logicWords);
    const empathyKeywords = countMatches(empathyWords);
    const uniqueKeywords = countMatches(uniqueWords);

    // 論理性
    let logicalityScore = 40 + (logicKeywords * 10);
    logicalityScore = Math.min(logicalityScore, 100);

    // 共感性
    let empathyScore = 40 + (empathyKeywords * 10);
    empathyScore = Math.min(empathyScore, 100);

    // 独自性
    let uniquenessScore = 30 + (uniqueKeywords * 15);
    uniquenessScore = Math.min(uniquenessScore, 100);

    // 文字数達成度
    const lengthRatio = actualLength / targetLength;
    let lengthScore = 0;
    if (lengthRatio >= 0.9 && lengthRatio <= 1.2) lengthScore = 100;
    else if (lengthRatio >= 0.7) lengthScore = 70;
    else if (lengthRatio >= 0.5) lengthScore = 50;
    else lengthScore = 30;

    // 読みやすさ
    let readabilityScore = 100;
    if (avgSentenceLength < 30 || avgSentenceLength > 70) readabilityScore = 60;
    if (avgSentenceLength < 20 || avgSentenceLength > 90) readabilityScore = 40;

    // 構成
    let structureScore = 20;
    if (h2Count >= 5 && h2Count <= 7) structureScore = 80;
    if (h3Count >= 1 && h3Count <= 2) structureScore += 10;
    if (h2Count === 0) structureScore = 20;
    structureScore = Math.min(structureScore, 100);

    // 充実度
    let richnessScore = 40;
    if (paragraphCount >= 20) richnessScore += 30;
    if (hasList) richnessScore += 20;
    if (articleText.includes("例えば") || articleText.includes("たとえば"))
        richnessScore += 10;
    richnessScore = Math.min(richnessScore, 100);

    // SEO
    let seoScore = 50;
    if (titleLength >= 28 && titleLength <= 45) seoScore = 100;
    else if (titleLength >= 20 && titleLength <= 60) seoScore = 80;

    const total = Math.round(
        lengthScore * 0.1 +
        readabilityScore * 0.15 +
        structureScore * 0.1 +
        richnessScore * 0.1 +
        seoScore * 0.1 +
        logicalityScore * 0.15 +
        empathyScore * 0.15 +
        uniquenessScore * 0.15
    );

    const summary =
        total >= 90 ? "素晴らしい" : total >= 70 ? "良好" : "改善の余地あり";

    return {
        total,
        summary,
        details: {
            length: { score: lengthScore, value: actualLength, label: "文字数達成度" },
            readability: { score: readabilityScore, value: avgSentenceLength, label: "読みやすさ" },
            structure: { score: structureScore, value: h2Count + h3Count, label: "構成の質" },
            richness: { score: richnessScore, value: paragraphCount, label: "充実度" },
            seo: { score: seoScore, value: titleLength, label: "SEO最適度" },
            logicality: { score: logicalityScore, value: logicKeywords, label: "論理性" },
            empathy: { score: empathyScore, value: empathyKeywords, label: "共感性" },
            uniqueness: { score: uniquenessScore, value: uniqueKeywords, label: "独自性" },
        },
        metrics: {
            actualLength,
            targetLength,
            avgSentenceLength,
            h2Count,
            h3Count,
            paragraphCount,
            hasList,
            titleLength,
            logicKeywords,
            empathyKeywords,
            uniqueKeywords,
        },
    };
}
