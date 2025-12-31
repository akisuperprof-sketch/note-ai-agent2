# Nano Banana Pro (gemini-3-pro-image-preview) 実装・活用ガイド

このドキュメントは、Googleの最新マルチモーダルモデル `gemini-3-pro-image-preview` （通称: Nano Banana Pro）を画像生成エンジンとして正しく動かし、最高品質の出力を得るための知見をまとめたものです。

---

## 1. なぜ Nano Banana Pro なのか？
従来の Image Generation モデル（Imagen 3.0など）と比較して、以下の優位性があります。

1.  **指示理解力の高さ**: 複雑なレイアウトや「文字を入れないで」といった制約、特定のキャラクター設定（女子キャラ、猫など）を高い精度で守ります。
2.  **マルチモーダル応答**: テキストと画像を一つのコンテキストで扱えるため、記事の内容に基づいた「文脈に沿った画像」を生成しやすくなっています。
3.  **note文化との親和性**: 生成される画像の質感が清潔で、日本のnote記事のようなメディアに馴染む「フラットデザイン」や「シネマティックなライティング」が非常に得意です。

---

## 2. 実装のロジック（API呼び出しの核心）

Nano Banana Proを正しく動かすには、通常の単なる文字列プロンプトではなく、**`responseModalities`** を明示的に指定し、モデルが画像として応答できるようにする必要があります。

### APIリクエストの重要パラメータ
```json
{
  "contents": [{
    "parts": [{
      "text": "[プロンプト本文]"
    }]
  }],
  "generationConfig": {
    "responseModalities": ["IMAGE"],
    "imageConfig": {
        "aspectRatio": "16:9"
    }
  }
}
```

### 成功のポイント
- **エンドポイント**: `v1beta` エンドポイントを使用すること。
- **データ抽出**: レスポンスはBase64形式で返ってきます。APIによって `inlineData` 内部のキーが `data` だったり `image_data` (snake_case) だったりするため、双方に対応するパースロジックが必要です。

---

## 3. コピペで使える「最強プロンプト」テンプレート

Nano Banana Proの能力を最大化する英語プロンプトの型です。

### A. note向けプレミアムアイキャッチ（共通）
> **Prompt**: `[主題] rising from a [背景] void, surrounded by [装飾要素], cinematic lighting, extremely high quality, [画風指定: photorealistic / digital art], NO TEXT, NO LETTERS, 16:9 aspect ratio.`

### B. 解説用インライン画像（シンプル）
> **Prompt**: `Simple clean flat anime illustration of a [キャラクター] in a [シチュエーション], showing [解説内容], educational context, bright and soft colors, textless background, high resolution.`

---

## 4. プロンプト作成時の黄金律

1.  **ネガティブプロンプトの埋め込み**:
    AIは隙あらば文字（意味不明な英単語）を入れたがります。プロンプトの最後に必ず `NO TEXT, NO LETTERS` を入れるのが鉄則です。
2.  **アスペクト比の明示**:
    JSON設定だけでなく、テキストプロンプト内にも `16:9 aspect ratio` と入れることで成功率が上がります。
3.  **光の指示（Lighting）**:
    `cinematic rim lighting` (縁取りの光) や `golden hour light` (夕暮れの光) と入れるだけで、一気にプロっぽい質感になります。

---

## 5. 参考画像集からの成功パターン分析

過去の成功した出力（例：量子コンピュータ×猫、隠れ家カフェ）から抽出した勝ちパターンです。

1.  **象徴的シンプルさ (Symbolic Simplicity)**:
    背景はあえてディテールを抑え、中央の被写体（キャラクターやカフェの入り口など）を強調することで、スマートフォンの小さい画面でも「何の記事か」が一瞬で伝わります。
2.  **バイブラント・プロフェッショナル (Vibrant yet Professional)**:
    彩度の高い「鮮やかな色」を1色アクセントとして使いつつ、全体は落ち着いたトーンに抑えることで、noteのプレミアム感を演出できます。
3.  **構図の黄金比**:
    被写体を中央、あるいは三分割法の交点に配置し、周囲に視覚的な「余白（マージン）」を持たせることで、タイトル文字が美しく重なるスペースが確保されます。

---

## 6. 他のアプリへ移植する際のチェックリスト
- [ ] Google AI SDKのバージョンは最新か？
- [ ] APIキーにGemini 3 Proの権限が付与されているか？
- [ ] fetchのリクエストボディに `responseModalities: ["IMAGE"]` が含まれているか？
- [ ] 生成された画像の上に、HTML/CSSでタイトルを重ねる設計にしているか？（直接文字を生成させるより、この方が文字化けせず美しい）

---
**2025-12-31 記録**
Note AI Agent 2 開発プロジェクトにて確立。
