"use client";

import { useState, useRef, useEffect } from "react";
import {
  Play, Check, Copy, AlertCircle, X, ChevronRight, HelpCircle,
  RotateCcw, Sparkles, Wand2, Share, DollarSign, Lightbulb, ImagePlus,
  Eye, BarChart3, Download, Search, Zap,
  AlertTriangle, // Added for Dev Mode Warning
  Send, // Added for Post Button
  Pen, FileText, Terminal, ExternalLink
} from "lucide-react";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { calculateArticleScore, ArticleScore } from "@/lib/score";
import { NoteJob } from "@/lib/server/jobs";
import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";

function cn(...inputs: (string | undefined | null | false)[]) {
  return twMerge(clsx(inputs));
}

// --- Types ---
type AppStatus = "idle" | "outline" | "writing" | "polish" | "scoring" | "image_prompt" | "done" | "error" | "canceled";

// --- Components ---

function Header({ appMode, setAppMode }: { appMode?: "production" | "development", setAppMode?: (m: "production" | "development") => void }) {
  return (
    <div className="flex justify-between items-center mb-12 animate-in fade-in slide-in-from-top-4 duration-700">
      <div className="flex gap-2 items-center text-white/80">
        <div className="w-8 h-8 md:w-10 md:h-10 bg-gradient-to-br from-orange-400 to-red-600 rounded-xl flex items-center justify-center shadow-lg shadow-orange-500/20">
          <span className="text-lg md:text-xl transform -scale-x-100">🐼</span>
        </div>
        <div className="flex flex-col">
          <span className="font-bold text-sm md:text-base tracking-tight leading-none">Note AI Agent</span>
          <span className="text-[10px] text-orange-400 font-mono tracking-widest uppercase">Autonomous Ver.2.0</span>
        </div>
      </div>

      {/* Mode Switcher UI */}
      {setAppMode && (
        <div className="flex items-center gap-2 bg-black/40 rounded-full p-1 border border-white/10">
          <button
            onClick={() => setAppMode("production")}
            className={cn(
              "px-3 py-1 rounded-full text-[10px] font-bold transition-all flex items-center gap-1",
              appMode === "production" ? "bg-green-500/20 text-green-400 shadow-sm" : "text-gray-500 hover:text-gray-300"
            )}
          >
            <div className={cn("w-1.5 h-1.5 rounded-full", appMode === "production" ? "bg-green-500" : "bg-gray-600")} />
            Production
          </button>
          <button
            onClick={() => {
              if (confirm("【警告】開発モードに切り替えますか？\n\n・自動投稿機能の検証が可能になります\n・誤操作に十分注意してください")) {
                setAppMode("development");
              }
            }}
            className={cn(
              "px-3 py-1 rounded-full text-[10px] font-bold transition-all flex items-center gap-1",
              appMode === "development" ? "bg-red-500/20 text-red-400 shadow-sm" : "text-gray-500 hover:text-gray-300"
            )}
          >
            <div className={cn("w-1.5 h-1.5 rounded-full", appMode === "development" ? "bg-red-500" : "bg-gray-600")} />
            Dev Mode
          </button>
        </div>
      )}
    </div>
  );
}

function HelpModal({ onClose }: { onClose: () => void }) {
  const [doNotShow, setDoNotShow] = useState(false);

  const handleStart = () => {
    if (doNotShow) {
      localStorage.setItem("hideHelp", "true");
    }
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
      <div className="glass-card w-full max-w-md rounded-[32px] p-8 text-white shadow-2xl border border-orange-500/30 bg-gradient-to-b from-[#1A110D] to-[#0B0F1A]">
        <div className="flex justify-center mb-6">
          <div className="w-20 h-20 rounded-full bg-white shadow-xl flex items-center justify-center text-5xl border-4 border-orange-500 drop-shadow-lg">🐾</div>
        </div>

        <div className="text-center mb-8">
          <h2 className="text-2xl font-black mb-2 text-transparent bg-clip-text bg-gradient-to-r from-orange-400 to-red-400">Panda Editor's Guide</h2>
          <p className="text-sm text-orange-200/60 font-serif italic">"僕があなたの記事作りを全力でサポートするよ！"</p>
        </div>

        <div className="space-y-4 mb-8">
          <div className="flex gap-4 p-4 rounded-2xl bg-white/5 border border-white/5">
            <div className="w-8 h-8 rounded-full bg-orange-500/20 text-orange-400 flex items-center justify-center font-bold shrink-0">1</div>
            <div>
              <h3 className="font-bold mb-1">ノウハウを入力</h3>
              <p className="text-xs text-gray-400">メモやテーマを教えてね。僕が形にするよ！</p>
            </div>
          </div>
          <div className="flex gap-4 p-4 rounded-2xl bg-white/5 border border-white/5">
            <div className="w-8 h-8 rounded-full bg-red-500/20 text-red-400 flex items-center justify-center font-bold shrink-0">2</div>
            <div>
              <h3 className="font-bold mb-1">AIがワンストップ生成</h3>
              <p className="text-xs text-gray-400">構成から画像まで、僕が全部プロデュースするよ。</p>
            </div>
          </div>
          <div className="flex gap-4 p-4 rounded-2xl bg-white/5 border border-white/5">
            <div className="w-8 h-8 rounded-full bg-yellow-500/20 text-yellow-400 flex items-center justify-center font-bold shrink-0">3</div>
            <div>
              <h3 className="font-bold mb-1">プレビューで確認</h3>
              <p className="text-xs text-gray-400">パンダ印の独自ビューワーで仕上がりをチェック！</p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 mb-6 cursor-pointer justify-center" onClick={() => setDoNotShow(!doNotShow)}>
          <div className={cn("w-5 h-5 rounded border border-white/30 flex items-center justify-center transition-colors", doNotShow && "bg-orange-500 border-orange-500")}>
            {doNotShow && <Check size={14} />}
          </div>
          <span className="text-xs text-gray-400">パンダのアドバイスを次回から非表示</span>
        </div>

        <button
          onClick={handleStart}
          className="w-full py-4 rounded-[28px] bg-gradient-to-r from-orange-500 to-red-600 font-black text-lg hover:shadow-lg hover:shadow-orange-500/25 transition-all text-white active:scale-95"
        >
          レッサーパンダと執筆開始
        </button>
      </div>
    </div>
  );
}

function BrandFooter() {
  return (
    <footer className="mt-20 py-12 border-t border-white/5 text-center">
      <div className="flex flex-col items-center gap-4 opacity-40 hover:opacity-100 transition-opacity">
        <div className="text-2xl">🐾</div>
        <div className="text-[10px] font-mono tracking-[0.3em] uppercase">
          Produced for original creators by<br />
          <span className="text-orange-400 font-bold">note AI AGENT - Red Panda Project</span>
        </div>
        <div className="text-[9px] text-gray-600 mt-4 font-serif">
          © 2025 note AI AGENT. All rights reserved. Independent AI Service.
        </div>
      </div>
    </footer>
  );
}

function StepCards({ onStart }: { onStart: () => void }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
      {[
        { num: 1, title: "あなたの役割", desc: "書きたいこと・ノウハウの指示" },
        { num: 2, title: "パンダの役割", desc: "構成・執筆・画像生成を代行" },
        { num: 3, title: "完成パッケージ", desc: "コピペするだけで投稿完了" }
      ].map((step) => (
        <div key={step.num} onClick={onStart} className="glass-card p-6 rounded-[24px] cursor-pointer hover:bg-white/10 transition-colors group">
          <div className="flex items-center justify-between mb-4">
            <span className="text-4xl font-bold text-white/5 group-hover:text-white/10 transition-colors">0{step.num}</span>
            <div className="w-8 h-8 rounded-full bg-white/5 flex items-center justify-center group-hover:bg-purple-500/20 transition-colors">
              <ChevronRight size={16} className="text-white/30 group-hover:text-purple-400" />
            </div>
          </div>
          <h3 className="text-lg font-bold mb-1">{step.title}</h3>
          <p className="text-sm text-gray-400">{step.desc}</p>
        </div>
      ))}
    </div>
  );
}

