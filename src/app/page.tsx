"use client";

import { useState, useEffect } from "react";
import {
  Copy, RefreshCw, Sparkles, Settings2, FileText,
  ArrowRight, Check, KeyRound, AlertCircle, X, Image as ImageIcon,
  Download
} from "lucide-react";
import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { motion, AnimatePresence } from "framer-motion";

function cn(...inputs: (string | undefined | null | false)[]) {
  return twMerge(clsx(inputs));
}

// --- Types ---
type ToneType = "standard" | "business" | "emotional" | "casual";
type LengthType = "auto" | "short" | "medium" | "long";

interface GenerateParams {
  apiKey: string;
  sourceText: string;
  tone: ToneType;
  length: LengthType;
  customInstructions?: string;
  onStream: (chunk: string) => void;
}

// --- Gemini Logic ---

// Note-specific prompt engineering
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

async function streamGeminiContent({
  apiKey, sourceText, tone, length, customInstructions, onStream
}: GenerateParams) {
  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({
    model: "gemini-1.5-flash",
    systemInstruction: SYSTEM_INSTRUCTION
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

  try {
    const result = await model.generateContentStream(prompt);

    for await (const chunk of result.stream) {
      const chunkText = chunk.text();
      onStream(chunkText);
    }
  } catch (error) {
    console.error("Gemini Generation Error:", error);
    throw error;
  }
}

// Function to generate image prompt based on text
async function generateImagePrompt(apiKey: string, articleText: string): Promise<string> {
  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

  const prompt = `
    以下の記事の内容を象徴する、noteの見出し画像（ヘッダー画像）のための英語の画像生成プロンプトを作成してください。
    
    【要件】
    - 出力は **英語のプロンプトのみ** を返してください。余計な説明は不要です。
    - スタイル: フラットデザイン、ミニマル、モダン、抽象的、コーポレートメンフィス、パステルカラー、温かみのある雰囲気。
    - "No text" (文字を含まない) という指示を必ず含めてください。
    - 具体的すぎる描写よりも、記事のテーマや感情を表現する抽象的な概念ビジュアルが良いです。

    【記事の抜粋】
    ${articleText.substring(0, 1000)}...
  `;

  const result = await model.generateContent(prompt);
  return result.response.text();
}

async function generateImage(apiKey: string, imagePrompt: string): Promise<string> {
  try {
    // User specifically requested 'gemini-3-pro-image-preview'.
    // We attempt to call using the REST API pattern for standard GenAI tools if SDK doesn't support it directly.
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3-pro-image-preview:generateContent?key=${apiKey}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        contents: [{ parts: [{ text: imagePrompt }] }]
      })
    });

    if (!response.ok) {
      throw new Error(`Image model request failed: ${response.statusText} (${response.status})`);
    }

    const data = await response.json();

    if (data.candidates && data.candidates[0]?.content?.parts?.[0]) {
      const part = data.candidates[0].content.parts[0];
      // Check for inline data (base64)
      if (part.inline_data) {
        return `data:${part.inline_data.mime_type};base64,${part.inline_data.data}`;
      }
      // Sometimes it might return a URI or different format depending on the beta model
      if (part.text && part.text.startsWith("http")) {
        return part.text;
      }
    }

    throw new Error("Image data not found in response. Response might not contain an image.");

  } catch (e) {
    console.warn("Image generation failed", e);
    throw e;
  }
}


// --- Components ---

function ApiKeyModal({ isOpen, onClose, onSave, currentKey }: { isOpen: boolean, onClose: () => void, onSave: (key: string) => void, currentKey: string }) {
  const [key, setKey] = useState(currentKey);

  useEffect(() => setKey(currentKey), [currentKey]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className="bg-white rounded-xl shadow-xl w-full max-w-md overflow-hidden"
      >
        <div className="p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-bold flex items-center gap-2">
              <KeyRound className="text-note-brand" size={20} />
              APIキー設定
            </h3>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
              <X size={20} />
            </button>
          </div>

          <p className="text-sm text-gray-500 mb-4">
            Google Gemini APIキーを入力してください。<br />
            画像生成など高度な機能を利用するためには、適切な権限を持つAPIキーが必要です。
            <br />
            <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noopener noreferrer" className="text-note-brand underline hover:text-green-600">
              APIキーを取得する
            </a>
          </p>

          <input
            type="password"
            placeholder="AIxa..."
            value={key}
            onChange={(e) => setKey(e.target.value)}
            className="w-full border border-gray-300 rounded-lg p-3 text-sm focus:ring-2 focus:ring-note-brand focus:border-transparent outline-none mb-4"
          />

          <div className="flex gap-3 justify-end">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg font-medium"
            >
              キャンセル
            </button>
            <button
              onClick={() => { onSave(key); onClose(); }}
              className="px-4 py-2 text-sm bg-note-brand text-white rounded-lg font-bold hover:opacity-90 transition-opacity"
            >
              保存する
            </button>
          </div>
        </div>
      </motion.div>
    </div>
  );
}

