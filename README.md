# わど式 note 記事自動生成AIエージェント v2.1 (Repro)

## 概要
このリポジトリは、ノウハウ入力から記事構成、本文執筆、そして高品質な「アイキャッチ・記事内画像」の生成までを一気通貫で行う、AIエージェント型Webアプリの実装です。
2025年最新のAIモデル戦略を組み込み、note投稿に必要なすべての素材をワンストップで完成させます。

## v2.1 の新機能
- **Nano Banana Pro 連携**: `gemini-3-pro-image-preview` による透かしのない高品質画像生成。
- **マルチ画像生成**: アイキャッチに加え、記事の内容に即した「インライン画像」を自動生成。
- **note プレビュー**: 実際の note 投稿画面を再現したプレビュータブで、公開時のイメージを確認可能。
- **メタデータ自動抽出**: SNS 用のメタディスクリプション（120文字）を自動生成。
- **Strict Character Logic**: 参照画像のキャラクターを一貫して維持する「必須設定」スイッチを搭載。
- **デザイン・アートディレクション**: ステッカー風の縁取りやアイコン接続など、AI による高度なビジュアル表現。

## 技術スタック
- **Frontend**: Next.js (App Router), Tailwind CSS
- **Backend**: Next.js API Routes, Google Gemini API
- **AI Models**:
  - Text: `gemini-3-flash-preview`
  - Image: `gemini-3-pro-image-preview` (Nano Banana Pro)
  - Fallback: `Pollinations AI (Flux)`

## セットアップ
1. `npm install`
2. `.env.local` に `GEMINI_API_KEY` を設定
3. `npm run dev`

## ドキュメント
- [最新仕様書_v2.md](./最新仕様書_v2.md): アプリの全機能詳細
- [開発履歴_20251231.md](./開発履歴_20251231.md): 開発における意思決定ログ
- [nanobananaproの使い方.md](./nanobananaproの使い方.md): 画像生成モデルの活用ガイド

---
Developed by Antigravity AI @ 2025
