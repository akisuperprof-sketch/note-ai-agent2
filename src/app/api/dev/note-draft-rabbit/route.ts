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
    html = html.replace(/^> ?【?目次】?.*$/gm, ''); // 引用形式の目次行を削除
    html = html.replace(/^## ?目次.*$/gm, '');      // H2形式の目次行を削除
    html = html.replace(/^\*\*目次\*\*.*$/gm, '');  // 太字形式の目次行を削除

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

    // 6. 目次生成 (TOC)
    // H2の見出しを抽出
    const toc: string[] = [];
    let h2Count = 0;
    // 見出し置換時にアンカーも埋め込むことは難しい（noteはid属性を削除する傾向がある）が、
    // 目次リスト自体をテキストとして冒頭に置くことは可能。
    // ここでは、noteの機能としての目次が発動しやすくなるよう、きれいな構造を作ることに専念します。
    // ※自前でHTML目次を作っても、noteエディタでIDが消されるためリンクが機能しないことが多い。
    // 代わりに「目次」というセクションを明示的に作ることで、ユーザー体験を向上させます。

    // 7. 見出し (Note API対策: H1は削除, H2->H3, H3->H4)
    html = html.replace(/^# (.+)$/gm, ''); // H1は削除
    html = html.replace(/^## (.+)$/gm, (match, title) => {
        h2Count++;
        toc.push(`<li>${title}</li>`);
        return `<h3>${title}</h3>`;
    });
    html = html.replace(/^### (.+)$/gm, '<h4>$1</h4>'); // H3 -> H4

    // 目次挿入 (記事の冒頭、最初のH3の前あたりに挿入したいが、単純に先頭に追加)
    if (toc.length > 0) {
        const tocHtml = `<div class="toc"><strong>目次</strong><ul>${toc.join('')}</ul></div><hr>`;
        // 最初のH3の前に入れるのが理想的
        const firstH3Index = html.indexOf('<h3>');
        if (firstH3Index !== -1) {
            html = html.substring(0, firstH3Index) + tocHtml + html.substring(firstH3Index);
        } else {
            html = tocHtml + html;
        }
    }

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
                sendUpdate('Rabbit: Loading Session...');

                const { title, body: noteBody, imageUrl } = await req.json();
                const cookieHeader = getCookiesFromSession();

                if (!cookieHeader) {
                    throw new Error("セッションが見つかりません。通常モードでログインするか、環境変数 NOTE_SESSION_JSON を設定してください。");
                }

                sendUpdate('Rabbit: Converting Content...');
                console.log("Rabbit: Received Body Length:", noteBody?.length);
                console.log("Rabbit: Received Body Preview:", noteBody?.substring(0, 100));

                let htmlContent = mdToHtml(noteBody || "");
                console.log("Rabbit: Converted HTML Length:", htmlContent.length);
                console.log("Rabbit: Converted HTML Preview:", htmlContent.substring(0, 100));

                sendUpdate('Rabbit: Sending API Request...');

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
                    sendUpdate('Rabbit: Checking Login Status...');
                    const statusRes = await fetch('https://note.com/api/v2/login/status', { headers });
                    if (!statusRes.ok) {
                        console.warn(`Rabbit: Login Check HTTP ${statusRes.status}`);
                    } else {
                        const contentType = statusRes.headers.get("content-type");
                        if (contentType && contentType.includes("application/json")) {
                            const statusData = await statusRes.json();
                            const userNickname = statusData.data?.user?.nickname || "Unknown";
                            sendUpdate(`Rabbit: Logged in as ${userNickname}`);
                        } else {
                            console.warn("Rabbit: Login Check returned non-JSON");
                        }
                    }
                } catch (e) {
                    console.error("Rabbit: Login Check Failed (Skipping)", e);
                    sendUpdate('Rabbit: Login Status Skipped (Error)');
                }

                // Detailed Logging for Debugging
                const bodyLen = noteBody?.length || 0;
                sendUpdate(`Rabbit: Body Len: ${bodyLen}, HTML Len: ${htmlContent.length}`);
                sendUpdate(`Rabbit: HTML Preview: ${htmlContent.substring(0, 50)}...`);

                // --- Image Logic (Inline Embedding Strategy) ---
                // API upload failed (404/403), so we embed the image directly into the HTML as a fallback.
                // Note: note.com editor often auto-fetches this URL when saved as draft involved external images.
                let eyecatchKey: string | null = null;

                if (imageUrl) {
                    sendUpdate('Rabbit: Embedding Image to Body (Inline Fallback)...');
                    // Prepend image to HTML (Header Image Style)
                    htmlContent = `<figure><img src="${imageUrl}" alt="header_image"></figure>\n\n` + htmlContent;
                    sendUpdate('Rabbit: Image embedded at the top of content.');
                } else {
                    sendUpdate('Rabbit: No Image URL provided.');
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
                    sendUpdate('Rabbit: Finalizing Draft (Draft Save API)...');

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
                        sendUpdate('Rabbit: Attaching Eyecatch Image...');
                    }

                    const updateRes = await fetch(draftSaveUrl, {
                        method: 'POST',
                        headers: headers,
                        body: JSON.stringify(updateData)
                    });

                    if (!updateRes.ok) {
                        const err = await updateRes.text();
                        console.error("Rabbit: Draft Save Error:", err);
                        sendUpdate(`Rabbit: Warning - Draft content save failed (${updateRes.status})`);
                    } else {
                        console.log("Rabbit: Draft Save Success");
                    }
                } else if (articleKey) {
                    // Fallback to legacy PUT
                    sendUpdate('Rabbit: Warning - No Numeric ID. Attempting legacy PUT...');
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

                sendUpdate(`Rabbit: Success! Draft Key: ${articleKey}`);

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
