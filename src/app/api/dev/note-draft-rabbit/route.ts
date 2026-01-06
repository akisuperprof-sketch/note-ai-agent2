import { NextRequest, NextResponse } from 'next/server';
import path from 'path';
import fs from 'fs';

// --- Config ---
const isVercel = !!(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);
const SESSION_FILE = isVercel ? path.join('/tmp', 'note-session.json') : path.join(process.cwd(), '.gemini', 'note-session.json');

// --- Types ---
type NoteJob = {
    job_id: string;
    status: 'pending' | 'running' | 'success' | 'failed';
    last_step: string;
    note_url?: string;
    error_message?: string;
};

// --- Helpers ---
function mdToHtml(md: string): string {
    let html = md;

    // 0. AI生成の目次削除 (システム生成と重複するため)
    // 0. AI生成のメタデータ・目次削除
    html = html.replace(/^---CONTENT_START---$/gm, ''); // 開始マーカー削除
    html = html.replace(/^> ?【?目次】?.*$/gm, '');
    html = html.replace(/^## ?目次.*$/gm, '');
    html = html.replace(/^\*\*目次\*\*.*$/gm, '');
    // AIの内部ヘッダー（序章、構成案など）を削除
    html = html.replace(/^【(序章|導入|構成案|計画|編集後記).*】.*$/gm, '');
    html = html.replace(/^\*\*【(序章|導入|構成案|計画|編集後記).*】\*\*.*$/gm, ''); // 太字パターンも削除

    // 1. コードブロック (```...```) -> <pre><code>...</code></pre>
    html = html.replace(/```(\w+)?\n([\s\S]*?)```/g, (match, lang, code) => {
        const escapedCode = code.replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
        return `<pre data-lang="${lang || ''}"><code>${escapedCode}</code></pre>`;
    });

    // 2. 自動HR挿入: H2 (##) の直前に区切り線を入れる
    html = html.replace(/\n(## .+)/g, '\n\n---\n\n$1');

    // 3. 水平線 (---) -> <hr>
    html = html.replace(/^---$/gm, '<hr>');

    // 4. ポイント強調 (独立行の太字) -> 引用符付き太字
    html = html.replace(/^\*\*(Point|ポイント|Check|チェック)[：:](.+)\*\*$/gm, '<blockquote><strong>$1: $2</strong></blockquote>');

    // 5. URL自動リンク (httpから始まる行)
    // 既にリンク記法になっているものは除外
    html = html.replace(/^(http[^ \n]+)$/gm, '<a href="$1">$1</a>');

    // 6. 目次生成 (TOC) - 削除
    // noteが自動生成するものと重複するため、自前の目次は生成しません。

    // 7. 見出し (Note API対策: H1は削除, H2->H3, H3->H4)
    // NoteのAPI/エディタ仕様に合わせて見出しレベルをごく一部調整
    html = html.replace(/^# (.+)$/gm, ''); // H1（タイトル）は本文から削除
    html = html.replace(/^## (.+)$/gm, '<h3>$1</h3>'); // H2 -> H3 (Noteの大見出し相当)
    html = html.replace(/^### (.+)$/gm, '<h4>$1</h4>'); // H3 -> H4 (Noteの小見出し相当)

    // 8. リスト
    html = html.replace(/^- (.+)$/gm, '<ul><li>$1</li></ul>');
    html = html.replace(/<\/ul>\n<ul>/g, '');

    // 9. 強調 (通常の文中太字)
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');

    // 10. 画像 (簡易)
    html = html.replace(/!\[(.*?)\]\((.*?)\)/g, '<figure><img src="$2" alt="$1"></figure>');

    // 11. リンク
    html = html.replace(/\[(.*?)\]\((.*?)\)/g, '<a href="$2">$1</a>');

    // 12. 引用
    html = html.replace(/^> (.+)$/gm, '<blockquote>$1</blockquote>');

    // 13. 段落
    const paragraphs = html.split('\n\n');
    html = paragraphs.map(p => {
        const trimmed = p.trim();
        if (!trimmed) return '';
        if (trimmed.match(/^(<h[1-6]|<pre|<figure|<ul|<hr|<li|<blockquote|<div)/)) {
            return trimmed;
        }
        return `<p>${trimmed}</p>`;
    }).join('\n');

    if (!html) html = "<p>（本文なし）</p>";

    return html;
}

// --- Helpers ---
function getSessionData(): any | null {
    try {
        // Priority 1: Env Var (for Vercel/Production)
        if (process.env.NOTE_SESSION_JSON) {
            try {
                return JSON.parse(process.env.NOTE_SESSION_JSON);
            } catch (e) {
                console.error("Env Var NOTE_SESSION_JSON parse error:", e);
            }
        }

        // Priority 2: File System (for Local)
        if (fs.existsSync(SESSION_FILE)) {
            return JSON.parse(fs.readFileSync(SESSION_FILE, 'utf-8'));
        }

        return null;
    } catch (e) {
        console.error("Session Load Error:", e);
        return null;
    }
}

function getCookiesFromSession(): string | null {
    const data = getSessionData();
    if (!data || !data.cookies || !Array.isArray(data.cookies)) return null;

    // note.com のクッキーのみを抽出（念のため）
    return data.cookies
        .map((c: any) => `${c.name}=${c.value}`)
        .join('; ');
}

function getXsrfTokenFromSession(): string | null {
    const data = getSessionData();
    if (!data || !data.cookies || !Array.isArray(data.cookies)) return null;

    const tokenCookie = data.cookies.find((c: any) => c.name === 'XSRF-TOKEN');
    return tokenCookie ? tokenCookie.value : null;
}

export async function POST(req: NextRequest) {
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
        async start(controller) {
            const sendUpdate = (step: string) => {
                const job: NoteJob = {
                    job_id: 'rabbit-' + Date.now(),
                    status: step.includes('Error') ? 'failed' : 'running',
                    last_step: step
                };
                controller.enqueue(encoder.encode(`${JSON.stringify(job)}\n`));
            };

            try {
                sendUpdate('Rabbit: セッションを読み込んでいます...');

                const { title, body: noteBody, imageUrl } = await req.json();
                const cookieHeader = getCookiesFromSession();

                if (!cookieHeader) {
                    throw new Error("セッションが見つかりません。通常モードでログインするか、環境変数 NOTE_SESSION_JSON を設定してください。");
                }

                sendUpdate('Rabbit: コンテンツを変換中...');
                console.log("Rabbit: Received Body Length:", noteBody?.length);
                console.log("Rabbit: Received Body Preview:", noteBody?.substring(0, 100));

                let htmlContent = mdToHtml(noteBody || "");
                console.log("Rabbit: Converted HTML Length:", htmlContent.length);
                console.log("Rabbit: Converted HTML Preview:", htmlContent.substring(0, 100));

                sendUpdate('Rabbit: APIリクエストを送信中...');

                const xsrfToken = getXsrfTokenFromSession();

                // note API headers
                const headers: Record<string, string> = {
                    'Content-Type': 'application/json',
                    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                    'Cookie': cookieHeader,
                    'Origin': 'https://note.com',
                    'Referer': 'https://note.com/notes/new',
                    'X-Requested-With': 'XMLHttpRequest'
                };

                if (xsrfToken) {
                    headers['X-XSRF-TOKEN'] = xsrfToken;
                }

                // 1. Check Login Status (Soft Check)
                try {
                    sendUpdate('Rabbit: ログインの状態を確認中...');
                    const statusRes = await fetch('https://note.com/api/v2/login/status', { headers });
                    if (!statusRes.ok) {
                        console.warn(`Rabbit: Login Check HTTP ${statusRes.status}`);
                    } else {
                        const contentType = statusRes.headers.get("content-type");
                        if (contentType && contentType.includes("application/json")) {
                            const statusData = await statusRes.json();
                            const userNickname = statusData.data?.user?.nickname || "Unknown";
                            sendUpdate(`Rabbit: ログイン成功 (ユーザー: ${userNickname})`);
                        } else {
                            console.warn("Rabbit: Login Check returned non-JSON");
                        }
                    }
                } catch (e) {
                    console.error("Rabbit: Login Check Failed (Skipping)", e);
                    sendUpdate('Rabbit: ログイン状態の確認をスキップします (エラー)');
                }

                // Detailed Logging for Debugging
                const bodyLen = noteBody?.length || 0;
                sendUpdate(`Rabbit: 本文長: ${bodyLen}, HTML変換後: ${htmlContent.length}`);

                // --- Image Logic (Enabled) ---
                let eyecatchKey: string | null = null;
                if (imageUrl) {
                    try {
                        sendUpdate('Rabbit: アイキャッチ画像を処理中...');
                        let imageBlob: Blob;

                        if (imageUrl.startsWith('data:')) {
                            // Convert Base64 Data URL to Blob
                            const fetchRes = await fetch(imageUrl);
                            imageBlob = await fetchRes.blob();
                        } else {
                            // Fetch remote URL
                            const fetchRes = await fetch(imageUrl);
                            if (!fetchRes.ok) throw new Error(`Failed to fetch image: ${fetchRes.status}`);
                            imageBlob = await fetchRes.blob();
                        }

                        // Upload to Note API
                        sendUpdate('Rabbit: 画像をnoteサーバーへアップロード中...');
                        const formData = new FormData();
                        formData.append('resource', imageBlob, 'eyecatch.png');
                        formData.append('type', 'eyecatch_image'); // Common type for eyecatch

                        const uploadHeaders: Record<string, string> = {
                            'User-Agent': headers['User-Agent'],
                            'Cookie': headers['Cookie'],
                            'Origin': headers['Origin'],
                            'Referer': headers['Referer'],
                            'X-Requested-With': headers['X-Requested-With']
                        };
                        if (xsrfToken) uploadHeaders['X-XSRF-TOKEN'] = xsrfToken;

                        // Upload to Note API (Try standard endpoints)
                        // Strategy: Try 'upload_image' (unofficial common), then 'files' (modern), then 'images'
                        const endpoints = [
                            'https://note.com/api/v1/upload_image',
                            'https://note.com/api/v1/files',
                            'https://note.com/api/v2/file/upload'
                        ];

                        let uploadSuccess = false;

                        for (const endpoint of endpoints) {
                            sendUpdate(`Rabbit: 画像アップロード試行中 (${endpoint.split('/').pop()})...`);
                            const uploadRes = await fetch(endpoint, {
                                method: 'POST',
                                headers: uploadHeaders,
                                body: formData
                            });

                            if (uploadRes.ok) {
                                const uploadData = await uploadRes.json();
                                eyecatchKey = uploadData.data?.key || uploadData.key; // Compatible with different responses
                                if (eyecatchKey) {
                                    sendUpdate('Rabbit: 画像のアップロード成功！');
                                    uploadSuccess = true;
                                    break;
                                }
                            } else {
                                console.warn(`Rabbit: Upload to ${endpoint} failed: ${uploadRes.status}`);
                            }
                        }

                        if (!uploadSuccess) {
                            sendUpdate(`Rabbit: 【警告】すべてのエンドポイントで画像のアップロードに失敗しました`);
                        }

                    } catch (e: any) {
                        console.error("Rabbit: Image Logic Error:", e);
                        sendUpdate(`Rabbit: 画像処理エラー - ${e.message}`);
                    }
                } else {
                    sendUpdate('Rabbit: 画像URLが指定されていません');
                }

                // --- Note Creation ---
                const apiData = {
                    body: htmlContent,
                    name: title,
                    template_key: null
                };
                console.log("Rabbit: Sending Payload (Flat):", JSON.stringify(apiData).substring(0, 500));

                const res = await fetch('https://note.com/api/v1/text_notes', {
                    method: 'POST',
                    headers: headers,
                    body: JSON.stringify(apiData)
                });

                if (!res.ok) {
                    const errText = await res.text();
                    throw new Error(`API Create Error: ${res.status} ${res.statusText} - ${errText.substring(0, 200)}`);
                }

                const result = await res.json();
                console.log("Rabbit: Create Result:", JSON.stringify(result).substring(0, 500));

                const articleKey = result.data?.key;
                const articleId = result.data?.id;
                const noteUrl = articleKey ? `https://note.com/notes/${articleKey}` : 'unknown';

                if (articleId) {
                    // Step 2: SAVE as Draft using 'draft_save' endpoint
                    sendUpdate('Rabbit: 下書きとして保存中 (Draft Save API)...');

                    const draftSaveUrl = `https://note.com/api/v1/text_notes/draft_save?id=${articleId}&is_temp_saved=true`;

                    const updateData: any = {
                        body: htmlContent,
                        body_length: htmlContent.length,
                        name: title,
                        index: false,
                        is_lead_form: false
                    };

                    if (eyecatchKey) {
                        updateData.eyecatch_image_key = eyecatchKey;
                        sendUpdate('Rabbit: アイキャッチ画像を紐付け中...');
                    }

                    const updateRes = await fetch(draftSaveUrl, {
                        method: 'POST',
                        headers: headers,
                        body: JSON.stringify(updateData)
                    });

                    if (!updateRes.ok) {
                        const err = await updateRes.text();
                        console.error("Rabbit: Draft Save Error:", err);
                        sendUpdate(`Rabbit: 【警告】下書き保存に失敗しました (${updateRes.status})`);
                    } else {
                        console.log("Rabbit: Draft Save Success");
                    }
                } else if (articleKey) {
                    // Fallback to legacy PUT
                    sendUpdate('Rabbit: 【警告】ID取得不可。旧APIで更新を試みます...');
                    const updateData = {
                        body: htmlContent,
                        name: title,
                        status: 'draft',
                        template_key: null
                    };

                    await fetch(`https://note.com/api/v1/text_notes/${articleKey}`, {
                        method: 'PUT',
                        headers: headers,
                        body: JSON.stringify(updateData)
                    });
                }

                sendUpdate(`Rabbit: 完了しました！ 下書きキー: ${articleKey}`);

                controller.enqueue(encoder.encode(`${JSON.stringify({ status: 'success', note_url: noteUrl })}\n`));
            } catch (error: any) {
                console.error("Rabbit Action Error:", error);
                controller.enqueue(encoder.encode(`${JSON.stringify({ error: error.message })}\n`));
            } finally {
                controller.close();
            }
        }
    });

    return new NextResponse(stream, { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' } });
}
