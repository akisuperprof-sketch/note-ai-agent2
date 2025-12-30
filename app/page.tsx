"use client";

import { useState } from "react";
import {
  Copy, RefreshCw, Sparkles, Settings2, FileText,
  ArrowRight, Check, AlertCircle, Image as ImageIcon,
  Download
} from "lucide-react";
import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import { motion, AnimatePresence } from "framer-motion";

function cn(...inputs: (string | undefined | null | false)[]) {
  return twMerge(clsx(inputs));
}

// --- Types ---
type ToneType = "standard" | "business" | "emotional" | "casual";
type LengthType = "auto" | "short" | "medium" | "long";

export default function Home() {
  const [inputText, setInputText] = useState("");
  const [tone, setTone] = useState<ToneType>("standard");
  const [length, setLength] = useState<LengthType>("auto");
  const [customInstructions, setCustomInstructions] = useState("");

  const [isProcessing, setIsProcessing] = useState(false);
  const [outputText, setOutputText] = useState("");

  const [showToast, setShowToast] = useState<{ message: string, type: 'success' | 'error' } | null>(null);

  const [generatedImage, setGeneratedImage] = useState<string | null>(null);
  const [isGeneratingImage, setIsGeneratingImage] = useState(false);

  const showNotification = (message: string, type: 'success' | 'error') => {
    setShowToast({ message, type });
    setTimeout(() => setShowToast(null), 3000);
  };

  const handleGenerate = async () => {
    if (!inputText.trim()) return;

    setIsProcessing(true);
    setOutputText("");
    setGeneratedImage(null); // Reset image

    try {
      const response = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceText: inputText,
          tone,
          length,
          customInstructions,
        }),
      });

      if (!response.ok) {
        throw new Error("Generation failed");
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error("No readable stream");

      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        setOutputText((prev) => prev + chunk);
      }

      showNotification("記事の生成が完了しました！次は画像を生成できます。", "success");
    } catch (error) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const err = error as any;
      console.error(err);
      showNotification("生成エラー: " + (err.message || "サーバーエラーが発生しました"), "error");
    } finally {
      setIsProcessing(false);
    }
  };

  const handleGenerateImage = async () => {
    if (!outputText) return;

    setIsGeneratingImage(true);
    try {
      const response = await fetch("/api/generate-image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          articleText: outputText,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Image generation failed");
      }

      const data = await response.json();
      if (data.imageUrl) {
        setGeneratedImage(data.imageUrl);
        showNotification("ヘッダー画像を生成しました！", "success");
      } else {
        throw new Error("No image URL received");
      }

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
