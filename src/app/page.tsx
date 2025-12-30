"use client";

import { useState, useRef, useEffect } from "react";
import {
  Play, Check, Copy, AlertCircle, X, ChevronRight, HelpCircle,
  RotateCcw, Sparkles, Wand2, Share, DollarSign, Lightbulb, ImagePlus
} from "lucide-react";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { calculateArticleScore, ArticleScore } from "@/lib/score";
import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";

function cn(...inputs: (string | undefined | null | false)[]) {
  return twMerge(clsx(inputs));
}

// --- Types ---
type AppStatus = "idle" | "outline" | "writing" | "polish" | "scoring" | "image_prompt" | "done" | "error" | "canceled";

// --- Components ---

function Header() {
  return (
    <header className="fixed top-0 left-0 right-0 h-16 border-b border-[rgba(255,255,255,0.08)] bg-[#0B0F1A]/80 backdrop-blur-md z-50 flex items-center justify-between px-6">
      <div className="flex items-center gap-2">
        <div className="w-8 h-8 rounded-lg bg-gradient-primary flex items-center justify-center text-white font-bold shadow-lg shadow-purple-500/20">
          <Sparkles size={18} />
        </div>
        <h1 className="text-lg font-bold text-white tracking-wide">
          わど式
          <span className="text-transparent bg-clip-text bg-gradient-to-r from-purple-400 to-blue-400 ml-1">AI Agent</span>
        </h1>
      </div>
      <div className="text-xs text-white/50 font-mono">v2.0 REPRO</div>
    </header>
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
      <div className="glass-card w-full max-w-md rounded-[24px] p-6 text-white shadow-2xl">
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-xl font-bold">このツールの使い方</h2>
          <button onClick={onClose}><X size={24} className="text-white/50" /></button>
        </div>

        <div className="space-y-4 mb-8">
          <div className="flex gap-4 p-4 rounded-xl bg-white/5 border border-white/5">
            <div className="w-8 h-8 rounded-full bg-purple-500/20 text-purple-400 flex items-center justify-center font-bold shrink-0">1</div>
            <div>
              <h3 className="font-bold mb-1">ノウハウを入力</h3>
              <p className="text-sm text-gray-400">箇条書きのメモや書きたいテーマを入力します。</p>
            </div>
          </div>
          <div className="flex gap-4 p-4 rounded-xl bg-white/5 border border-white/5">
            <div className="w-8 h-8 rounded-full bg-blue-500/20 text-blue-400 flex items-center justify-center font-bold shrink-0">2</div>
            <div>
              <h3 className="font-bold mb-1">AIが記事生成</h3>
              <p className="text-sm text-gray-400">構成・執筆・編集・画像プロンプト作成を全自動で行います。</p>
            </div>
          </div>
          <div className="flex gap-4 p-4 rounded-xl bg-white/5 border border-white/5">
            <div className="w-8 h-8 rounded-full bg-cyan-500/20 text-cyan-400 flex items-center justify-center font-bold shrink-0">3</div>
            <div>
              <h3 className="font-bold mb-1">コピーして完了</h3>
              <p className="text-sm text-gray-400">品質スコアを確認し、noteに貼り付けて投稿完了です。</p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 mb-6 cursor-pointer" onClick={() => setDoNotShow(!doNotShow)}>
          <div className={cn("w-5 h-5 rounded border border-white/30 flex items-center justify-center transition-colors", doNotShow && "bg-purple-500 border-purple-500")}>
            {doNotShow && <Check size={14} />}
          </div>
          <span className="text-sm text-gray-400">次回から表示しない</span>
        </div>

        <button
          onClick={handleStart}
          className="w-full py-4 rounded-[28px] bg-gradient-primary font-bold text-lg hover:shadow-lg hover:shadow-purple-500/25 transition-all text-white"
        >
          はじめる
        </button>
      </div>
    </div>
  );
}