export default function Home() {
  const [inputText, setInputText] = useState("");
  const [tone, setTone] = useState<ToneType>("standard");
  const [length, setLength] = useState<LengthType>("auto");
  const [customInstructions, setCustomInstructions] = useState("");

  const [isProcessing, setIsProcessing] = useState(false);
  const [outputText, setOutputText] = useState("");

  const [apiKey, setApiKey] = useState("");
  const [showApiKeyModal, setShowApiKeyModal] = useState(false);
  const [showToast, setShowToast] = useState<{ message: string, type: 'success' | 'error' } | null>(null);

  const [generatedImage, setGeneratedImage] = useState<string | null>(null);
  const [isGeneratingImage, setIsGeneratingImage] = useState(false);

  // Load API key from local storage
  useEffect(() => {
    const savedKey = localStorage.getItem("gemini_api_key");
    if (savedKey) setApiKey(savedKey);
  }, []);

  const handleSaveApiKey = (key: string) => {
    setApiKey(key);
    localStorage.setItem("gemini_api_key", key);
    showNotification("APIキーを保存しました", "success");
  };

  const showNotification = (message: string, type: 'success' | 'error') => {
    setShowToast({ message, type });
    setTimeout(() => setShowToast(null), 3000);
  };

  const handleGenerate = async () => {
    if (!apiKey) {
      setShowApiKeyModal(true);
      return;
    }
    if (!inputText.trim()) return;

    setIsProcessing(true);
    setOutputText("");
    setGeneratedImage(null); // Reset image

    try {
      await streamGeminiContent({
        apiKey,
        sourceText: inputText,
        tone,
        length,
        customInstructions,
        onStream: (chunk) => setOutputText(prev => prev + chunk)
      });
      showNotification("記事の生成が完了しました！次は画像を生成できます。", "success");
    } catch (error) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const err = error as any;
      showNotification("生成エラー: " + (err.message || "不明なエラー"), "error");
    } finally {
      setIsProcessing(false);
    }
  };

  const handleGenerateImage = async () => {
    if (!apiKey || !outputText) return;

    setIsGeneratingImage(true);
    try {
      // 1. Generate Prompt
      const imagePrompt = await generateImagePrompt(apiKey, outputText);
      console.log("Generated Image Prompt:", imagePrompt);

      // 2. Generate Image
      // User requested "use gemini-3-pro-image-preview", so we try.

      const imageUrl = await generateImage(apiKey, imagePrompt);
      setGeneratedImage(imageUrl);
      showNotification("ヘッダー画像を生成しました！", "success");

    } catch (error) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const err = error as any;
      console.error(err);
      showNotification("画像生成エラー: " + (err.message || "モデルが利用できません"), "error");
    } finally {
      setIsGeneratingImage(false);
    }
  };

  const copyToClipboard = () => {
    if (!outputText) return;
    navigator.clipboard.writeText(outputText);
    showNotification("クリップボードにコピーしました", "success");
  };

  return (
    <div className="min-h-screen bg-[#F9F9F9] text-[#333] font-sans">
      <ApiKeyModal
        isOpen={showApiKeyModal}
        onClose={() => setShowApiKeyModal(false)}
        onSave={handleSaveApiKey}
        currentKey={apiKey}
      />

      {/* Toast Notification */}
      <AnimatePresence>
        {showToast && (
          <motion.div
            initial={{ opacity: 0, y: -20, x: "-50%" }}
            animate={{ opacity: 1, y: 0, x: "-50%" }}
            exit={{ opacity: 0, y: -20, x: "-50%" }}
            className={cn(
              "fixed top-20 left-1/2 z-50 px-6 py-3 rounded-full shadow-lg text-white font-bold flex items-center gap-2",
              showToast.type === 'success' ? "bg-gray-800" : "bg-red-500"
            )}
          >
            {showToast.type === 'success' ? <Check size={18} /> : <AlertCircle size={18} />}
            {showToast.message}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Header */}
      <header className="fixed top-0 left-0 right-0 h-16 bg-white border-b border-gray-200 flex items-center justify-between px-6 z-10 shadow-sm">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 bg-note-brand rounded-full flex items-center justify-center text-white shadow-sm">
            <Sparkles size={18} />
          </div>
          <h1 className="text-xl font-bold tracking-tight text-gray-800">note ai agent 2</h1>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setShowApiKeyModal(true)}
            className="flex items-center gap-2 px-3 py-1.5 text-xs text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-md transition-colors"
          >
            <KeyRound size={14} />
            {apiKey ? "APIキー設定済み" : "APIキー未設定"}
          </button>
          <div className="h-6 w-px bg-gray-200"></div>
          <button className="px-4 py-2 bg-black text-white text-sm font-bold rounded-full hover:bg-gray-800 transition-colors">
            エクスポート
          </button>
        </div>
      </header>

      {/* Main Content */}
      <main className="pt-24 pb-10 px-4 md:px-8 max-w-[1600px] mx-auto min-h-[calc(100vh-80px)]">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 h-[calc(100vh-140px)] min-h-[600px]">

          {/* Left: Input Area */}
          <motion.div
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            className="lg:col-span-4 flex flex-col gap-4 h-full"
          >
            <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6 flex-1 flex flex-col hover:shadow-md transition-shadow duration-300">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-bold flex items-center gap-2 text-gray-700">
                  <FileText size={20} className="text-note-brand" />
                  元ネタ・メモ
                </h2>
                <span className={cn("text-xs font-mono", inputText.length > 0 ? "text-note-brand font-bold" : "text-gray-300")}>
                  {inputText.length} chars
                </span>
              </div>
              <textarea
                className="w-full flex-1 resize-none border-none focus:ring-0 p-0 text-gray-600 leading-relaxed placeholder-gray-300 text-base bg-transparent scrollbar-thin scrollbar-thumb-gray-200"
                placeholder="ここに箇条書きのメモや、下書きのテキストを入力してください。AIがこれを元に魅力的な記事を作成します..."
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
              />
            </div>

            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
              <input
                type="text"
                placeholder="追加の指示 (例: 具体例を多めに入れて、ターゲットは20代)"
                className="w-full text-sm border-none focus:ring-0 p-0 text-gray-700 placeholder-gray-400"
                value={customInstructions}
                onChange={(e) => setCustomInstructions(e.target.value)}
              />
            </div>
          </motion.div>

          {/* Center: Controls */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="lg:col-span-3 flex flex-col gap-4 justify-center"
          >
            <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6 w-full space-y-6">
              <div className="flex items-center gap-2 text-gray-800 font-bold text-base border-b border-gray-100 pb-2">
                <Settings2 size={18} />
                生成設定
              </div>

              <div className="space-y-5">
                <div className="space-y-2">
                  <label className="text-xs font-bold text-gray-500 uppercase tracking-wider">文体・トーン</label>
                  <div className="grid grid-cols-2 gap-2">
                    {["standard", "business", "emotional", "casual"].map((t) => (
                      <button
                        key={t}
                        onClick={() => setTone(t as ToneType)}
                        className={cn(
                          "py-2 px-3 text-sm rounded-lg border transition-all duration-200 font-medium text-left",
                          tone === t
                            ? "border-note-brand bg-green-50 text-note-brand shadow-sm"
                            : "border-gray-200 hover:border-gray-300 text-gray-600 hover:bg-gray-50"
                        )}
                      >
                        {t === "standard" && "スタンダード"}
                        {t === "business" && "ビジネス"}
                        {t === "emotional" && "エモい"}
                        {t === "casual" && "カジュアル"}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-bold text-gray-500 uppercase tracking-wider">長さの目安</label>
                  <div className="flex bg-gray-100 p-1 rounded-lg">
                    {["short", "medium", "long", "auto"].map((l) => (
                      <button
                        key={l}
                        onClick={() => setLength(l as LengthType)}
                        className={cn(
                          "flex-1 py-1.5 text-xs rounded-md font-medium transition-all duration-200",
                          length === l
                            ? "bg-white text-gray-800 shadow-sm"
                            : "text-gray-500 hover:text-gray-700"
                        )}
                      >
                        {l === "short" && "短め"}
                        {l === "medium" && "普通"}
                        {l === "long" && "長め"}
                        {l === "auto" && "自動"}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="pt-4 space-y-3">
                  <button
                    onClick={handleGenerate}
                    disabled={isProcessing || !inputText}
                    className={cn(
                      "group w-full py-4 rounded-xl flex items-center justify-center gap-2 font-bold text-white transition-all shadow-md active:scale-95",
                      isProcessing || !inputText
                        ? "bg-gray-300 cursor-not-allowed shadow-none"
                        : "bg-note-brand hover:shadow-lg hover:shadow-green-200"
                    )}
                  >
                    {isProcessing ? (
                      <RefreshCw className="animate-spin" size={20} />
                    ) : (
                      <>
                        <Sparkles size={18} className="group-hover:animate-pulse" />
                        AIで記事を作成
                      </>
                    )}
                  </button>

                  <button
                    onClick={handleGenerateImage}
                    disabled={isGeneratingImage || !outputText}
                    className={cn(
                      "group w-full py-3 rounded-xl flex items-center justify-center gap-2 font-bold transition-all border-2",
                      isGeneratingImage || !outputText
                        ? "border-gray-100 text-gray-300 cursor-not-allowed"
                        : "border-note-brand/20 text-note-brand hover:bg-green-50 hover:border-note-brand"
                    )}
                  >
                    {isGeneratingImage ? (
                      <RefreshCw className="animate-spin" size={18} />
                    ) : (
                      <>
                        <ImageIcon size={18} />
                        ヘッダー画像を生成
                      </>
                    )}
                  </button>

                  {!apiKey && (
                    <p className="text-xs text-red-500 text-center mt-2">
                      ※APIキーの設定が必要です
                    </p>
                  )}
                </div>
              </div>
            </div>

            <div className="flex justify-center text-gray-300">
              <ArrowRight size={24} className="hidden lg:block text-gray-200" />
              <div className="lg:hidden rotate-90 my-2"><ArrowRight size={24} className="text-gray-200" /></div>
            </div>
          </motion.div>

          {/* Right: Output Preview */}
          <motion.div
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.2 }}
            className="lg:col-span-5 flex flex-col gap-4 h-full"
          >
            <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-8 flex-1 flex flex-col relative overflow-hidden group">
              {!outputText && !isProcessing ? (
                <div className="absolute inset-0 flex flex-col items-center justify-center text-gray-300 bg-gray-50/50 backdrop-blur-[2px]">
                  <div className="bg-white p-4 rounded-full shadow-sm mb-4">
                    <FileText size={32} className="text-gray-200" />
                  </div>
                  <p className="font-bold text-gray-400">ここに生成された記事が表示されます</p>
                  <p className="text-sm text-gray-300 mt-2">プレビュー & コピーが可能です</p>
                </div>
              ) : (
                <>
                  <div className="flex items-center justify-between mb-6 pb-4 border-b border-gray-100">
                    <div className="flex items-center gap-2">
                      <div className="w-1.5 h-6 bg-note-brand rounded-full"></div>
                      <h2 className="text-lg font-bold text-gray-800">プレビュー</h2>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={copyToClipboard}
                        className="flex items-center gap-2 text-sm font-bold text-gray-600 hover:text-note-brand hover:bg-green-50 px-4 py-2 rounded-full transition-all"
                      >
                        <Copy size={16} />
                        コピー
                      </button>
                    </div>
                  </div>

                  {/* Generated Image Preview Area */}
                  {generatedImage && (
                    <div className="mb-6 relative rounded-xl overflow-hidden border border-gray-100 shadow-sm group/image">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={generatedImage} alt="Generated Header" className="w-full h-48 object-cover object-center" />
                      <div className="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 group-hover/image:opacity-100 transition-opacity">
                        <a
                          href={generatedImage}
                          download="note-header.png"
                          className="flex items-center gap-2 bg-white text-gray-900 px-4 py-2 rounded-full font-bold text-sm transform scale-95 group-hover/image:scale-100 transition-transform"
                        >
                          <Download size={16} />
                          ダウンロード
                        </a>
                      </div>
                    </div>
                  )}

                  <div className="flex-1 overflow-y-auto pr-2 scrollbar-thin scrollbar-thumb-gray-200 scrollbar-track-transparent">
                    <div className="prose prose-slate max-w-none prose-headings:font-bold prose-headings:text-gray-800 prose-p:text-gray-600 prose-li:text-gray-600 prose-strong:text-note-brand">
                      <div className="whitespace-pre-wrap leading-relaxed">
                        {outputText}
                      </div>
                    </div>
                    {isProcessing && (
                      <div className="flex justify-center py-4">
                        <span className="w-2 h-2 bg-note-brand rounded-full animate-bounce [animation-delay:-0.3s]"></span>
                        <span className="w-2 h-2 bg-note-brand rounded-full animate-bounce mx-1 [animation-delay:-0.15s]"></span>
                        <span className="w-2 h-2 bg-note-brand rounded-full animate-bounce"></span>
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          </motion.div>

        </div>
      </main>
    </div>
  );
}
