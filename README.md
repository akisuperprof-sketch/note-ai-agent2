
# わど式 note 記事自動生成AIエージェント（再現版）

## 概要
このリポジトリは、
ノウハウ入力 → note記事生成 → 品質スコア可視化 → アイキャッチ画像生成
までを一気通貫で体験できる AI エージェント型 Web アプリの学習用再現実装です。

単なる文章生成ではなく、
状態遷移UI・生成ログ・品質スコア演出 を含む
「プロダクト型AI」の構造理解を目的としています。

## 主な機能
- **note にそのまま貼れる記事本文の生成**
- **生成中ログの可視化**（6ステップ）
- **記事品質スコア（100点満点）の算出・表示**
- **gemini-3-pro-image-preview を用いたアイキャッチ画像生成プロンプトの自動生成**
- **スマホファースト UI**（ダーク基調／カードUI）

## 技術スタック
- **Next.js**
- **React**
- **TypeScript**
- **Vercel**
- **Gemini API**
  - 文章生成：Gemini（text系モデル）
  - 画像生成：gemini-3-pro-image-preview（必須）

## ディレクトリ構成
- `src/app`: 画面とAPIルート (App Router)
- `src/components`: UIコンポーネント (今回は `page.tsx` に統合実装)
- `src/lib`: ロジック（スコア、プロンプト）
- `src/styles`: グローバルCSS

## セットアップ手順

1. **リポジトリをクローン**
   ```bash
   git clone https://github.com/akisuperprof-sketch/note-ai-agent2.git
   cd note-ai-agent2
   ```

2. **依存関係をインストール**
   ```bash
   npm install
   ```

3. **環境変数を設定**
   `.env.local` ファイルを作成し、Gemini API キーを設定してください。
   ```
   GEMINI_API_KEY=xxxxx
   ```

4. **ローカル起動**
   ```bash
   npm run dev
   ```
   http://localhost:3000 にアクセス。

## デプロイ（Vercel）
1. GitHub リポジトリを Vercel に接続
2. Environment Variables に `GEMINI_API_KEY` を設定
3. Deploy

## アプリの画面構成
- `/`: ホーム・3ステップ導線・初回ヘルプ
- `Input`: 入力フォーム
- `Generating`: 生成ログ
- `Result`: 記事本文／コピー／画像プロンプト／スコア表示

## 品質スコアについて
以下の指標を 0〜100 に正規化し、加重平均で算出しています。
- 文字数達成度
- 読みやすさ（平均文長）
- 構成の質（見出し数）
- コンテンツ充実度（段落／リスト）
- SEO 最適度（タイトル長）

## 学習ポイント
- プロンプトを「段階分割」する重要性
- AI生成より UI / 状態管理が体験価値を左右する点
- スコアやログは「正確さ」より「納得感」が重要である点

## 注意
この実装は学習目的です。
商用利用する場合は、API 利用規約・課金設計・セキュリティ対策を必ず確認してください。