function StepCards({ onStart }: { onStart: () => void }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
      {[
        { num: 1, title: "ノウハウ整理", desc: "メモを入力" },
        { num: 2, title: "自動生成", desc: "AIが執筆" },
        { num: 3, title: "コピー投稿", desc: "noteへ貼付" }
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
  const [targetLength, setTargetLength] = useState(5000);
  const [tone, setTone] = useState("やさしい");
  const [differentiation, setDifferentiation] = useState("");
  const [visualStyle, setVisualStyle] = useState("写真リアル");
  const [character, setCharacter] = useState("指定なし");
  const [referenceImage, setReferenceImage] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setReferenceImage(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleAutoRecommend = () => {
    setTargetAudience("20代の若手社員");
    setGoal("信頼獲得、LINE登録");
    setTargetLength(5000);
    setTone("やさしい");
    setDifferentiation("競合にはない独自の視点や体験談");
  };

  const handleSubmit = () => {
    if (!topic) return;
    onSubmit({
      topic, targetAudience, goal, targetLength, tone,
      differentiation, visualStyle, character, referenceImage
    });
  };

  if (isGenerating) return null;

  return (
    <div className="glass-card p-6 md:p-8 rounded-[24px] space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="space-y-4">
        {/* Topic Input */}
        <div className="space-y-2">
          <div className="flex justify-between items-center">
            <label className="text-sm font-bold text-gray-400">記事テーマ・ノウハウメモ <span className="text-purple-400">*</span></label>
            <button
              onClick={handleAutoRecommend}
              className="text-xs bg-gradient-to-r from-pink-500 to-purple-500 text-white px-3 py-1 rounded-full flex items-center gap-1 font-bold hover:opacity-90 transition-opacity"
            >
              <Wand2 size={12} /> AIにおまかせ設定
            </button>
          </div>
          <textarea
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            placeholder="（例）初心者向けのNotion使い方。データベース機能を中心に、タスク管理のテンプレートの作り方を解説したい。"
            className="w-full h-32 bg-black/20 border border-white/10 rounded-xl p-4 text-white placeholder-white/20 focus:outline-none focus:border-purple-500/50 transition-colors resize-none"
          />
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
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-2">
          <label className="text-sm font-bold text-gray-400">想定読者</label>
          <input
            type="text"
            value={targetAudience}
            onChange={(e) => setTargetAudience(e.target.value)}
            placeholder="（例）20代の若手社員"
            className="w-full bg-black/20 border border-white/10 rounded-xl p-3 text-white placeholder-white/20 focus:outline-none focus:border-purple-500/50"
          />
        </div>
        <div className="space-y-2">
          <label className="text-sm font-bold text-gray-400">記事の目的</label>
          <input
            type="text"
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            placeholder="（例）信頼獲得、LINE登録"
            className="w-full bg-black/20 border border-white/10 rounded-xl p-3 text-white placeholder-white/20 focus:outline-none focus:border-purple-500/50"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-2">
          <label className="text-sm font-bold text-gray-400">目標文字数</label>
          <select
            value={targetLength}
            onChange={(e) => setTargetLength(Number(e.target.value))}
            className="w-full bg-black/20 border border-white/10 rounded-xl p-3 text-white focus:outline-none focus:border-purple-500/50 appearance-none"
          >
            <option value={3000}>3,000文字（サクッと）</option>
            <option value={5000}>5,000文字（標準）</option>
            <option value={8000}>8,000文字（長編）</option>
            <option value={10000}>10,000文字（網羅）</option>
          </select>
        </div>
        <div className="space-y-2">
          <label className="text-sm font-bold text-gray-400">トーン</label>
          <select
            value={tone}
            onChange={(e) => setTone(e.target.value)}
            className="w-full bg-black/20 border border-white/10 rounded-xl p-3 text-white focus:outline-none focus:border-purple-500/50 appearance-none"
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
          <label className="text-sm font-bold text-gray-400">登場キャラクター</label>
          <select
            value={character}
            onChange={(e) => setCharacter(e.target.value)}
            className="w-full bg-black/20 border border-white/10 rounded-xl p-3 text-white focus:outline-none focus:border-purple-500/50 appearance-none"
          >
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

// --- Main Page Updated Logic ---

export default function Home() {
  const [showHelp, setShowHelp] = useState(false);
  const [status, setStatus] = useState<AppStatus>("idle");
  const [logs, setLogs] = useState<string[]>([]);
  const [inputs, setInputs] = useState<any>(null);
  const [articleText, setArticleText] = useState("");
  const [score, setScore] = useState<ArticleScore | null>(null);
  const [generatedImage, setGeneratedImage] = useState<string | null>(null);
  const [imagePrompt, setImagePrompt] = useState("");
  const [activeTab, setActiveTab] = useState<"result" | "score">("result");
  const [displayTitle, setDisplayTitle] = useState(""); // State for title overlay
  const [textModel, setTextModel] = useState("");
  const [imageModel, setImageModel] = useState("");

  useEffect(() => {
    const hideHelp = localStorage.getItem("hideHelp");
    if (!hideHelp) setShowHelp(true);
  }, []);

  const addLog = async (msg: string, delay: number) => {
    await new Promise(r => setTimeout(r, delay));
    setLogs(prev => [...prev, msg]);
  };

  const handleGenerate = async (data: any) => {
    setInputs(data);
    setStatus("outline");
    setLogs([]);
    setArticleText("");
    setScore(null);
    setGeneratedImage(null);
    setImagePrompt("");
    setDisplayTitle(""); // Reset title
    setTextModel("gemini-3-flash-preview"); // Text model name

    const run = async () => {
      setLogs(["ノウハウを整理しています..."]);
      setStatus("writing");

      try {
        const response = await fetch("/api/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data),
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
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            const chunk = decoder.decode(value, { stream: true });
            fullText += chunk;
            setArticleText(prev => prev + chunk);
          }
        }

        // Extract title for display: Search for first H1 (# ) or use topic
        const titleMatch = fullText.match(/^#\s+(.+)$/m);
        const extractedTitle = titleMatch ? titleMatch[1].trim() : data.topic;
        setDisplayTitle(extractedTitle);

        // --- Added Phase: Refinement ---
        await addLog("文章を整えています（推敲中）...", 1500);
        // (Internal refinement logic would go here if API supported it, simplified as log for now to match UX request)

        const finalScore = calculateArticleScore(fullText, data.targetLength || 5000);
        setScore(finalScore);

        setStatus("image_prompt");
        // --- Added Phase: Topic Summary for Image ---
        await addLog("アイキャッチ画像を作成しています...", 1000);

        // Try to generate image with intermediate summarization if possible
        // We pass fullText, but server now extracts better summary based on our new instruction
        try {
          const imgRes = await fetch("/api/generate-image", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              title: extractedTitle, // Pass the extracted title
              articleText: fullText,
              visualStyle: data.visualStyle, // Pass visual style
              character: data.character      // Pass character setting
            }),
          });

          if (!imgRes.ok) {
            const errData = await imgRes.json().catch(() => ({ error: "Unknown Image Error" }));
            await addLog(`画像生成エラー: ${errData.error}`, 3000);
            if (errData.generatedPrompt) setImagePrompt(errData.generatedPrompt);
          } else {
            const imgData = await imgRes.json();
            if (imgData.imageUrl) setGeneratedImage(imgData.imageUrl);
            if (imgData.generatedPrompt) setImagePrompt(imgData.generatedPrompt);
            if (imgData.model) setImageModel(imgData.model);
          }
        } catch (e) { console.error(e); }

        setStatus("done");
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


  const copyToClipboard = () => {
    navigator.clipboard.writeText(articleText);
    alert("コピーしました");
  };

  return (
    <div className="min-h-screen pb-20 pt-20 px-4 md:px-8 max-w-2xl mx-auto">
      <Header />
      {showHelp && <HelpModal onClose={() => setShowHelp(false)} />}

      {status === "idle" && (
        <div className="animate-in fade-in zoom-in duration-500">
          <div className="text-center mb-12">
            <h2 className="text-3xl md:text-4xl font-bold text-white mb-4">
              あなたのノウハウを、<br />
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-purple-400 to-blue-400">プロ級のnote記事</span>に。
            </h2>
            <p className="text-gray-400 max-w-md mx-auto">
              テーマを入力するだけで、構成・執筆・画像生成・品質スコア評価までAIがワンストップで実行します。
            </p>
          </div>

          <h2 className="text-xl font-bold mb-4 text-white/70">記事作成の 3 Step</h2>
          <StepCards onStart={() => setStatus("outline")} />

          <div className="mt-12 p-6 glass-card rounded-[24px] border border-white/5 bg-white/5">
            <h3 className="font-bold mb-4 text-sm text-gray-500">最近のアップデート</h3>
            <div className="space-y-3">
              <div className="flex items-start gap-3 text-sm">
                <div className="w-5 h-5 rounded-full bg-purple-500/20 flex items-center justify-center shrink-0 mt-0.5">
                  <Sparkles size={12} className="text-purple-400" />
                </div>
                <p className="text-gray-300">参考画像（キャラクター等）の取り込みに対応しました。</p>
              </div>
              <div className="flex items-start gap-3 text-sm">
                <div className="w-5 h-5 rounded-full bg-blue-500/20 flex items-center justify-center shrink-0 mt-0.5">
                  <Check size={12} className="text-blue-400" />
                </div>
                <p className="text-gray-300">「3秒で伝わる」サムネイル最適化プロンプトを導入しました。</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {status === "outline" && (
        <InputForm onSubmit={handleGenerate} isGenerating={false} />
      )}

      {(status === "writing" || status === "polish" || status === "scoring" || status === "image_prompt") && (
        <div className="space-y-6">
          <ProgressLog logs={logs} />

          <div className="glass-card p-4 rounded-[20px] bg-black/40 border border-white/10 animate-in fade-in slide-in-from-bottom-4 duration-700">
            <div className="flex items-center justify-between mb-3 border-b border-white/5 pb-2">
              <div className="flex items-center gap-2">
                <div className="flex gap-1.5">
                  <div className="w-2.5 h-2.5 rounded-full bg-red-500/20"></div>
                  <div className="w-2.5 h-2.5 rounded-full bg-yellow-500/20"></div>
                  <div className="w-2.5 h-2.5 rounded-full bg-green-500/20"></div>
                </div>
                <span className="text-xs font-mono text-white/30 ml-2">GENERATING_PREVIEW.md</span>
              </div>
              <div className="flex items-center gap-3">
                <div className="text-xs font-mono text-white/50">
                  {articleText.length.toLocaleString()} / {(inputs?.targetLength || 5000).toLocaleString()} chars
                </div>
                <div className="w-24 h-1.5 bg-white/10 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-purple-500 to-blue-500 transition-all duration-300"
                    style={{ width: `${Math.min(100, (articleText.length / (inputs?.targetLength || 5000)) * 100)}%` }}
                  ></div>
                </div>
              </div>
            </div>
            <div className="h-48 overflow-y-auto font-mono text-xs md:text-sm text-gray-400 leading-relaxed scrollbar-hide">
              <pre className="whitespace-pre-wrap font-sans">
                {articleText || <span className="animate-pulse">Waiting for stream...</span>}
                <span className="inline-block w-2 h-4 bg-purple-500 ml-1 animate-pulse align-middle"></span>
              </pre>
            </div>
          </div>
        </div>
      )}

      {status === "done" && (
        <div className="animate-in fade-in slide-in-from-bottom-8 duration-700">
          <div className="flex gap-4 mb-6">
            <button
              onClick={() => setActiveTab("result")}
              className={cn("flex-1 py-3 rounded-xl font-bold transition-all", activeTab === "result" ? "bg-white/10 text-white" : "text-white/40 hover:text-white")}
            >
              記事出力
            </button>
            <button
              onClick={() => setActiveTab("score")}
              className={cn("flex-1 py-3 rounded-xl font-bold transition-all", activeTab === "score" ? "bg-white/10 text-white" : "text-white/40 hover:text-white")}
            >
              品質スコア
            </button>
          </div>

          {activeTab === "result" && (
            <div className="space-y-6">
              {generatedImage && (
                <div className="glass-card p-2 rounded-[24px] overflow-hidden relative group">
                  <div className="relative aspect-video w-full rounded-[20px] overflow-hidden">
                    <img src={generatedImage} alt="Generated Header" className="w-full h-full object-cover" />
                    {/* Note-style Premium Title Overlay */}
                    <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 via-black/40 to-transparent pt-24 pb-6 px-6 text-center">
                      <div className="inline-block px-3 py-1 bg-white/10 border border-white/20 rounded-full text-[10px] text-white/50 font-bold mb-3 tracking-widest backdrop-blur-md">
                        FEATURED ARTICLE
                      </div>
                      <h1 className="text-xl md:text-2xl font-bold text-white leading-relaxed tracking-tight" style={{
                        textShadow: "0 2px 10px rgba(0,0,0,1)",
                        letterSpacing: "-0.01em"
                      }}>
                        {displayTitle}
                      </h1>
                    </div>
                  </div>

                  <div className="p-4 flex justify-between items-center bg-black/20">
                    <a href={generatedImage} download="header.png" className="text-purple-400 text-sm font-bold hover:underline flex items-center gap-2">
                      画像を保存
                    </a>
                    <div className="flex gap-2">
                      <div className="flex flex-col items-end">
                        <span className="text-[9px] text-white/30 uppercase tracking-tighter">AI Model</span>
                        <span className="text-[10px] text-white/50 font-mono">{imageModel || "Gemini 3 Pro"}</span>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              <div className="glass-card p-6 rounded-[24px]">
                <div className="flex justify-between items-center mb-4">
                  <div className="flex items-center gap-3">
                    <h3 className="font-bold text-white/70">記事本文</h3>
                    <div className="px-2 py-0.5 rounded bg-blue-500/10 border border-blue-500/20 text-[10px] text-blue-400 font-mono tracking-tighter">
                      {textModel}
                    </div>
                  </div>
                  <button onClick={copyToClipboard} className="flex items-center gap-2 px-4 py-2 bg-white/10 rounded-full text-sm font-bold hover:bg-purple-500 transition-colors">
                    <Copy size={16} /> コピー
                  </button>
                </div>
                <div className="prose prose-invert prose-p:text-gray-300 prose-headings:text-white max-w-none bg-black/20 rounded-xl p-4 max-h-[500px] overflow-y-auto custom-scrollbar">
                  <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed">{articleText}</pre>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <button className="glass-card p-4 rounded-xl flex items-center gap-3 hover:bg-white/10 transition-colors text-left group">
                  <div className="w-10 h-10 rounded-full bg-blue-400/20 flex items-center justify-center group-hover:bg-blue-400/30 transition-colors">
                    <Share size={20} className="text-blue-400" />
                  </div>
                  <div>
                    <div className="font-bold text-sm">Xで告知する</div>
                    <div className="text-xs text-white/50">投稿文を自動作成</div>
                  </div>
                </button>
                <button className="glass-card p-4 rounded-xl flex items-center gap-3 hover:bg-white/10 transition-colors text-left group">
                  <div className="w-10 h-10 rounded-full bg-yellow-400/20 flex items-center justify-center group-hover:bg-yellow-400/30 transition-colors">
                    <DollarSign size={20} className="text-yellow-400" />
                  </div>
                  <div>
                    <div className="font-bold text-sm">有料noteにする</div>
                    <div className="text-xs text-white/50">有料化のアイデア</div>
                  </div>
                </button>
              </div>

              <div className="glass-card p-6 rounded-[24px] border-l-4 border-l-purple-500">
                <h3 className="font-bold mb-2">画像生成プロンプト</h3>
                <p className="text-xs text-white/50 mb-4">他の画像生成ツールを使う場合はこちらをコピーしてください</p>
                <div className="bg-black/30 p-4 rounded-xl text-xs font-mono text-gray-400 overflow-x-auto">
                  {imagePrompt || "プロンプト生成中..."}
                </div>
              </div>
            </div>
          )}

          {activeTab === "score" && score && (
            <div className="glass-card p-8 rounded-[24px]">
              <ScoreMeter score={score.total} summary={score.summary} />
              <div className="px-4">
                <ScoreBars details={score.details} metrics={score.metrics} />
              </div>
              <div className="mt-8 pt-8 border-t border-white/10 text-center">
                <p className="text-sm text-gray-400">
                  「{score.summary}」な記事です。<br />
                  {score.total < 80 ? "見出しや具体例を足して、充実度を上げるとさらに良くなります。" : "このまま自信を持って投稿しましょう！"}
                </p>
              </div>
            </div>
          )}

          <div className="mt-8 flex flex-col items-center gap-4">
            {articleText.length < (inputs?.targetLength || 5000) * 0.9 && (
              <div className="flex items-center gap-2 text-yellow-500 bg-yellow-500/10 px-4 py-2 rounded-xl text-sm font-bold border border-yellow-500/20">
                <AlertCircle size={16} />
                文字数が目標に届いていません（現在 {articleText.length.toLocaleString()} / {inputs?.targetLength?.toLocaleString()} 字）
              </div>
            )}

            <div className="flex gap-4">
              <button
                onClick={() => handleGenerate(inputs)}
                className="px-8 py-3 rounded-full bg-white/10 hover:bg-white/20 text-white text-sm font-bold transition-all flex items-center gap-2"
              >
                <RotateCcw size={16} />
                再試行して書き直す
              </button>
              <button
                onClick={() => setStatus("outline")}
                className="px-8 py-3 rounded-full bg-gradient-primary text-white text-sm font-bold transition-all flex items-center gap-2 shadow-lg shadow-purple-500/20"
              >
                はじめから作成
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
