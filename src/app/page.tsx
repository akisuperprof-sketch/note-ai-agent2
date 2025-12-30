"use client";

import { useState, useRef, useEffect } from "react";
import {
  Play, Check, Copy, AlertCircle, X, ChevronRight, HelpCircle,
  RotateCcw, Sparkles
} from "lucide-react";
import { GoogleGenerativeAI } from "@google/generative-ai"; // Used client side only for basic types if needed, mostly doing api calls
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
  const [topic, setTopic] = useState(`AI活用最新情報　最新最高の王道
音声入力はaquavoice
音声撮り溜めは　voicy
音声文字起こしデータ含め自分情報の記録は　obsidian
antigravityでobsidian情報を記事にする
記事にしたらSNSで拡散
大切なポイントは、自分の見つめ直しと自分+市場分析
エッセンスは人間味
リアルな無料音声を作るなら elevenlabs
　必要な音声プロンプト作るならgemで感情まで入れ込む
リアル音声と台本で　sora2でリアル動画
マニュアル作るなら各AIに搭載のcanvas活用`);
  const [targetAudience, setTargetAudience] = useState("AI活用に興味があるビジネスパーソン");
  const [goal, setGoal] = useState("AIツールの具体的な連携フローを知ってもらう");
  const [targetLength, setTargetLength] = useState(3000);
  const [tone, setTone] = useState("やさしい");
  const [differentiation, setDifferentiation] = useState("");

  const handleSubmit = () => {
    if (!topic) return;
    onSubmit({ topic, targetAudience, goal, targetLength, tone, differentiation });
  };

  if (isGenerating) return null;

  return (
    <div className="glass-card p-6 md:p-8 rounded-[24px] space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="space-y-2">
        <label className="text-sm font-bold text-gray-400">記事テーマ・ノウハウメモ <span className="text-purple-400">*</span></label>
        <textarea
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          placeholder="（例）初心者向けのNotion使い方。データベース機能を中心に、タスク管理のテンプレートの作り方を解説したい。"
          className="w-full h-32 bg-black/20 border border-white/10 rounded-xl p-4 text-white placeholder-white/20 focus:outline-none focus:border-purple-500/50 transition-colors resize-none"
        />
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

// --- Main Page ---

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

    // Fake phases UI log
    const run = async () => {
      setLogs(["ノウハウを整理しています..."]);
      setStatus("writing"); // Start showing "Now Generating" immediately

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

        // Start streaming logic (simulated progress for distinct logs)
        // Actually we just stream the text and update logs based on content or time
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
            // Use functional update to avoid stale closure issues if needed, but here simple set is fine for streaming usually
            setArticleText(prev => prev + chunk);
          }
        }

        // Parsing Image Prompt from text
        const promptMatch = fullText.match(/【image_model】[\s\S]*$/);
        let finalImagePrompt = "";
        if (promptMatch) {
          finalImagePrompt = promptMatch[0];
          // We intentionally DON'T remove it from article text in UI to verify it's there? 
          // Or we can remove it. Let's keep it in "Image Prompt" block only.
          // Actually the user wants "Image Generation Prompt Block" separated.
          setImagePrompt(finalImagePrompt);
        }

        setStatus("polish");
        await addLog("本文を生成しています...", 1000); // Already mostly done streaming
        await addLog("文章を整えています...", 1000);

        setStatus("scoring");
        await addLog("品質スコアを算出しています...", 1000);
        const calculatedScore = calculateArticleScore(fullText, data.targetLength);
        setScore(calculatedScore);

        setStatus("image_prompt");
        await addLog("アイキャッチ用の画像プロンプトを作成しています...", 1000);

        if (finalImagePrompt) {
          // Extract real prompt part for API
          const realPromptMatch = finalImagePrompt.match(/【prompt】\n([\s\S]*?)\n【/);
          if (realPromptMatch && realPromptMatch[1]) {
            // Generate Image (Simulate phase 5)
            try {
              const imgRes = await fetch("/api/generate-image", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  articleText: fullText,
                  promptOverride: realPromptMatch[1].trim()
                }),
              });
              const imgData = await imgRes.json();
              if (imgData.imageUrl) setGeneratedImage(imgData.imageUrl);
            } catch (e) {
              console.error(e);
            }
          }
        }

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
          <div className="mb-8">
            <h2 className="text-2xl font-bold mb-2">サンプル記事</h2>
            <div className="flex gap-4 overflow-x-auto pb-4 scrollbar-hide">
              {[1, 2].map(i => (
                <div key={i} className="glass-card w-64 h-32 rounded-xl shrink-0 flex items-center justify-center text-white/20">
                  Sample {i}
                </div>
              ))}
            </div>
          </div>

          <h2 className="text-2xl font-bold mb-4">3 Step Generation</h2>
          <StepCards onStart={() => setStatus("outline")} /> {/* Transitions to input form actually, simplified state */}
        </div>
      )}

      {/* Input Form triggers transition to generating */}
      {status === "idle" && (
        <div className="mt-8 text-center">
          <button onClick={() => setStatus("outline")} className="text-white/50 underline">入力フォームへ（デバッグ用）</button>
        </div>
        // In reality StepCards onClick should assume 'outline' is just 'inputting' phase or similar. 
        // Let's reuse 'outline' as 'show input form' for simplicity if we interpret 'idle' as home.
        // Actually, let's make StepCards just show the InputForm.
      )}

      {(status === "idle" || status === "outline") && ( // Show input form when tapped "Start"
        // Overriding logic: let's make "idle" show Home, and StepCards transition to a distinct "input" state. 
        // But for now let's just render InputForm if we are not generating and not done.
        <></>
      )}

      {status === "outline" && ( // Re-using 'outline' state as 'Input Form' state effectively for this flow
        <InputForm onSubmit={handleGenerate} isGenerating={false} />
      )}

      {(status === "writing" || status === "polish" || status === "scoring" || status === "image_prompt") && (
        <ProgressLog logs={logs} />
      )}

      {status === "done" && (
        <div className="animate-in fade-in slide-in-from-bottom-8 duration-700">
          {/* Result / Score Tabs */}
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
              {/* Image Generation Result */}
              {generatedImage && (
                <div className="glass-card p-2 rounded-[24px]">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={generatedImage} alt="Generated Header" className="w-full rounded-[20px] aspect-video object-cover" />
                  <div className="p-4">
                    <p className="text-xs text-white/50 font-mono mb-2">GENERATED BY GEMINI-3-PRO-IMAGE-PREVIEW</p>
                    <a href={generatedImage} download="header.png" className="text-purple-400 text-sm font-bold hover:underline">画像をダウンロード</a>
                  </div>
                </div>
              )}

              <div className="glass-card p-6 rounded-[24px]">
                <div className="flex justify-between items-center mb-4">
                  <h3 className="font-bold text-white/70">記事本文</h3>
                  <button onClick={copyToClipboard} className="flex items-center gap-2 px-4 py-2 bg-white/10 rounded-full text-sm font-bold hover:bg-purple-500 transition-colors">
                    <Copy size={16} /> コピー
                  </button>
                </div>
                <div className="prose prose-invert prose-p:text-gray-300 prose-headings:text-white max-w-none">
                  <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed">{articleText}</pre>
                </div>
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

          <div className="mt-8 text-center">
            <button
              onClick={() => setStatus("outline")}
              className="px-6 py-3 rounded-full bg-white/5 hover:bg-white/10 text-white/70 text-sm font-bold transition-colors flex items-center gap-2 mx-auto"
            >
              <RotateCcw size={16} />
              はじめから作る
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