function InputForm({
  onSubmit, isGenerating
}: {
  onSubmit: (data: any) => void, isGenerating: boolean
}) {
  const [topic, setTopic] = useState("");
  const [targetAudience, setTargetAudience] = useState("");
  const [goal, setGoal] = useState("");
  const [targetLength, setTargetLength] = useState(2500);
  const [tone, setTone] = useState("やさしい");
  const [differentiation, setDifferentiation] = useState("");
  const [outlineSupplement, setOutlineSupplement] = useState("");
  const [visualStyle, setVisualStyle] = useState("アニメ塗り");
  const [character, setCharacter] = useState("note記事つくレッサーパンダ");
  const [referenceImage, setReferenceImage] = useState<string | null>(null);
  const [strictCharacter, setStrictCharacter] = useState(true);
  const [showEyecatchTitle, setShowEyecatchTitle] = useState(true);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isRecommending, setIsRecommending] = useState(false);

  // Load persistence
  useEffect(() => {
    const saved = localStorage.getItem("panda_last_inputs");
    if (saved) {
      try {
        const d = JSON.parse(saved);
        setTopic(d.topic || "");
        setTargetAudience(d.targetAudience || "");
        setGoal(d.goal || "");
        setTargetLength(d.targetLength || 2500);
        setTone(d.tone || "やさしい");
        setDifferentiation(d.differentiation || "");
        setOutlineSupplement(d.outlineSupplement || "");
        setVisualStyle(d.visualStyle || "アニメ塗り");
        setCharacter(d.character || "note記事つくレッサーパンダ");
        setReferenceImage(d.referenceImage || null);
        setStrictCharacter(d.strictCharacter ?? true);
        setShowEyecatchTitle(d.showEyecatchTitle ?? true);
      } catch (e) { console.error("Failed to load persistence", e); }
    }
  }, []);

  // Save persistence
  useEffect(() => {
    const d = {
      topic, targetAudience, goal, targetLength, tone,
      differentiation, outlineSupplement, visualStyle, character,
      // referenceImage: Excluded to save space
      strictCharacter, showEyecatchTitle
    };
    localStorage.setItem("panda_last_inputs", JSON.stringify(d));
  }, [topic, targetAudience, goal, targetLength, tone, differentiation, outlineSupplement, visualStyle, character, strictCharacter, showEyecatchTitle]);

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setReferenceImage(reader.result as string);
        setCharacter("参考画像"); // Auto-select Reference Image when uploaded
      };
      reader.readAsDataURL(file);
    }
  };

  const handleAutoRecommend = async () => {
    if (!topic) {
      alert("まずは「記事テーマ・ノウハウメモ」を入力してね！");
      return;
    }

    setIsRecommending(true);
    try {
      const res = await fetch("/api/recommend", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Failed to recommend");

      setTargetAudience(d.targetAudience || "");
      setGoal(d.goal || "");
      setDifferentiation(d.differentiation || "");
      setOutlineSupplement(d.outlineSupplement || "");
    } catch (e) {
      console.error(e);
      const err = e as Error;
      alert(`AIの提案に失敗しました: ${err.message}\nしばらく時間をおいて試すか、手動で入力してください。`);
      // No silent fallback to generic data - keeps the user informed
    } finally {
      setIsRecommending(false);
    }
  };

  const handleSubmit = () => {
    if (!topic) return;
    onSubmit({
      topic, targetAudience, goal, targetLength, tone,
      differentiation, outlineSupplement, visualStyle, character, referenceImage,
      strictCharacter, showEyecatchTitle
    });
  };

  if (isGenerating) return null;

  return (
    <div className="glass-card p-6 md:p-8 rounded-[32px] space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500 border border-orange-500/20 shadow-xl">
      <div className="flex items-center gap-2 pb-4 border-b border-white/5">
        <div className="w-8 h-8 rounded-lg bg-orange-500/20 flex items-center justify-center text-orange-400">📝</div>
        <h2 className="text-xl font-black text-white">記事の独自設計</h2>
      </div>

      <div className="space-y-4">
        {/* Topic Input */}
        <div className="space-y-2">
          <div className="flex justify-between items-center">
            <label className="text-sm font-bold text-gray-400 flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-orange-500"></span>
              記事テーマ・ノウハウメモ
            </label>
            <button
              onClick={handleAutoRecommend}
              disabled={isRecommending}
              className={cn(
                "text-[10px] border px-3 py-1 rounded-full flex items-center gap-1 font-bold transition-all uppercase tracking-tight",
                isRecommending
                  ? "bg-orange-500/20 text-orange-200 border-orange-500/50 animate-pulse"
                  : "bg-white/5 text-orange-400 border-orange-500/30 hover:bg-orange-500/10"
              )}
            >
              {isRecommending ? (
                <>
                  <RotateCcw size={10} className="animate-spin" /> 分析中...
                </>
              ) : (
                <>
                  <Wand2 size={10} /> AIにおまかせ設定
                </>
              )}
            </button>
          </div>
          <div className="relative group">
            <textarea
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              placeholder="（例）初心者向けのNotion使い方。データベース機能を中心に、タスク管理のテンプレートの作り方を解説したい。"
              className="w-full h-32 bg-black/40 border border-white/10 rounded-2xl p-4 text-white placeholder-white/10 focus:outline-none focus:border-orange-500/50 transition-colors resize-none font-serif"
            />
            {topic && (
              <div className="absolute top-3 right-3 flex gap-2">
                <button
                  onClick={() => navigator.clipboard.writeText(topic)}
                  className="p-1.5 bg-black/50 hover:bg-black/80 rounded-lg text-white/50 hover:text-white transition-colors border border-white/5"
                  title="コピー"
                >
                  <Copy size={14} />
                </button>
                <button
                  onClick={() => setTopic("")}
                  className="p-1.5 bg-black/50 hover:bg-black/80 rounded-lg text-white/50 hover:text-red-400 transition-colors border border-white/5"
                  title="消去"
                >
                  <X size={14} />
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Reference Image Upload */}
        <div className="space-y-2">
          <label className="text-sm font-bold text-gray-400">参考画像（任意）</label>
          <div
            onClick={() => fileInputRef.current?.click()}
            className={cn(
              "relative group cursor-pointer border-2 border-dashed rounded-xl transition-all flex flex-col items-center justify-center overflow-hidden",
              referenceImage ? "border-purple-500 h-48" : "border-white/10 h-32 hover:border-white/20 bg-white/5"
            )}
          >
            {referenceImage ? (
              <>
                <img src={referenceImage} alt="Reference" className="w-full h-full object-contain" />
                <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                  <span className="text-xs font-bold text-white flex items-center gap-2">
                    <ImagePlus size={16} /> 別の画像に変更
                  </span>
                </div>
                <button
                  onClick={(e) => { e.stopPropagation(); setReferenceImage(null); }}
                  className="absolute top-2 right-2 p-1.5 bg-black/60 rounded-full text-white/70 hover:text-white transition-colors"
                >
                  <X size={14} />
                </button>
              </>
            ) : (
              <div className="text-center space-y-2">
                <div className="w-10 h-10 rounded-full bg-white/5 flex items-center justify-center mx-auto group-hover:bg-white/10 transition-colors">
                  <ImagePlus size={20} className="text-white/40 group-hover:text-white/60" />
                </div>
                <p className="text-xs text-white/40 font-medium">クリックして画像をアップロード<br />(雰囲気の参考にします)</p>
              </div>
            )}
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleImageChange}
              accept="image/*"
              className="hidden"
            />
          </div>
        </div>

        {/* Strict Character Toggle */}
        {referenceImage && (
          <div
            className="flex items-center justify-between p-3 rounded-xl bg-purple-500/5 border border-purple-500/10 cursor-pointer hover:bg-purple-500/10 transition-colors"
            onClick={() => setStrictCharacter(!strictCharacter)}
          >
            <div className="flex flex-col">
              <span className="text-sm font-bold text-purple-300">参考キャラを必須にする</span>
              <span className="text-[10px] text-purple-300/60 font-medium">ONにすると、AIがこの画像の特徴を強力に守ります</span>
            </div>
            <div className={cn(
              "w-12 h-6 rounded-full relative transition-colors duration-300",
              strictCharacter ? "bg-purple-500" : "bg-white/10"
            )}>
              <div className={cn(
                "absolute top-1 w-4 h-4 rounded-full bg-white transition-all duration-300",
                strictCharacter ? "left-7" : "left-1"
              )} />
            </div>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-2">
          <label className="text-sm font-bold text-gray-400">誰に届けるか</label>
          <div className="relative group">
            <input
              type="text"
              value={targetAudience}
              onChange={(e) => setTargetAudience(e.target.value)}
              placeholder="（例）20代の若手社員"
              className="w-full bg-black/40 border border-white/10 rounded-xl p-3 text-white placeholder-white/10 focus:outline-none focus:border-orange-500/50 transition-colors pr-20"
            />
            {targetAudience && (
              <div className="absolute top-1/2 -translate-y-1/2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <button
                  onClick={() => navigator.clipboard.writeText(targetAudience)}
                  className="p-1.5 hover:bg-white/10 rounded-md text-white/50 hover:text-white transition-colors"
                >
                  <Copy size={12} />
                </button>
                <button
                  onClick={() => setTargetAudience("")}
                  className="p-1.5 hover:bg-white/10 rounded-md text-white/50 hover:text-red-400 transition-colors"
                >
                  <X size={12} />
                </button>
              </div>
            )}
          </div>
        </div>
        <div className="space-y-2">
          <label className="text-sm font-bold text-gray-400">この記事だけの価値</label>
          <div className="relative group">
            <input
              type="text"
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
              placeholder="（例）信頼獲得、LINE登録"
              className="w-full bg-black/40 border border-white/10 rounded-xl p-3 text-white placeholder-white/10 focus:outline-none focus:border-orange-500/50 transition-colors pr-20"
            />
            {goal && (
              <div className="absolute top-1/2 -translate-y-1/2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <button
                  onClick={() => navigator.clipboard.writeText(goal)}
                  className="p-1.5 hover:bg-white/10 rounded-md text-white/50 hover:text-white transition-colors"
                >
                  <Copy size={12} />
                </button>
                <button
                  onClick={() => setGoal("")}
                  className="p-1.5 hover:bg-white/10 rounded-md text-white/50 hover:text-red-400 transition-colors"
                >
                  <X size={12} />
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="space-y-4">
        <div className="space-y-2">
          <label className="text-sm font-bold text-gray-400">独自の切り口・コンセプト</label>
          <div className="relative group">
            <input
              type="text"
              value={differentiation}
              onChange={(e) => setDifferentiation(e.target.value)}
              placeholder="（例）競合にはない独自の視点や体験談"
              className="w-full bg-black/40 border border-white/10 rounded-xl p-3 text-white placeholder-white/10 focus:outline-none focus:border-orange-500/50 transition-colors pr-20"
            />
            {differentiation && (
              <div className="absolute top-1/2 -translate-y-1/2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <button
                  onClick={() => navigator.clipboard.writeText(differentiation)}
                  className="p-1.5 hover:bg-white/10 rounded-md text-white/50 hover:text-white transition-colors"
                >
                  <Copy size={12} />
                </button>
                <button
                  onClick={() => setDifferentiation("")}
                  className="p-1.5 hover:bg-white/10 rounded-md text-white/50 hover:text-red-400 transition-colors"
                >
                  <X size={12} />
                </button>
              </div>
            )}
          </div>
        </div>
        <div className="space-y-2">
          <label className="text-sm font-bold text-gray-400">目次の構成・補足</label>
          <div className="relative group">
            <textarea
              value={outlineSupplement}
              onChange={(e) => setOutlineSupplement(e.target.value)}
              placeholder="（例）具体的な成功事例と失敗から学んだこと"
              className="w-full h-24 bg-black/40 border border-white/10 rounded-xl p-3 text-white placeholder-white/10 focus:outline-none focus:border-orange-500/50 transition-colors resize-none pr-10"
            />
            {outlineSupplement && (
              <div className="absolute top-2 right-2 flex gap-1 bg-black/40 rounded-lg p-1">
                <button
                  onClick={() => navigator.clipboard.writeText(outlineSupplement)}
                  className="p-1.5 hover:bg-white/20 rounded-md text-white/50 hover:text-white transition-colors"
                >
                  <Copy size={12} />
                </button>
                <button
                  onClick={() => setOutlineSupplement("")}
                  className="p-1.5 hover:bg-white/20 rounded-md text-white/50 hover:text-red-400 transition-colors"
                >
                  <X size={12} />
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-2">
          <label className="text-sm font-bold text-gray-400">目標文字数</label>
          <select
            value={targetLength}
            onChange={(e) => setTargetLength(Number(e.target.value))}
            className="w-full bg-black/40 border border-white/10 rounded-xl p-3 text-white focus:outline-none focus:border-orange-500/50 appearance-none transition-colors"
          >
            <option value={2500}>2,500文字（サクッと）</option>
            <option value={5000}>5,000文字（標準）</option>
            <option value={8000}>8,000文字（長編）</option>
            <option value={10000}>10,000文字（網羅）</option>
            <option value={20000}>20,000文字（超大作）</option>
            <option value={30000}>30,000文字（書籍級）</option>
            <option value={50000}>50,000文字（電子書籍）</option>
            <option value={100000}>100,000文字（長編小説）</option>
          </select>
        </div>
        <div className="space-y-2">
          <label className="text-sm font-bold text-gray-400">トーン</label>
          <select
            value={tone}
            onChange={(e) => setTone(e.target.value)}
            className="w-full bg-black/40 border border-white/10 rounded-xl p-3 text-white focus:outline-none focus:border-orange-500/50 appearance-none transition-colors"
          >
            <option value="やさしい">やさしい・親しみやすい</option>
            <option value="専門家">専門家・信頼感</option>
            <option value="エモーショナル">エモーショナル・熱量</option>
            <option value="論理的">論理的・クール</option>
          </select>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-2">
          <label className="text-sm font-bold text-gray-400">画像の画風</label>
          <select
            value={visualStyle}
            onChange={(e) => setVisualStyle(e.target.value)}
            className="w-full bg-black/20 border border-white/10 rounded-xl p-3 text-white focus:outline-none focus:border-purple-500/50 appearance-none"
          >
            <option value="写真リアル">実写（フォトリアル）</option>
            <option value="アニメ塗り">アニメ・イラスト調</option>
            <option value="水彩画">水彩画・淡いタッチ</option>
            <option value="3Dレンダリング">3D CG・モダン</option>
            <option value="ドット絵">ドット絵・レトロ</option>
          </select>
        </div>
        <div className="space-y-2">
          <label className="text-sm font-bold text-gray-400">アイキャッチの設定</label>
          <div
            onClick={() => setShowEyecatchTitle(!showEyecatchTitle)}
            className="w-full bg-black/20 border border-white/10 rounded-xl p-3 flex items-center justify-between cursor-pointer hover:bg-white/5 transition-all text-white"
          >
            <span className="text-sm font-bold">タイトルを画像に入れる</span>
            <div className={cn(
              "w-10 h-5 rounded-full relative transition-colors duration-300",
              showEyecatchTitle ? "bg-orange-500" : "bg-white/10"
            )}>
              <div className={cn(
                "absolute top-1 w-3 h-3 rounded-full bg-white transition-all duration-300",
                showEyecatchTitle ? "left-6" : "left-1"
              )} />
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-2">
          <label className="text-sm font-bold text-gray-400">登場キャラクター</label>
          <select
            value={character}
            onChange={(e) => setCharacter(e.target.value)}
            className="w-full bg-black/20 border border-white/10 rounded-xl p-3 text-white focus:outline-none focus:border-purple-500/50 appearance-none"
          >
            <option value="note記事つくレッサーパンダ">note記事つくレッサーパンダ（マスコット）</option>
            <option value="参考画像">参考画像（アップロードした画像）</option>
            <option value="指定なし">指定なし（風景・抽象のみ）</option>
            <option value="日本人女性">日本人女性（20代・ビジネス）</option>
            <option value="日本人女性_カジュアル">日本人女性（カジュアル）</option>
            <option value="外国人女性">外国人女性（モデル風）</option>
            <option value="男性ビジネス">男性（ビジネス）</option>
            <option value="猫">猫（かわいらしく）</option>
            <option value="ロボット">未来的なロボット</option>
          </select>
        </div>
      </div>

      <div className="pt-4">
        <button
          onClick={handleSubmit}
          disabled={!topic}
          className={cn(
            "w-full py-4 rounded-[28px] font-bold text-lg transition-all flex items-center justify-center gap-2",
            topic ? "bg-gradient-primary text-white hover:shadow-lg hover:shadow-purple-500/25" : "bg-white/10 text-white/30 cursor-not-allowed"
          )}
        >
          <Play size={20} fill="currentColor" />
          記事を生成する
        </button>
      </div>
    </div>
  );
}


function ProgressLog({ logs }: { logs: string[] }) {
  return (
    <div className="bg-black/40 rounded-[24px] p-8 border border-white/10 max-w-2xl mx-auto mt-8 relative overflow-hidden">
      <div className="absolute inset-0 bg-gradient-to-b from-purple-500/5 to-transparent pointer-events-none"></div>
      <div className="space-y-4">
        {logs.map((log, i) => (
          <div key={i} className="flex items-center gap-4 animate-in fade-in slide-in-from-left-4 duration-500">
            <div className="w-6 h-6 rounded-full bg-green-500/20 flex items-center justify-center shrink-0">
              <Check size={14} className="text-green-400" />
            </div>
            <span className="text-lg text-white font-medium">{log}</span>
          </div>
        ))}
        {/* Show processing indicator if not done (assuming < 6 logs logic is slightly brittle, but fine for now) */}
        {logs.length < 6 && (
          <div className="flex items-center gap-4">
            <div className="w-6 h-6 rounded-full border-2 border-white/20 border-t-purple-500 animate-spin shrink-0"></div>
            <span className="text-lg text-white animate-pulse font-bold">現在生成中...</span>
          </div>
        )}
      </div>
    </div>
  );
}


function ScoreMeter({ score, summary }: { score: number, summary: string }) {
  const r = 70;
  const c = 2 * Math.PI * r;
  const offset = c - (score / 100) * c;

  return (
    <div className="flex flex-col items-center justify-center mb-8">
      <div className="relative w-40 h-40 flex items-center justify-center mb-4">
        <svg className="w-full h-full transform -rotate-90">
          <circle cx="80" cy="80" r={r} fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth="12" />
          <circle
            cx="80" cy="80" r={r} fill="none" stroke="url(#gradient)" strokeWidth="12"
            strokeDasharray={c} strokeDashoffset={offset} strokeLinecap="round"
            className="transition-all duration-1000 ease-out"
          />
          <defs>
            <linearGradient id="gradient" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#7B61FF" />
              <stop offset="100%" stopColor="#4DA3FF" />
            </linearGradient>
          </defs>
        </svg>
        <div className="absolute flex flex-col items-center">
          <span className="text-4xl font-bold text-white">{score}</span>
          <span className="text-xs text-white/50">/100</span>
        </div>
      </div>
      <div className="px-4 py-1 rounded-full bg-white/10 text-white font-bold text-sm border border-white/10 backdrop-blur-sm">
        {summary}
      </div>
    </div>
  );
}

function ScoreBars({ details, metrics }: { details: ArticleScore['details'], metrics: ArticleScore['metrics'] }) {
  const items = [
    { label: "文字数達成度", score: details.length.score, val: `${metrics.actualLength}字` },
    { label: "論理性", score: details.logicality.score, val: `${metrics.logicKeywords}回` },
    { label: "共感性", score: details.empathy.score, val: `${metrics.empathyKeywords}回` },
    { label: "独自性", score: details.uniqueness.score, val: `${metrics.uniqueKeywords}回` },
    { label: "読みやすさ", score: details.readability.score, val: `${metrics.avgSentenceLength}文字/文` },
    { label: "構成の質", score: details.structure.score, val: `H2:${metrics.h2Count} H3:${metrics.h3Count}` },
    { label: "充実度", score: details.richness.score, val: `段落:${metrics.paragraphCount}` },
    { label: "SEO最適度", score: details.seo.score, val: `${metrics.titleLength}字` }
  ];

  return (
    <div className="space-y-4">
      {items.map((item, i) => (
        <div key={i} className="flex flex-col gap-1">
          <div className="flex justify-between text-xs text-white/70 mb-1">
            <span>{item.label}</span>
            <span>{item.val}</span>
          </div>
          <div className="h-2 w-full bg-white/10 rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-purple-500 to-blue-500 rounded-full transition-all duration-1000"
              style={{ width: `${item.score}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

// --- History Feature ---
type HistoryItem = {
  id: string;
  timestamp: string;
  displayTitle: string;
  articleText: string;
  generatedImage: string | null;
  inlineImages: { heading: string, url: string }[];
  score: ArticleScore | null;
  metaDescription: string;
  hashtags: string[];
  inputs: any;
};

function HistoryList({
  onRestore, onClose
}: {
  onRestore: (item: HistoryItem) => void, onClose: () => void
}) {
  const [items, setItems] = useState<HistoryItem[]>([]);

  useEffect(() => {
    const saved = localStorage.getItem("panda_history");
    if (saved) {
      try {
        setItems(JSON.parse(saved));
      } catch (e) {
        console.error("Failed to load history", e);
      }
    }
  }, []);

  const saveToHistory = (itemData: Omit<HistoryItem, "id" | "timestamp">) => {
    const newItem: HistoryItem = {
      id: Date.now().toString(),
      timestamp: new Date().toLocaleString(),
      ...itemData
    };

    // Attempt to save with smart cleaning
    try {
      // Optimize: Remove heavy reference image from history inputs to save space
      const safeInputs = { ...itemData.inputs };
      if (safeInputs.referenceImage && safeInputs.referenceImage.length > 500) {
        safeInputs.referenceImage = null; // Don't save base64 image to history
      }

      const optimizedNewItem = {
        ...newItem,
        inputs: safeInputs
      };

      const current = items;
      const updated = [optimizedNewItem, ...current]; // Newest first
      localStorage.setItem("panda_history", JSON.stringify(updated));
      setItems(updated);
    } catch (e: any) {
      // Catch ALL errors to prevent crashing the main app flow
      console.warn("History save warning:", e);

      // Try smart cleaning for any error that looks like quota/storage issue
      try {
        // Optimize logic again for retry
        const safeInputs = { ...itemData.inputs };
        if (safeInputs.referenceImage) safeInputs.referenceImage = null;
        const retryItem = { ...newItem, inputs: safeInputs };

        let reducedItems = [...items];
        let saved = false;

        // Iteratively remove oldest items until save succeeds
        while (reducedItems.length > 0 && !saved) {
          reducedItems.pop(); // Remove oldest
          try {
            const retryUpdated = [retryItem, ...reducedItems];
            localStorage.setItem("panda_history", JSON.stringify(retryUpdated));
            setItems(retryUpdated);
            saved = true;
            console.log("Successfully saved after clearing old history.");
          } catch (retryError) {
            // Continue loop
          }
        }

        if (!saved) {
          // Fallback: Clear all and save only new item
          try {
            localStorage.setItem("panda_history", JSON.stringify([retryItem]));
            setItems([retryItem]);
          } catch (finalError) {
            console.error("Critical: Cannot save even a single item.", finalError);
            // Do NOT alert aggressively to avoid disturbing user flow too much
          }
        }
      } catch (cleanupError) {
        console.error("Cleanup failed", cleanupError);
      }
    }
  };

  const deleteItem = (id: string) => {
    const updated = items.filter(i => i.id !== id);
    setItems(updated);
    localStorage.setItem("panda_history", JSON.stringify(updated));
  };

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/90 backdrop-blur-md p-4">
      <div className="w-full max-w-2xl glass-card rounded-[32px] overflow-hidden flex flex-col max-h-[85vh] border border-orange-500/20 shadow-2xl">
        <div className="p-6 border-b border-white/5 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-xl">📚</span>
            <div>
              <h2 className="text-lg font-black text-white">過去のプロデュース履歴</h2>
              <p className="text-[10px] text-orange-400 font-bold uppercase tracking-widest">History Management</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-full transition-colors text-white/40 hover:text-white">
            <X size={20} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {items.length === 0 ? (
            <div className="h-64 flex flex-col items-center justify-center text-white/20 italic">
              <span className="text-4xl mb-4">🐾</span>
              履歴はまだありません
            </div>
          ) : (
            items.map(item => (
              <div key={item.id} className="group glass-card p-4 rounded-2xl bg-white/5 border border-white/5 hover:border-orange-500/30 transition-all">
                <div className="flex gap-4">
                  {item.generatedImage ? (
                    <img src={item.generatedImage} className="w-24 h-24 object-cover rounded-xl border border-white/10" />
                  ) : (
                    <div className="w-24 h-24 bg-white/5 rounded-xl flex items-center justify-center text-xl">🐾</div>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[10px] font-mono text-white/30">{item.timestamp}</span>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          if (confirm('本当にこの履歴を削除しますか？')) deleteItem(item.id);
                        }}
                        className="p-2 bg-white/5 hover:bg-red-500/20 rounded-full text-white/40 hover:text-red-400 transition-all border border-transparent hover:border-red-500/30"
                        title="この履歴を削除"
                      >
                        <X size={16} />
                      </button>
                    </div>
                    <h3 className="text-sm font-bold text-white mb-1 truncate">{item.displayTitle}</h3>
                    <p className="text-[10px] text-gray-400 line-clamp-2 mb-3 leading-relaxed">{item.metaDescription || item.articleText.substring(0, 100)}</p>
                    <button
                      onClick={() => onRestore(item)}
                      className="text-[10px] font-black uppercase tracking-tighter bg-orange-500 text-white px-4 py-1.5 rounded-full shadow-lg hover:scale-105 active:scale-95 transition-all"
                    >
                      この結果を復元する
                    </button>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

// --- Mobile Copy Helper ---
function MobileCopyHelper({ title, body, tags }: { title: string, body: string, tags: string[] }) {
  const [copied, setCopied] = useState<string | null>(null);

  const copy = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    setCopied(label);
    setTimeout(() => setCopied(null), 2000);
  };

  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[100] md:hidden w-[90%] max-w-[400px]">
      <div className="glass-card bg-[#1A1A1A]/95 backdrop-blur-2xl border border-orange-500/30 rounded-[32px] p-2.5 shadow-[0_20px_50px_rgba(0,0,0,0.5)] flex items-center justify-between gap-3 border shadow-orange-500/10 scale-100 animate-in fade-in slide-in-from-bottom-8 duration-500">
        <div className="flex-1 flex gap-2 overflow-x-auto scrollbar-hide py-1">
          <button
            onClick={() => copy(title, 'タイトル')}
            className={cn("px-4 py-3 rounded-2xl text-[10px] font-black uppercase tracking-tighter transition-all shrink-0 border", copied === 'タイトル' ? "bg-green-500 border-green-400 text-white" : "bg-white/5 border-white/10 text-white/80 hover:bg-white/10")}
          >
            {copied === 'タイトル' ? "OK!" : "タイトル"}
          </button>
          <button
            onClick={() => copy(body, '本文')}
            className={cn("px-4 py-3 rounded-2xl text-[10px] font-black uppercase tracking-tighter transition-all shrink-0 border", copied === '本文' ? "bg-green-500 border-green-400 text-white" : "bg-white/5 border-white/10 text-white/80 hover:bg-white/10")}
          >
            {copied === '本文' ? "OK!" : "本文"}
          </button>
          <button
            onClick={() => copy(tags.join(" "), 'タグ')}
            className={cn("px-4 py-3 rounded-2xl text-[10px] font-black uppercase tracking-tighter transition-all shrink-0 border", copied === 'タグ' ? "bg-green-500 border-green-400 text-white" : "bg-white/5 border-white/10 text-white/80 hover:bg-white/10")}
          >
            {copied === 'タグ' ? "OK!" : "タグ"}
          </button>
        </div>
        <div className="w-[1px] h-8 bg-white/10 shrink-0" />
        <button
          onClick={() => window.open('https://note.com/notes/new', '_blank')}
          className="bg-gradient-to-br from-orange-400 to-red-500 text-white p-4 rounded-full shadow-lg shadow-orange-500/20 active:scale-90 hover:scale-105 transition-all shrink-0 border border-white/20"
        >
          <div className="w-5 h-5 flex items-center justify-center">
            <Pen size={20} />
          </div>
        </button>
      </div>
    </div>
  );
}

// --- Main Page Updated Logic ---

export default function Home() {
  const [showHelp, setShowHelp] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [status, setStatus] = useState<AppStatus>("idle");
  const [logs, setLogs] = useState<string[]>([]);
  const [inputs, setInputs] = useState<any>(null);
  const [articleText, setArticleText] = useState("");
  const [score, setScore] = useState<ArticleScore | null>(null);
  const [generatedImage, setGeneratedImage] = useState<string | null>(null);
  const [imagePrompt, setImagePrompt] = useState("");
  const [displayTitle, setDisplayTitle] = useState(""); // State for title overlay
  const [textModel, setTextModel] = useState("");
  const [imageModel, setImageModel] = useState("");
  const [inlineImage, setInlineImage] = useState<string | null>(null);
  const [inlineHeading, setInlineHeading] = useState("");
  const [inlineImages, setInlineImages] = useState<{ heading: string, url: string }[]>([]);
  const [isGeneratingInlines, setIsGeneratingInlines] = useState(false);
  const [metaDescription, setMetaDescription] = useState("");
  const [hashtags, setHashtags] = useState<string[]>([]);
  const [activeTab, setActiveTab] = useState<"result" | "preview" | "score">("result");
  const [eyecatchError, setEyecatchError] = useState<string | null>(null);
  const [inlineErrors, setInlineErrors] = useState<{ heading: string, error: string }[]>([]);

  // Mode Management
  const [appMode, setAppMode] = useState<"production" | "development">("production");
  const [postedArticles, setPostedArticles] = useState<Set<string>>(new Set());
  const [postStatus, setPostStatus] = useState<"idle" | "posting" | "success" | "error" | "stopped">("idle");
  const [postLogs, setPostLogs] = useState<{ text: string, time: string }[]>([]);
  const [startTime, setStartTime] = useState<number | null>(null);
  const [elapsedTime, setElapsedTime] = useState("0:00");
  const [notePostConsoleUrl, setNotePostConsoleUrl] = useState<string | null>(null);
  const [errorScreenshot, setErrorScreenshot] = useState<string | null>(null);
  const [visualDebug, setVisualDebug] = useState(false);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  // Restore logs from session storage on mount
  useEffect(() => {
    const saved = sessionStorage.getItem('note_post_logs');
    const savedStatus = sessionStorage.getItem('note_post_status');
    const savedUrl = sessionStorage.getItem('note_post_url');
    if (saved) setPostLogs(JSON.parse(saved));

    // Only auto-restore 'posting' status to avoid confusion with old errors
    if (savedStatus === 'posting') {
      setPostStatus('posting');
      setStartTime(Date.now()); // Approximate
    } else if (savedStatus && savedStatus !== 'idle') {
      // Just keep the logs, but keep status idle so buttons show
      setPostStatus('idle');
    }
    if (savedUrl) setNotePostConsoleUrl(savedUrl);
  }, []);

  // Persist logs to session storage
  useEffect(() => {
    if (postLogs.length > 0) sessionStorage.setItem('note_post_logs', JSON.stringify(postLogs));
    sessionStorage.setItem('note_post_status', postStatus);
    sessionStorage.setItem('note_post_url', notePostConsoleUrl || "");
  }, [postLogs, postStatus, notePostConsoleUrl]);

  useEffect(() => {
    if (startTime && postStatus === 'posting') {
      timerRef.current = setInterval(() => {
        const diff = Math.floor((Date.now() - startTime) / 1000);
        const mins = Math.floor(diff / 60);
        const secs = diff % 60;
        setElapsedTime(`${mins}:${secs.toString().padStart(2, '0')}`);
      }, 1000);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [startTime, postStatus]);

  const NotePostConsole = () => {
    if (postStatus === 'idle') return null;
    return (
      <div className="mt-8 rounded-3xl bg-neutral-900/50 border border-white/5 overflow-hidden animate-in fade-in slide-in-from-bottom-4 duration-700">
        <div className="p-6 border-b border-white/5 bg-white/5 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="bg-orange-500/10 p-3 rounded-2xl">
              <Pen size={20} className="text-orange-500 animate-bounce" />
            </div>
            <div>
              <h3 className="text-lg font-black text-white leading-none mb-1">AIエージェント解析</h3>
              <p className="text-xs text-white/40 font-mono italic">経過時間: {elapsedTime}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {postStatus === 'error' && (
              <button
                onClick={() => {
                  setPostStatus('idle');
                  setPostLogs([]);
                  setErrorScreenshot(null);
                  sessionStorage.clear();
                }}
                className="flex items-center gap-1.5 text-[10px] font-bold text-white/40 hover:text-white bg-white/5 hover:bg-white/10 border border-white/10 px-3 py-1.5 rounded-full transition-all"
              >
                <RotateCcw size={12} />
                ログをクリアして再試行
              </button>
            )}
            <div className="flex items-center gap-2 px-3 py-1 bg-white/5 rounded-full">
              <div className={`w-1.5 h-1.5 rounded-full ${postStatus === 'posting' ? 'bg-orange-500 animate-pulse' : postStatus === 'success' ? 'bg-green-500' : 'bg-red-500'}`}></div>
              <span className="text-[10px] font-black text-white/50 uppercase tracking-widest">
                {postStatus === 'posting' ? 'Processing...' : postStatus === 'success' ? 'Finished' : 'Failed'}
              </span>
            </div>
          </div>
        </div>

        <div className="p-6 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-white/40">
              <Terminal size={16} />
              <span className="text-[11px] font-black uppercase tracking-widest">診断・処理ログ</span>
            </div>
            {postStatus === 'error' && (
              <span className="text-[9px] text-orange-500/80 animate-pulse">※詳細はコンソールを確認してください</span>
            )}
          </div>
          <div
            ref={logContainerRef}
            className="bg-black/40 rounded-2xl p-4 space-y-2 border border-white/5 min-h-[200px] max-h-[800px] overflow-y-auto font-mono text-[11px] scrollbar-thin flex flex-col"
          >
            {postStatus === 'posting' && (
              <div className="flex gap-4 animate-pulse pb-2 mb-2 border-b border-white/5">
                <span className="text-white/10 shrink-0">Now</span>
                <span className="text-orange-500/80 font-bold italic">AIエージェントが次のアクションを準備中...</span>
              </div>
            )}
            {[...postLogs].reverse().map((log, i) => {
              const isLatest = i === 0;
              return (
                <div key={i} className={`flex gap-4 group animate-in slide-in-from-top-2 duration-300 ${isLatest ? 'bg-white/5 -mx-2 px-2 py-1 rounded-lg border-l-2 border-orange-500' : ''}`}>
                  <span className={`transition-colors whitespace-nowrap ${isLatest ? 'text-white/40' : 'text-white/10'}`}>{log.time}</span>
                  <span className={`
                    ${log.text.includes('[START]') ? 'text-orange-400 font-bold' : ''}
                    ${log.text.includes('[SUCCESS]') ? 'text-green-400 font-bold' : ''}
                    ${log.text.includes('[ERROR]') ? 'text-red-400' : isLatest ? 'text-white font-bold' : 'text-white/60'}
                  `}>
                    {log.text.replace(/\[.*\]\s*/, '')}
                  </span>
                </div>
              );
            })}
          </div>

          {errorScreenshot && (
            <div className="mt-4 animate-in fade-in zoom-in duration-500">
              <div className="flex items-center gap-2 mb-2 text-red-400">
                <AlertCircle size={14} />
                <span className="text-[10px] font-black uppercase tracking-widest">Failure Evidence (Mode 3 Diagnostic)</span>
              </div>
              <div className="rounded-2xl border border-red-500/20 overflow-hidden bg-black shadow-2xl">
                <img src={errorScreenshot} alt="Failure Screenshot" className="w-full h-auto opacity-80 hover:opacity-100 transition-opacity" />
              </div>
              <p className="mt-2 text-[9px] text-white/30 text-right italic">※サーバー上のブラウザが停止した瞬間のキャプチャです</p>
            </div>
          )}
        </div>

        {postStatus === 'success' && (
          <div className="px-6 py-4 bg-green-500/10 border-t border-green-500/20 flex items-center justify-center">
            <a
              href={notePostConsoleUrl || "#"}
              target="_blank"
              className="flex items-center gap-2 text-xs font-black text-green-400 hover:text-green-300 transition-colors"
            >
              作成された下書きURLを開く <ExternalLink size={14} />
            </a>
          </div>
        )}
      </div>
    );
  };

  // Note Credentials
  const [noteEmail, setNoteEmail] = useState("");
  const [notePassword, setNotePassword] = useState("");
  const [showPass, setShowPass] = useState(false);

  // Experimental Features (Title Burn-in defaults to true for better UX)
  const [isTitleFabMode, setIsTitleFabMode] = useState(true);

  // No longer auto-scrolling to bottom since newest is on top
  const logContainerRef = useRef<HTMLDivElement>(null);

  // Semi-Auto Magic Code Generator
  const generateMagicCode = () => {
    // Escaping for JS injection
    const escapedTitle = displayTitle.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
    const escapedBody = articleText.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$/g, '\\$');

    return `(async () => {
  console.log('%c🐾 note AI Agent: Magic Injector Starting...', 'color: #ff8c00; font-weight: bold; font-size: 14px;');
  
  const title = "${escapedTitle}";
  const body = \`${escapedBody}\`;
  
  function findEl(selectors) {
    for (let s of selectors) {
      const el = document.querySelector(s);
      if (el) return el;
    }
    return null;
  }

  const titleEl = findEl(['textarea[placeholder="記事タイトル"]', '.note-editor-title textarea']);
  const bodyEl = findEl(['div.ProseMirror[role="textbox"]', '.ProseMirror', '.note-editor-body']);

  if (!titleEl || !bodyEl) {
    alert('❌ noteのエディタ画面が見つかりません。新規記事作成画面（editor.note.com/...）を開いてから実行してください。');
    return;
  }

  // Inject Title
  titleEl.focus();
  document.execCommand('insertText', false, title);
  console.log('✅ Title injected.');

  await new Promise(r => setTimeout(r, 800));

  // Inject Body
  bodyEl.focus();
  document.execCommand('insertText', false, body);
  console.log('✅ Body injected.');

  alert('✨ 成功しました！パンダが記事の流し込みを完了しました。');
})();`;
  };

  // Helper: Canvas Image Composition (Client-side)
  // Helper: Canvas Image Composition (Client-side)
  // Returns DataURL of the merged image
  const getMergedImageDataUrl = async (imageUrl: string, title: string, type: 'eyecatch' | 'inline'): Promise<string | null> => {
    try {
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d");
      if (!ctx) return null;

      const img = new Image();
      img.crossOrigin = "anonymous";
      img.src = imageUrl;

      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = reject;
      });

      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      ctx.drawImage(img, 0, 0);

      if (type === 'eyecatch') {
        // Eyecatch Style: Bold Title Overlay (Bottom 1/3)
        // Background Gradient
        const grad = ctx.createLinearGradient(0, canvas.height * 0.66, 0, canvas.height);
        grad.addColorStop(0, "rgba(0,0,0,0)");
        grad.addColorStop(1, "rgba(0,0,0,0.92)");
        ctx.fillStyle = grad;
        ctx.fillRect(0, canvas.height * 0.66, canvas.width, canvas.height * 0.34);

        // Text Settings
        const fontSize = Math.floor(canvas.width * 0.05);
        ctx.font = `bold ${fontSize}px 'Hiragino Mincho ProN', 'Yu Mincho', serif`;
        ctx.fillStyle = "#ffffff";
        ctx.textAlign = "center";
        ctx.textBaseline = "bottom";
        ctx.shadowColor = "rgba(0,0,0,0.8)";
        ctx.shadowBlur = 15;

        // Word Wrap
        const maxWidth = canvas.width * 0.9;
        const words = title.split('');
        let line = '';
        let lines = [];
        for (let n = 0; n < words.length; n++) {
          const testLine = line + words[n];
          if (ctx.measureText(testLine).width > maxWidth && n > 0) {
            lines.push(line);
            line = words[n];
          } else { line = testLine; }
        }
        lines.push(line);

        // Draw
        let lineHeight = Math.floor(fontSize * 1.2);
        let startY = canvas.height - (canvas.height * 0.05) - ((lines.length - 1) * lineHeight);
        lines.forEach((l, i) => {
          ctx.fillText(l, canvas.width / 2, startY + (i * lineHeight));
        });
      } else {
        // Inline Image Logic
        const barHeight = canvas.height * 0.15;
        const startY = canvas.height - barHeight;
        ctx.fillStyle = "rgba(67, 20, 7, 0.9)";
        ctx.fillRect(0, startY, canvas.width, barHeight);
        ctx.fillStyle = "rgba(249, 115, 22, 0.4)";
        ctx.fillRect(0, startY, canvas.width, 4);
        ctx.font = "bold 60px sans-serif";
        ctx.fillStyle = "#ffedd5";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(title, canvas.width / 2, startY + (barHeight / 2));
      }

      return canvas.toDataURL('image/png');
    } catch (e) {
      console.error("Merge logic failed", e);
      return null;
    }
  };

  const saveMergedImage = async (imageUrl: string, title: string, type: 'eyecatch' | 'inline') => {
    const dataUrl = await getMergedImageDataUrl(imageUrl, title, type);
    if (!dataUrl) {
      alert("画像の合成保存に失敗しました。通常保存を試してください。");
      return;
    }
    const link = document.createElement('a');
    link.download = type === 'eyecatch' ? 'eyecatch_merged.png' : `${title}_merged.png`;
    link.href = dataUrl;
    link.click();
  };


  // --- Safety & Posting Logic (Dev Mode Only) ---
  const checkSafetyLock = (articleId: string): { safe: boolean, reason?: string } => {
    // 1. Check Mode
    if (appMode !== "development") return { safe: false, reason: "Production Mode Restriction" };
    // 2. Check Duplication
    if (postedArticles.has(articleId)) return { safe: false, reason: "Duplicate Post Prevention" };
    // 3. Check Status
    if (postStatus === "success" || postStatus === "posting") return { safe: false, reason: "Process Busy or Completed" };

    return { safe: true };
  };

  const [jobs, setJobs] = useState<NoteJob[]>([]);

  const handleDraftPost = async (isTest: boolean = false) => {
    if (!isTest && !articleText) {
      alert("記事が生成されていません");
      return;
    }

    // 記事ID（タイトルから生成）とリクエストID（重複防止キー）
    const articleId = displayTitle ? btoa(encodeURI(displayTitle)).substring(0, 12) : `art_${Date.now()}`;
    const requestId = `req_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;

    // Safety Check
    const safety = checkSafetyLock(articleId);
    if (!safety.safe) {
      setPostStatus("stopped");
      setPostLogs(prev => [...prev, { text: `[STOP] 安全装置作動: ${safety.reason}`, time: new Date().toLocaleTimeString('ja-JP', { hour12: false }) }]);
      return;
    }

    // Confirm only if not a test or if not in development mode (to avoid accidental production posts)
    if (!isTest && appMode === "production") {
      if (!confirm("noteへ実際に「下書き」保存を実行します。よろしいですか？")) return;
    }

    setPostStatus("posting");
    // Completely reset logs and storage for this new trial
    const startLog = { text: `[START] ${isTest ? 'テスト投稿' : '本番投稿'}を開始します`, time: new Date().toLocaleTimeString('ja-JP', { hour12: false }) };
    setPostLogs([startLog]);
    sessionStorage.setItem('note_post_logs', JSON.stringify([startLog]));
    sessionStorage.setItem('note_post_status', 'posting');
    sessionStorage.removeItem('note_post_url');
    setNotePostConsoleUrl("");

    setStartTime(Date.now());
    setElapsedTime("0:00");

    // ポーリング用のタイマー
    const pollInterval = setInterval(async () => {
      try {
        const res = await fetch("/api/dev/note-jobs");
        if (res.ok) {
          const jobsData = await res.json();
          setJobs(jobsData);

          // 最新の自分のジョブを探してログに追記
          const myJob = Array.isArray(jobsData) ? jobsData.find((j: any) => j.request_id === requestId) : null;
          if (myJob) {
            setPostLogs(prev => {
              const base = `${myJob.last_step || 'unknown'}`;
              if (!prev.find(p => p.text === base)) {
                return [...prev, { text: base, time: new Date().toLocaleTimeString('ja-JP', { hour12: false }) }];
              }
              return prev;
            });

            if (myJob.status === 'success' || myJob.status === 'failed') {
              clearInterval(pollInterval);
              setPostStatus(myJob.status === 'success' ? 'success' : 'error');
              if (myJob.status === 'success' && myJob.note_url) {
                setNotePostConsoleUrl(myJob.note_url);
              }
              if (myJob.error_screenshot) {
                setErrorScreenshot(myJob.error_screenshot);
              }
            }
          }
        }
      } catch (e) { console.error("Polling failed", e); }
    }, 2500);

    try {
      const res = await fetch("/api/dev/note-draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          article_id: articleId,
          request_id: requestId,
          title: isTest ? "【テスト】ダミータイトル" : displayTitle,
          body: isTest ? "これは自動投稿のフロー確認用ダミー本文です。" : articleText,
          tags: hashtags,
          mode: appMode,
          email: noteEmail,
          password: notePassword,
          isTest,
          visualDebug
        }),
      });

      if (!res.body) throw new Error("No response body");
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const data = JSON.parse(line);
            if (data.error) {
              setPostStatus("error");
              setPostLogs(prev => [...prev, { text: `[ERROR] ${data.error}`, time: new Date().toLocaleTimeString('ja-JP', { hour12: false }) }]);
              break;
            }

            if (data.last_step) {
              const base = data.last_step;
              setPostLogs(prev => {
                if (!prev.find(p => p.text === base)) {
                  return [...prev, { text: base, time: new Date().toLocaleTimeString('ja-JP', { hour12: false }) }];
                }
                return prev;
              });
            }

            if (data.status === 'success') {
              setPostStatus("success");
              if (data.note_url) setNotePostConsoleUrl(data.note_url);
            } else if (data.status === 'failed') {
              setPostStatus("error");
            }
          } catch (e) {
            console.error("Parse error in stream:", e);
          }
        }
      }
    } catch (e: any) {
      setPostStatus("error");
      const errorMsg = e instanceof Error ? e.message : String(e);
      setPostLogs(prev => [...prev, { text: `[ERROR] ${errorMsg}`, time: new Date().toLocaleTimeString('ja-JP', { hour12: false }) }]);
    } finally {
      clearInterval(pollInterval);
    }
  };

  useEffect(() => {
    const hideHelp = localStorage.getItem("hideHelp");
    if (!hideHelp) setShowHelp(true);

    // Load Note Credentials
    const savedEmail = localStorage.getItem("panda_note_email");
    const savedPass = localStorage.getItem("panda_note_pass");
    if (savedEmail) setNoteEmail(savedEmail);
    if (savedPass) setNotePassword(savedPass);
  }, []);

  const [devSettings, setDevSettings] = useState<any>(null);

  useEffect(() => {
    if (appMode === "development") {
      fetch(`/api/dev/settings?mode=development`)
        .then(res => res.json())
        .then(data => setDevSettings(data))
        .catch(err => console.error("Global settings fetch failed", err));
    }
  }, [appMode]);

  const toggleEmergencyStop = async () => {
    if (!devSettings) return;
    const nextState = !devSettings.AUTO_POST_ENABLED;
    const res = await fetch("/api/dev/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mode: "development",
        settings: { AUTO_POST_ENABLED: nextState }
      })
    });
    if (res.ok) {
      setDevSettings(await res.json());
      alert(`Emergency Stop: ${nextState ? 'OFF (Enabled)' : 'ON (Disabled)'}`);
    }
  };

  const saveToHistory = (item: Omit<HistoryItem, "id" | "timestamp">) => {
    const newItem: HistoryItem = {
      ...item,
      id: Math.random().toString(36).substring(7),
      timestamp: new Date().toLocaleString("ja-JP"),
    };

    try {
      // Optimize: Remove heavy reference image from history inputs to save space
      const safeInputs = { ...item.inputs };
      if (safeInputs.referenceImage && safeInputs.referenceImage.length > 500) {
        safeInputs.referenceImage = null;
      }
      const optimizedNewItem = { ...newItem, inputs: safeInputs };

      const saved = localStorage.getItem("panda_history");
      const history = saved ? JSON.parse(saved) : [];

      // Limit to last 20 items (increased from 10 since we are optimizing size)
      const updated = [optimizedNewItem, ...history].slice(0, 20);

      localStorage.setItem("panda_history", JSON.stringify(updated));
    } catch (e: any) {
      console.warn("History save warning:", e);

      // Smart cleanup on error
      try {
        const safeInputs = { ...item.inputs };
        if (safeInputs.referenceImage) safeInputs.referenceImage = null;
        const retryItem = { ...newItem, inputs: safeInputs };

        let saved = localStorage.getItem("panda_history");
        let history = saved ? JSON.parse(saved) : [];
        let savedSuccess = false;

        while (history.length > 0 && !savedSuccess) {
          history.pop(); // Remove oldest
          try {
            const retryUpdated = [retryItem, ...history];
            localStorage.setItem("panda_history", JSON.stringify(retryUpdated));
            savedSuccess = true;
          } catch (err) {
            // Continue cleanup
          }
        }

        if (!savedSuccess) {
          try {
            // Last resort: Save only the new one
            localStorage.setItem("panda_history", JSON.stringify([retryItem]));
          } catch (finalErr) {
            console.error("Critical: Storage full", finalErr);
          }
        }
      } catch (cleanupErr) {
        console.error("Cleanup logic failed", cleanupErr);
      }
    }
  };

  const restoreHistory = (item: HistoryItem) => {
    setInputs(item.inputs);
    setArticleText(item.articleText);
    setGeneratedImage(item.generatedImage);
    setInlineImages(item.inlineImages);
    setScore(item.score);
    setMetaDescription(item.metaDescription);
    setHashtags(item.hashtags || []);
    setDisplayTitle(item.displayTitle);
    setStatus("done");
    setActiveTab("result");
    setShowHistory(false);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const addLog = async (msg: string, delay: number) => {
    await new Promise(r => setTimeout(r, delay));
    setLogs(prev => [...prev, msg]);
  };

  const handleGenerate = async (data: any) => {
    setInputs(data);
    setStatus("outline");
    setLogs([]);
    setArticleText(""); // Critical: Reset text state
    setInlineHeading("");
    setInlineImages([]);
    setMetaDescription("");
    setHashtags([]);
    setIsGeneratingInlines(false);
    setGeneratedImage(null);
    setImagePrompt("");
    setEyecatchError(null);
    setInlineErrors([]);
    setDisplayTitle(""); // Reset title
    setTextModel("gemini-3-flash-preview"); // Text model name

    const run = async () => {
      setLogs(["ノウハウを整理しています..."]);
      setStatus("writing");

      try {
        const response = await fetch("/api/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...data, isRetry: data._isRetry }),
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          throw new Error(errorData.error || `Server Error: ${response.status}`);
        }

        setStatus("writing");
        await addLog("記事構成を作成しています...", 2000);

        const reader = response.body?.getReader();
        const decoder = new TextDecoder();
        let fullText = "";

        if (reader) {
          try {
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              const chunk = decoder.decode(value, { stream: true });
              fullText += chunk;

              // Filter out the plan if the separator is present
              if (fullText.includes("---CONTENT_START---")) {
                const parts = fullText.split("---CONTENT_START---");
                setArticleText(parts[1]?.trim() || "");
              } else {
                setArticleText(fullText);
              }
            }
          } catch (e) {
            console.error("Stream reader error:", e);
            await addLog("【警告】通信が不安定です。可能な限り続行します...", 1000);
          }
        }

        await addLog("執筆が完了しました。品質をチェックしています...", 1000);

        // --- Extract Final Article Body ---
        let finalArticle = fullText;
        if (fullText.includes("---CONTENT_START---")) {
          finalArticle = fullText.split("---CONTENT_START---")[1]?.trim() || fullText;
        }

        // --- Length Check & Retry (Using filtered article text) ---
        const charCount = finalArticle.length;
        const minTarget = (data.targetLength || 5000) * 0.3; // 30% threshold for very long content
        if (charCount < minTarget) {
          if (!data._isRetry) {
            await addLog(`【重要】文字数が目標に届きませんでした (${charCount}字)。内容を詳細に膨らませて再プロデュースしています...`, 2000);
            handleGenerate({ ...data, _isRetry: true });
            return;
          } else {
            await addLog(`目標文字数に近づける努力をしました。最終的に ${charCount}文字 で納得のいく仕上がりになりました。`, 1000);
          }
        }

        // Extract title and Meta Description (Scan from finalArticle only)
        const titleMatch = finalArticle.match(/^#\s+(.+)$/m);
        const extractedTitle = titleMatch ? titleMatch[1].trim() : data.topic;
        setDisplayTitle(extractedTitle);

        // Simple extraction for meta description
        const paragraphs = finalArticle.split("\n\n")
          .filter(p => !p.startsWith("#"))
          .filter(p => !p.includes("レッサーパンダ") && !p.includes("サポートするよ")); // Filter out persona greetings
        const firstMeaningfulParam = paragraphs.find(p => p.length > 50) || "";
        setMetaDescription(firstMeaningfulParam.substring(0, 120) + "...");

        // Extract hashtags
        const tagMatch = finalArticle.match(/【おすすめのハッシュタグ】(.+)$/m) || fullText.match(/【おすすめのハッシュタグ】(.+)$/m);
        let currentHashtags: string[] = [];
        if (tagMatch) {
          currentHashtags = tagMatch[1].trim().split(/\s+/).filter(t => t.startsWith("#") || t.length > 0).map(t => t.startsWith("#") ? t : `#${t}`);
          setHashtags(currentHashtags);
        }

        const finalScore = calculateArticleScore(finalArticle, data.targetLength || 5000);
        setScore(finalScore);

        let finalImgUrl: string | null = null;
        let finalInlineUrl: string | null = null;
        let headingText = "この記事のポイント";

        setStatus("image_prompt");
        // --- 1. Header Image ---
        await addLog("アイキャッチ画像を生成中...", 1000);
        try {
          const imgRes = await fetch("/api/generate-image", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              title: extractedTitle,
              articleText: fullText.substring(0, 1000), // Focus on intro
              visualStyle: data.visualStyle,
              character: data.character,
              referenceImage: data.referenceImage
            }),
          });
          const imgData = await imgRes.json();
          if (imgRes.ok && imgData.imageUrl) {
            let finalImg = imgData.imageUrl;
            if (isTitleFabMode) {
              await addLog("タイトルを画像に焼き込んでいます...", 500);
              const merged = await getMergedImageDataUrl(imgData.imageUrl, extractedTitle, 'eyecatch');
              if (merged) finalImg = merged;
            }
            finalImgUrl = finalImg;
            setGeneratedImage(finalImg);
            setEyecatchError(null);
            if (imgData.generatedPrompt) setImagePrompt(imgData.generatedPrompt);
            if (imgData.model) setImageModel(imgData.model);
          } else {
            const errMsg = imgData.error || "アイキャッチの生成に失敗しました";
            setEyecatchError(errMsg);
            await addLog(`アイキャッチ生成エラー: ${errMsg}`, 2000);
          }
        } catch (e) {
          setEyecatchError("通信エラーが発生しました");
          console.error("Header image failed", e);
        }

        // --- 2. Initial Inline Image (First one) ---
        await addLog("記事内画像を生成中...", 1000);
        try {
          const firstHeadingMatch = fullText.match(/##\s+(.+)/);
          headingText = firstHeadingMatch ? firstHeadingMatch[1] : "この記事のポイント";
          setInlineHeading(headingText);

          const imgRes = await fetch("/api/generate-image", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              title: headingText,
              articleText: "Demonstration of: " + headingText,
              visualStyle: data.visualStyle,
              character: data.character,
              referenceImage: data.referenceImage,
              promptOverride: `High quality ${data.visualStyle} illustration of ${data.character === '指定なし' ? 'a cozy object' : data.character} representing "${headingText}", clear details, professional composition, textless background.`
            }),
          });
          const imgData = await imgRes.json();
          if (imgRes.ok && imgData.imageUrl) {
            finalInlineUrl = imgData.imageUrl;
            setInlineImage(imgData.imageUrl);
            setInlineImages([{ heading: headingText, url: imgData.imageUrl }]);
            setInlineErrors(prev => prev.filter(err => err.heading !== headingText));
          } else {
            const errMsg = imgData.error || "記事内画像の生成に失敗しました";
            setInlineErrors(prev => [...prev, { heading: headingText, error: errMsg }]);
          }
        } catch (e) {
          setInlineErrors(prev => [...prev, { heading: headingText, error: "通信エラーが発生しました" }]);
          console.error("Inline image failed", e);
        }

        const finalMeta = paragraphs.find(p => p.length > 50)?.substring(0, 120) + "..." || "";

        saveToHistory({
          displayTitle: extractedTitle,
          articleText: finalArticle,
          generatedImage: finalImgUrl,
          inlineImages: finalInlineUrl ? [{ heading: headingText, url: finalInlineUrl }] : [],
          score: finalScore,
          metaDescription: finalMeta,
          hashtags: currentHashtags,
          inputs: data
        });

        setStatus("done");
        window.scrollTo({ top: 0, behavior: "smooth" });
        await addLog("カンペキです！", 500);

      } catch (e) {
        console.error(e);
        const err = e as Error;
        setStatus("error");
        setLogs(prev => [...prev, `エラー: ${err.message}`]);
      }
    };

    run();
  };


  const handleGenerateAllInlineImages = async () => {
    const headings = Array.from(articleText.matchAll(/##\s+(.+)/g)).map(m => m[1]);
    if (headings.length === 0) return;

    const count = headings.length;
    if (!confirm(`全${count}箇所の見出しに合わせて、${count}枚の画像を生成します。よろしいですか？\n※生成完了まで少し時間がかかります。`)) return;

    setIsGeneratingInlines(true);
    const results: { heading: string, url: string }[] = [...inlineImages];

    for (const heading of headings) {
      if (results.find(r => r.heading === heading)) continue; // Skip already generated

      try {
        const imgRes = await fetch("/api/generate-image", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: heading,
            articleText: "Concept: " + heading,
            visualStyle: inputs.visualStyle,
            character: inputs.character,
            referenceImage: inputs.referenceImage,
            promptOverride: `High quality ${inputs.visualStyle} illustration of ${inputs.character === '指定なし' ? 'a relevant object' : inputs.character} representing the concept of "${heading}", artistic and detailed, textless background.`
          }),
        });
        const imgData = await imgRes.json();
        if (imgRes.ok && imgData.imageUrl) {
          results.push({ heading, url: imgData.imageUrl });
          setInlineImages([...results]); // Update incrementally
          setInlineErrors(prev => prev.filter(e => e.heading !== heading));
        } else {
          const errMsg = imgData.error || "生成失敗";
          setInlineErrors(prev => [...prev, { heading, error: errMsg }]);
        }
      } catch (e) {
        console.error(`Failed to generate image for ${heading}`, e);
        setInlineErrors(prev => [...prev, { heading, error: "通信エラー" }]);
      }
    }
    setIsGeneratingInlines(false);
  };

  const handleRetryInline = async (heading: string) => {
    try {
      const imgRes = await fetch("/api/generate-image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: heading,
          articleText: "Regenerating focused content for: " + heading,
          visualStyle: inputs.visualStyle,
          character: inputs.character,
          referenceImage: inputs.referenceImage,
          promptOverride: `High quality ${inputs.visualStyle} illustration of ${inputs.character === '指定なし' ? 'a relevant object' : inputs.character} representing the concept of "${heading}", textless, centered composition.`
        }),
      });
      const imgData = await imgRes.json();
      if (imgRes.ok && imgData.imageUrl) {
        const newImages = inlineImages.map((img: { heading: string, url: string }) =>
          img.heading === heading ? { ...img, url: imgData.imageUrl } : img
        );
        if (!newImages.find((img: { heading: string, url: string }) => img.heading === heading)) {
          newImages.push({ heading, url: imgData.imageUrl });
        }
        setInlineImages(newImages);
        setInlineErrors(prev => prev.filter(e => e.heading !== heading));

        // Sync with history if needed
        saveToHistory({
          displayTitle,
          articleText,
          generatedImage,
          inlineImages: newImages,
          score,
          metaDescription,
          hashtags,
          inputs
        });
      } else {
        alert("画像の再生成に失敗しました: " + (imgData.error || "不明なエラー"));
      }
    } catch (e) {
      alert("通信エラーが発生しました");
    }
  };

  const handleRetryEyecatch = async () => {
    if (!inputs || !displayTitle) return;
    setEyecatchError(null);
    setLogs(prev => [...prev, "アイキャッチを再試行中..."]);

    try {
      const imgRes = await fetch("/api/generate-image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: displayTitle,
          articleText: articleText.substring(0, 1000),
          visualStyle: inputs.visualStyle,
          character: inputs.character,
          referenceImage: inputs.referenceImage
        }),
      });
      const imgData = await imgRes.json();
      if (imgRes.ok && imgData.imageUrl) {
        let finalImg = imgData.imageUrl;
        if (isTitleFabMode) {
          const merged = await getMergedImageDataUrl(imgData.imageUrl, displayTitle, 'eyecatch');
          if (merged) finalImg = merged;
        }
        setGeneratedImage(finalImg);
        if (imgData.model) setImageModel(imgData.model);
      } else {
        setEyecatchError(imgData.error || "再試行に失敗しました");
      }
    } catch (e) {
      setEyecatchError("通信エラーが発生しました");
    }
  };

  const copyToClipboard = () => {
    navigator.clipboard.writeText(articleText);
    alert("コピーしました");
  };

  return (
    <div className="min-h-screen pb-20 pt-20 px-4 md:px-8 max-w-2xl mx-auto">
      <Header appMode={appMode} setAppMode={setAppMode} />
      {showHelp && <HelpModal onClose={() => setShowHelp(false)} />}
      {showHistory && <HistoryList onRestore={restoreHistory} onClose={() => setShowHistory(false)} />}

      {status === "idle" && (
        <div className="animate-in fade-in slide-in-from-top-12 duration-1000">
          <div className="mb-12 text-center">
            <div className="inline-block px-4 py-1.5 bg-orange-500/10 border border-orange-500/20 rounded-full text-[10px] text-orange-400 font-black mb-6 tracking-[0.3em] uppercase animate-pulse">
              Red Panda AI Assistant
            </div>
            <h1 className="text-5xl md:text-7xl font-black text-white mb-6 tracking-tighter leading-none px-4">
              思考を <span className="text-transparent bg-clip-text bg-gradient-to-r from-orange-400 to-red-500 drop-shadow-sm">一瞬</span> で価値に
            </h1>

            {/* Mode Warning Banner */}
            {appMode === "development" && (
              <div className="max-w-md mx-auto mb-6 bg-red-500/10 border border-red-500/40 rounded-2xl p-4 flex flex-col items-center gap-2 animate-pulse shadow-lg shadow-red-500/10">
                <div className="flex items-center gap-3">
                  <AlertTriangle size={20} className="text-red-500" />
                  <span className="text-red-400 font-black text-sm uppercase tracking-widest">Development Mode 2 ACTIVE</span>
                </div>
                <p className="text-[10px] text-red-300/60 font-medium">注意：Playwrightによる「リアル実投稿」が許可されています</p>
              </div>
            )}

            <p className="text-base md:text-xl text-gray-400 max-w-xl mx-auto leading-relaxed font-serif italic px-6">
              "君のやることは、ノウハウや書きたいことの指示だけ。<br className="hidden md:block" />
              あとの構成・執筆・画像生成は僕が全部プロデュースするよ！"
            </p>
            <div className="mt-8">
              <button
                onClick={() => setShowHistory(true)}
                className="flex items-center gap-2 mx-auto px-6 py-2 bg-white/5 border border-white/10 rounded-full text-xs font-bold text-white/60 hover:text-white hover:bg-white/10 transition-all"
              >
                <RotateCcw size={14} /> 過去の履歴を見る
              </button>
            </div>
          </div>

          <h2 className="text-xl font-bold mb-4 text-white/70 flex items-center gap-2">
            <span className="text-orange-500">🐾</span> パンダ執筆 3 Step
          </h2>
          <StepCards onStart={() => setStatus("outline")} />

          <BrandFooter />
        </div>
      )}

      {status === "outline" && (
        <>
          <div className="flex items-center justify-between mb-6">
            <button onClick={() => setStatus("idle")} className="p-2 text-white/40 hover:text-white">
              <X size={24} />
            </button>
            <button
              onClick={() => setShowHistory(true)}
              className="flex items-center gap-2 px-4 py-1.5 bg-white/5 border border-white/10 rounded-full text-[10px] font-bold text-white/60 hover:text-white transition-all uppercase tracking-widest"
            >
              History
            </button>
          </div>
          <InputForm onSubmit={handleGenerate} isGenerating={false} />
          <BrandFooter />
        </>
      )}

      {(status === "writing" || status === "polish" || status === "scoring" || status === "image_prompt") && (
        <div className="space-y-6">
          <ProgressLog logs={logs} />

          <div className="glass-card p-4 rounded-[20px] bg-black/40 border border-white/10 animate-in fade-in slide-in-from-bottom-4 duration-700">
            <div className="flex items-center justify-between mb-3 border-b border-white/5 pb-2">
              <div className="flex gap-1.5">
                <div className="w-2.5 h-2.5 rounded-full bg-orange-500/30"></div>
                <div className="w-2.5 h-2.5 rounded-full bg-red-500/30"></div>
                <div className="w-2.5 h-2.5 rounded-full bg-yellow-500/30"></div>
              </div>
              <span className="text-xs font-mono text-orange-400/50 ml-2 italic">PANDA_WRITING_SESSION.md</span>
              <div className="flex items-center gap-3">
                <div className="text-xs font-mono text-white/50">
                  {articleText.length.toLocaleString()} / {(inputs?.targetLength || 5000).toLocaleString()} chars
                </div>
              </div>
            </div>
            <div className="h-48 overflow-y-auto font-mono text-xs md:text-sm text-gray-300 leading-relaxed scrollbar-hide bg-orange-900/10 p-4 rounded-xl border border-orange-500/10">
              <pre className="whitespace-pre-wrap font-sans leading-relaxed">
                {articleText || <span className="animate-pulse text-orange-500">レッサーパンダが思考を文章に変換中...</span>}
                <span className="inline-block w-2 h-4 bg-orange-500 ml-1 animate-pulse align-middle"></span>
              </pre>
            </div>
          </div>
          <BrandFooter />
        </div>
      )}

      {status === "error" && (
        <div className="glass-card p-10 rounded-[32px] border border-red-500/30 text-center space-y-6">
          <div className="w-20 h-20 rounded-full bg-red-500/10 flex items-center justify-center mx-auto border border-red-500/20">
            <AlertCircle size={40} className="text-red-500" />
          </div>
          <div className="space-y-2">
            <h2 className="text-2xl font-black text-white">エラーが発生しました</h2>
            <p className="text-sm text-gray-400">プロデュース中に予期せぬトラブルが発生したようです。</p>
          </div>
          <div className="p-4 bg-black/40 rounded-xl border border-red-900/20 font-mono text-xs text-red-400 text-left overflow-x-auto">
            {logs[logs.length - 1]}
          </div>
          <button
            onClick={() => setStatus("outline")}
            className="px-8 py-3 rounded-full bg-white text-black font-black hover:bg-gray-200 transition-all"
          >
            前の画面に戻る
          </button>
        </div>
      )}

      {status === "done" && (
        <div className="animate-in fade-in slide-in-from-bottom-8 duration-700 space-y-6 md:space-y-8">
          <button
            onClick={copyToClipboard}
            className="w-full py-4 md:py-5 rounded-2xl bg-gradient-to-r from-orange-500 to-red-600 text-white font-black flex items-center justify-center gap-3 shadow-2xl hover:scale-[1.02] active:scale-95 transition-all text-sm md:text-base"
          >
            <Copy size={18} /> 完成原稿をコピー！
          </button>

          {/* Dev Mode 2: Enhanced Management UI */}
          {appMode === "development" && (
            <div className="space-y-6">
              <div className="glass-card bg-neutral-900/40 border border-white/5 rounded-[32px] p-8 space-y-8 animate-in fade-in slide-in-from-bottom-8 duration-700">
                <div className="flex items-center justify-between border-b border-white/5 pb-6">
                  <div className="flex items-center gap-4">
                    <div className="bg-orange-500/10 p-3 rounded-2xl">
                      <Zap size={24} className="text-orange-500" />
                    </div>
                    <div>
                      <h3 className="text-xl font-black text-white">Advanced Post Protocol v2.0</h3>
                      <p className="text-xs text-white/40 font-mono tracking-widest">STATUS: SYSTEM_READY // AUTH: REQUIRED</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    {devSettings && (
                      <button
                        onClick={toggleEmergencyStop}
                        className={cn(
                          "px-4 py-1.5 rounded-full text-[10px] font-black uppercase tracking-widest border transition-all",
                          devSettings.AUTO_POST_ENABLED
                            ? "bg-green-500/10 border-green-500/20 text-green-400 hover:bg-red-500/20 hover:border-red-500/30 hover:text-red-400"
                            : "bg-red-500/40 border-red-500/60 text-white animate-pulse"
                        )}
                      >
                        {devSettings.AUTO_POST_ENABLED ? "System Active (Click to Stop)" : "EMERGENCY STOPPED"}
                      </button>
                    )}
                    <div className="px-4 py-1.5 bg-neutral-800 border border-white/5 rounded-full text-[10px] text-white/40 font-black uppercase tracking-widest">
                      Protocol v2.0
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                  {/* Magic Injector (The Reliable One) */}
                  <div className="space-y-4">
                    <div className="flex items-center gap-2 mb-2">
                      <Sparkles size={16} className="text-orange-400" />
                      <h4 className="text-sm font-black text-white uppercase">Development Mode 1: Semi-Auto</h4>
                    </div>
                    <p className="text-xs text-gray-400 leading-relaxed">
                      ブラウザ上で動作するJavaScriptを生成します。ボット検知を100%回避する最も安全な方法です。
                    </p>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        onClick={() => {
                          const script = generateMagicCode();
                          navigator.clipboard.writeText(script);
                          alert("✨ Code Copied!");
                        }}
                        className="py-3 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl text-[10px] font-black text-white transition-all scale-active"
                      >
                        COPY CODE
                      </button>
                      <button
                        onClick={() => {
                          const script = generateMagicCode();
                          const bml = `javascript:${encodeURIComponent(script)}`;
                          navigator.clipboard.writeText(bml);
                          alert("🔖 Bookmarklet Copied!");
                        }}
                        className="py-3 bg-orange-500 hover:bg-orange-600 rounded-xl text-[10px] font-black text-white transition-all shadow-lg scale-active"
                      >
                        BOOKMARKLET
                      </button>
                    </div>
                  </div>

                  {/* Playwright Headless (The Advanced One) */}
                  <div className="space-y-4">
                    <div className="flex items-center gap-2 mb-2">
                      <Terminal size={16} className="text-purple-400" />
                      <h4 className="text-sm font-black text-white uppercase">Development Mode 2: Full-Auto</h4>
                    </div>
                    <div className="space-y-2">
                      <input
                        type="email"
                        placeholder="Note ID (Email)"
                        value={noteEmail}
                        onChange={e => setNoteEmail(e.target.value)}
                        className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-2 text-xs text-white focus:outline-none focus:border-orange-500/50"
                      />
                      <div className="relative">
                        <input
                          type={showPass ? "text" : "password"}
                          placeholder="Password"
                          value={notePassword}
                          onChange={e => setNotePassword(e.target.value)}
                          className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-2 text-xs text-white focus:outline-none focus:border-orange-500/50 pr-10"
                        />
                        <button onClick={() => setShowPass(!showPass)} className="absolute right-3 top-1/2 -translate-y-1/2 text-white/30 hover:text-white">
                          {showPass ? <Eye size={14} /> : <Eye size={14} className="opacity-40" />}
                        </button>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 px-2 py-1">
                      <input
                        type="checkbox"
                        id="mode3-toggle"
                        checked={visualDebug}
                        onChange={(e) => setVisualDebug(e.target.checked)}
                        className="w-3 h-3 rounded border-white/10 bg-black/40 text-orange-500 focus:ring-orange-500/50"
                      />
                      <label htmlFor="mode3-toggle" className="text-[10px] font-bold text-white/40 cursor-pointer hover:text-white/60 transition-colors">
                        開発モード3: 物理オート・デバッグ起動 (Localのみ)
                      </label>
                    </div>

                    <button
                      onClick={() => handleDraftPost(false)}
                      className="w-full py-4 bg-gradient-to-r from-orange-400 to-red-500 hover:from-orange-500 hover:to-red-600 rounded-2xl text-xs font-black text-white transition-all shadow-xl shadow-orange-500/10 scale-active"
                    >
                      EXECUTE AUTOMATION
                    </button>
                  </div>
                </div>

                {/* Job Console Area */}
                <NotePostConsole />

                <div className="pt-6 border-t border-white/5">
                  <div className="flex items-center justify-between mb-6">
                    <div className="flex items-center gap-3">
                      <BarChart3 size={18} className="text-white/40" />
                      <h4 className="text-sm font-black text-white uppercase tracking-widest">Recent Activity Logs</h4>
                    </div>
                    <button
                      onClick={async () => {
                        const res = await fetch("/api/dev/note-jobs?mode=development");
                        if (res.ok) setJobs(await res.json());
                      }}
                      className="text-[10px] font-bold text-orange-400 hover:text-orange-300 flex items-center gap-1 transition-colors"
                    >
                      <RotateCcw size={12} /> REFRESH LIST
                    </button>
                  </div>

                  <div className="overflow-x-auto rounded-2xl border border-white/5 bg-black/20">
                    <table className="w-full text-left text-[10px] font-mono">
                      <thead>
                        <tr className="bg-white/5 text-white/40 uppercase tracking-widest border-b border-white/5">
                          <th className="px-4 py-3">Timestamp</th>
                          <th className="px-4 py-3">Status</th>
                          <th className="px-4 py-3">Last Step</th>
                          <th className="px-4 py-3">Action</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-white/5">
                        {jobs.length === 0 ? (
                          <tr><td colSpan={4} className="px-4 py-8 text-center text-white/20 italic">No job logs found in current mode.</td></tr>
                        ) : (
                          jobs.slice(0, 10).map((job) => (
                            <tr key={job.job_id} className="hover:bg-white/5 transition-colors group">
                              <td className="px-4 py-3 text-white/40">{new Date(job.created_at).toLocaleTimeString()}</td>
                              <td className="px-4 py-3">
                                <span className={cn(
                                  "px-2 py-0.5 rounded-full font-bold uppercase",
                                  job.status === 'success' ? "bg-green-500/20 text-green-400" :
                                    job.status === 'failed' ? "bg-red-500/20 text-red-400" : "bg-orange-500/20 text-orange-400 animate-pulse"
                                )}>
                                  {job.status}
                                </span>
                              </td>
                              <td className="px-4 py-3 text-white/60 truncate max-w-[150px]">{job.last_step}</td>
                              <td className="px-4 py-3">
                                {job.note_url ? (
                                  <a href={job.note_url} target="_blank" className="text-blue-400 hover:underline flex items-center gap-1">
                                    OPEN <ExternalLink size={10} />
                                  </a>
                                ) : job.status === 'failed' ? (
                                  <span className="text-white/20">--</span>
                                ) : (
                                  <span className="text-white/20 italic">Pending...</span>
                                )}
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            </div>
          )}

          <div className="flex bg-white/5 p-1 rounded-2xl backdrop-blur-xl border border-white/10 overflow-x-auto">
            <button
              onClick={() => setActiveTab("result")}
              className={cn("flex-1 whitespace-nowrap flex items-center justify-center gap-2 py-3 px-2 rounded-xl font-bold transition-all text-[10px] md:text-xs", activeTab === "result" ? "bg-white text-orange-600 shadow-xl" : "text-white/40 hover:text-white")}
            >
              <Sparkles size={14} /> 生成結果
            </button>
            <button
              onClick={() => setActiveTab("preview")}
              className={cn("flex-1 whitespace-nowrap flex items-center justify-center gap-2 py-3 px-2 rounded-xl font-bold transition-all text-[10px] md:text-xs", activeTab === "preview" ? "bg-white text-orange-600 shadow-xl" : "text-white/40 hover:text-white")}
            >
              <Eye size={14} /> スマホ風プレビュー
            </button>
            <button
              onClick={() => setActiveTab("score")}
              className={cn("flex-1 whitespace-nowrap flex items-center justify-center gap-2 py-3 px-2 rounded-xl font-bold transition-all text-[10px] md:text-xs", activeTab === "score" ? "bg-white text-orange-600 shadow-xl" : "text-white/40 hover:text-white")}
            >
              <BarChart3 size={14} /> 品質スコア
            </button>
          </div>

          <div className="max-w-4xl mx-auto">
            {activeTab === "result" && (
              <div className="space-y-8 pb-10">
                <div className="space-y-4">
                  <div className="flex justify-between items-end">
                    <h3 className="text-xl font-bold text-white/80">アイキャッチ画像</h3>
                    <div className="flex gap-2">
                      {eyecatchError && (
                        <button onClick={handleRetryEyecatch} className="flex items-center gap-2 px-4 py-2 bg-red-500/20 border border-red-500/50 rounded-xl text-xs font-bold text-red-400 hover:bg-red-500/30 transition-all">
                          <RotateCcw size={14} /> 再試行
                        </button>
                      )}

                      {isTitleFabMode ? (
                        <button
                          onClick={() => generatedImage && saveMergedImage(generatedImage, displayTitle, 'eyecatch')}
                          className="flex items-center gap-2 px-4 py-2 bg-purple-600 rounded-xl text-xs font-bold text-white hover:bg-purple-700 transition-all shadow-lg ring-2 ring-purple-400/50"
                        >
                          <Download size={14} /> 合成保存(Beta)
                        </button>
                      ) : (
                        <a href={generatedImage || "#"} download="eyecatch.png" className={cn("flex items-center gap-2 px-4 py-2 bg-orange-500 rounded-xl text-xs font-bold text-white hover:bg-orange-600 transition-all shadow-lg", !generatedImage && "opacity-50 pointer-events-none")}>
                          <Download size={14} /> 保存
                        </a>
                      )}
                    </div>
                  </div>

                  {/* Dev Mode Toggle */}
                  <div className="flex justify-end mt-2">
                    <label className="flex items-center gap-2 text-xs text-gray-400 cursor-pointer hover:text-white transition-colors bg-white/5 px-3 py-1 rounded-full border border-white/5">
                      <input type="checkbox" checked={isTitleFabMode} onChange={e => setIsTitleFabMode(e.target.checked)} className="rounded border-gray-600 text-orange-500 focus:ring-orange-500" />
                      <span>🛠️ タイトル焼き込みモード (Beta)</span>
                    </label>
                  </div>

                  {eyecatchError && (
                    <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-2xl text-red-400 text-sm flex items-center gap-3">
                      <AlertCircle size={18} />
                      <div className="flex-1">
                        <p className="font-bold">生成に失敗しました</p>
                        <p className="text-xs opacity-70">{eyecatchError}</p>
                      </div>
                    </div>
                  )}

                  {generatedImage && (
                    <div className="space-y-4">
                      <div className="glass-card p-2 rounded-[24px] overflow-hidden border border-orange-500/20">
                        <div className="relative aspect-video w-full rounded-[20px] overflow-hidden">
                          <img src={generatedImage} alt="Generated Header" className="w-full h-full object-cover" />
                          {inputs?.showEyecatchTitle !== false && !isTitleFabMode && (
                            <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent flex flex-col justify-end items-center pb-6 md:pb-10 px-4 md:px-8 text-center group">
                              <div className="absolute top-4 right-4 opacity-0 group-hover:opacity-100 transition-opacity z-20">
                                <button onClick={handleRetryEyecatch} className="p-2 bg-black/60 hover:bg-black/80 text-white rounded-full backdrop-blur-sm transition-all" title="この画像を再作成">
                                  <RotateCcw size={18} />
                                </button>
                              </div>
                              <h1 className="text-lg md:text-3xl font-serif font-black text-white leading-[1.3] tracking-tighter drop-shadow-2xl">
                                {displayTitle}
                              </h1>
                            </div>
                          )}
                          {/* If burn-in is ON, only show retry button to keep UI clean */}
                          {isTitleFabMode && (
                            <div className="absolute top-4 right-4 opacity-0 group-hover:opacity-100 transition-opacity z-20">
                              <button onClick={handleRetryEyecatch} className="p-2 bg-black/60 hover:bg-black/80 text-white rounded-full backdrop-blur-sm transition-all" title="この画像を再作成">
                                <RotateCcw size={18} />
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                      {inputs?.showEyecatchTitle === false && (
                        <div className="px-6 py-4 border-l-4 border-orange-500 bg-white/5 rounded-r-xl">
                          <h2 className="text-xl md:text-2xl font-serif font-black text-white leading-relaxed">
                            {displayTitle}
                          </h2>
                        </div>
                      )}
                    </div>
                  )}

                  {!generatedImage && !eyecatchError && (
                    <div className="aspect-video w-full rounded-[24px] bg-white/5 border border-dashed border-white/10 flex items-center justify-center animate-pulse">
                      <p className="text-white/20 italic">画像を生成中...</p>
                    </div>
                  )}
                </div>

                <div className="space-y-4">
                  <div className="flex justify-between items-end">
                    <h3 className="text-xl font-bold text-white/80">記事原稿</h3>
                    <button onClick={copyToClipboard} className="flex items-center gap-2 px-4 py-2 bg-white/5 border border-white/10 rounded-xl text-xs font-bold text-white hover:bg-white/10 transition-all">
                      <Copy size={14} /> 本文をコピー
                    </button>
                  </div>
                  <div className="glass-card p-6 rounded-[24px] bg-black/40 border border-white/5 max-h-96 overflow-y-auto scrollbar-hide">
                    <pre className="whitespace-pre-wrap font-sans text-sm text-gray-300 leading-relaxed">
                      {articleText}
                    </pre>
                  </div>
                </div>

                <div className="space-y-4">
                  <div className="flex justify-between items-end">
                    <h3 className="text-xl font-bold text-white/80">記事内画像（解説図）</h3>
                    {inlineImages.length === 1 && !isGeneratingInlines && (
                      <button
                        onClick={handleGenerateAllInlineImages}
                        className="flex items-center gap-2 px-4 py-2 bg-white/5 border border-white/10 rounded-xl text-xs font-bold text-orange-400 hover:bg-white/10 transition-all"
                      >
                        <ImagePlus size={14} /> 全ての章の画像を生成
                      </button>
                    )}
                  </div>

                  {isGeneratingInlines && (
                    <div className="p-8 glass-card rounded-[24px] border border-orange-500/20 text-center space-y-4 animate-pulse">
                      <div className="w-10 h-10 border-4 border-orange-500 border-t-transparent rounded-full animate-spin mx-auto"></div>
                      <p className="text-orange-200 text-sm font-bold">全{articleText.match(/##/g)?.length || 0}枚の画像を生成中... ({inlineImages.length}枚完了)</p>
                    </div>
                  )}

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {inlineImages.map((img, i) => (
                      <div key={i} className="group glass-card p-2 rounded-[24px] overflow-hidden border border-orange-500/20 relative">
                        <div className="relative aspect-video w-full rounded-[20px] overflow-hidden bg-black/40">
                          <img src={img.url} alt={img.heading} className="w-full h-full object-contain" />
                          <div className="absolute bottom-0 inset-x-0 bg-orange-950/80 py-3 px-4 backdrop-blur-sm border-t border-orange-500/30">
                            <p className="text-center text-orange-100 text-[10px] font-bold truncate">{img.heading}</p>
                          </div>
                          {/* Individual Retry Button */}
                          <button
                            onClick={() => handleRetryInline(img.heading)}
                            className="absolute top-2 right-2 p-2 bg-black/60 hover:bg-orange-500 rounded-full text-white opacity-0 group-hover:opacity-100 transition-all shadow-lg border border-white/20"
                            title="この画像だけ再生成"
                          >
                            <RotateCcw size={12} />
                          </button>
                        </div>
                        {isTitleFabMode ? (
                          <button
                            onClick={() => saveMergedImage(img.url, img.heading, 'inline')}
                            className="block w-full py-2 bg-purple-600/20 hover:bg-purple-600/40 rounded-lg text-center text-[10px] text-purple-200 font-bold transition-all mt-2 border border-purple-500/30"
                          >
                            ⚡️ タイトル合成保存
                          </button>
                        ) : (
                          <a href={img.url} download={`inline-${i}.png`} className="block w-full py-2 bg-white/5 hover:bg-white/10 rounded-lg text-center text-[10px] text-white/60 font-bold transition-all mt-2">
                            画像を保存
                          </a>
                        )}
                      </div>
                    ))}
                    {inlineErrors.map((err, i) => (
                      <div key={`err-${i}`} className="glass-card p-4 rounded-[24px] border border-red-500/20 bg-red-500/5 flex flex-col items-center justify-center text-center space-y-3 min-h-[160px]">
                        <AlertCircle className="text-red-500" size={24} />
                        <div>
                          <p className="text-xs font-bold text-red-400 line-clamp-1">{err.heading}</p>
                          <p className="text-[10px] text-red-400/60 uppercase">生成エラー</p>
                        </div>
                        <button
                          onClick={() => handleRetryInline(err.heading)}
                          className="px-4 py-1.5 bg-red-500 text-white rounded-full text-[10px] font-bold hover:bg-red-600 transition-all flex items-center gap-2"
                        >
                          <RotateCcw size={12} /> 再試行
                        </button>
                      </div>
                    ))}
                  </div>

                  {inlineImages.length === 0 && !isGeneratingInlines && (
                    <div className="h-40 glass-card rounded-[24px] flex items-center justify-center text-white/20 text-sm italic">
                      思考の視覚化をスキップしました
                    </div>
                  )}
                </div>

                <div className="space-y-4">
                  <div className="flex justify-between items-center">
                    <h3 className="text-sm font-bold text-white/90">メタディスクリプション</h3>
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(metaDescription);
                        alert("メタディスクリプションをコピーしました");
                      }}
                      className="px-4 py-1.5 bg-white/10 hover:bg-white/20 rounded-lg text-[10px] font-bold text-white transition-all border border-white/10"
                    >
                      コピー
                    </button>
                  </div>
                  <div className="glass-card p-6 rounded-[24px] bg-white/5 border border-white/10 text-sm leading-relaxed text-gray-300">
                    {metaDescription}
                  </div>
                </div>

                {hashtags.length > 0 && (
                  <div className="space-y-4">
                    <div className="flex justify-between items-center">
                      <h3 className="text-sm font-bold text-white/90">おすすめのハッシュタグ</h3>
                      <button
                        onClick={() => {
                          navigator.clipboard.writeText(hashtags.join(" "));
                          alert("ハッシュタグをコピーしました");
                        }}
                        className="px-4 py-1.5 bg-white/10 hover:bg-white/20 rounded-lg text-[10px] font-bold text-white transition-all border border-white/10"
                      >
                        すべてコピー
                      </button>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {hashtags.map((tag, i) => (
                        <span key={i} className="px-3 py-1 bg-orange-500/10 border border-orange-500/20 rounded-full text-xs font-bold text-orange-400">
                          {tag}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {activeTab === "preview" && (
              <div className="animate-in fade-in slide-in-from-right-4 duration-500 pb-20 rounded-[32px] overflow-hidden shadow-2xl border border-orange-200/20">
                <div className="bg-gradient-to-r from-orange-100 to-red-100 p-4 flex items-center justify-between border-b border-orange-200">
                  <div className="flex items-center gap-2">
                    <span className="text-2xl">🐾</span>
                    <span className="text-orange-900 font-black text-xs tracking-tighter">note AI AGENT - Panda Preview Mode</span>
                  </div>
                  <div className="text-[10px] text-orange-700 font-bold opacity-50 uppercase tracking-widest">Original Creative Output</div>
                </div>

                <div className="bg-[#FAF7F2] p-8 md:p-12 space-y-12">
                  {generatedImage && (
                    <div className="relative group">
                      <img src={generatedImage} className="w-full aspect-video object-cover rounded-2xl shadow-lg border-4 border-white" />
                      <div className="absolute top-4 left-4 bg-orange-500 text-white text-[10px] font-bold px-3 py-1 rounded-full shadow-lg">Panda AI Illustration</div>
                    </div>
                  )}

                  <div className="space-y-8 max-w-xl mx-auto">
                    <h1 className="text-3xl md:text-5xl font-serif font-black text-gray-900 leading-[1.2] tracking-tight text-center md:text-left">
                      {displayTitle}
                    </h1>

                    <div className="flex gap-4 items-center border-y border-orange-200/50 py-6">
                      <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-orange-400 to-red-500 flex items-center justify-center text-xl shadow-md border-2 border-white">
                        🐾
                      </div>
                      <div>
                        <div className="font-black text-gray-900 flex items-center gap-2 font-serif">
                          note記事つくレッサーパンダ
                          <span className="bg-orange-100 text-orange-700 text-[10px] px-2 py-0.5 rounded-md">Official Agent</span>
                        </div>
                        <div className="text-gray-500 text-xs font-serif italic">2025.12.31 · 10 min read · Creative Commons</div>
                      </div>
                    </div>

                    <div className="prose prose-stone max-w-[850px] mx-auto text-base md:text-lg leading-relaxed md:leading-[1.8] text-gray-800 font-serif antialiased px-2">
                      <div className="whitespace-pre-wrap break-words indent-4">
                        {articleText.split('\n\n').map((para, i) => {
                          const isHeading = para.startsWith('##');
                          const headingText = isHeading ? para.replace('##', '').trim() : '';
                          const associatedImage = isHeading ? inlineImages.find(img => img.heading === headingText) : null;

                          return (
                            <div key={i} className="mb-6 md:mb-10">
                              <p className={cn(isHeading ? "text-xl md:text-2xl font-black text-gray-900 mt-10 md:mt-16 mb-6 md:mb-8" : "mb-6 md:mb-10 first-letter:text-2xl md:first-letter:text-3xl first-letter:font-black first-letter:text-orange-600 font-medium")}>
                                {para}
                              </p>
                              {associatedImage && (
                                <div className="my-6 md:my-8 rounded-xl md:rounded-2xl overflow-hidden border-2 md:border-4 border-white shadow-xl rotate-0 md:rotate-1">
                                  <img src={associatedImage.url} alt={headingText} className="w-full h-auto" />
                                  <div className="bg-orange-50 p-2 md:p-3 text-center text-[10px] md:text-xs font-bold text-orange-800 border-t border-orange-100">
                                    {headingText} - Visualization
                                  </div>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    <div className="mt-20 pt-10 border-t-2 border-dashed border-orange-300 flex flex-col items-center text-center space-y-4">
                      <div className="w-16 h-16 rounded-full bg-white shadow-inner flex items-center justify-center text-3xl border-2 border-orange-100 animate-bounce">
                        🐾
                      </div>
                      <p className="text-orange-900 font-black text-sm italic font-serif">
                        "思考を価値に変えるお手伝い、完了しました！"<br />
                        <span className="text-orange-600/60 not-italic text-xs">Generated by Note Red Panda Assistant</span>
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {activeTab === "score" && score && (
              <div className="glass-card p-8 rounded-[24px] animate-in fade-in slide-in-from-left-4 duration-500 border border-orange-500/20">
                <div className="flex justify-center mb-8">
                  <div className="w-20 h-20 rounded-2xl bg-orange-500/10 flex items-center justify-center text-4xl border border-orange-500/20 shadow-inner">🏆</div>
                </div>
                <ScoreMeter score={score.total} summary={score.summary} />
                <div className="px-4">
                  <ScoreBars details={score.details} metrics={score.metrics} />
                </div>
              </div>
            )}
          </div>

          <div className="pt-10 flex flex-col items-center gap-6">
            <div className="flex gap-4">
              <button
                onClick={() => handleGenerate(inputs)}
                className="px-10 py-5 rounded-full bg-white/5 hover:bg-white/10 text-white font-bold transition-all flex items-center gap-3 border border-white/10 shadow-lg"
              >
                <RotateCcw size={18} /> もう一度プロデュース
              </button>
              <button
                onClick={() => setStatus("outline")}
                className="px-10 py-5 rounded-full bg-gradient-to-r from-orange-400 to-red-500 text-white font-black transition-all flex items-center gap-3 shadow-2xl shadow-orange-500/20 active:scale-95"
              >
                <Sparkles size={18} /> 最初から別の記事を
              </button>
            </div>
            <BrandFooter />
          </div>

          {/* New: Mobile Quick Copy Helper (Floating UI) */}
          {status === "done" && (
            <MobileCopyHelper
              title={displayTitle}
              body={articleText}
              tags={hashtags}
            />
          )}
        </div>
      )
      }
    </div >
  );
}
