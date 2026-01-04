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
    // 資料のPython実装を参考に簡易変換
    // 実際にはもっとリッチな変換が必要かもしれないが、まずは疎通確認用
    let html = md;

    // 見出し (Note API対策: H1はタイトルとして別送されるため、本文内はH2以下にシフトするか削除)
    html = html.replace(/^# (.+)$/gm, ''); // H1は削除（タイトルと重複するため）
    html = html.replace(/^## (.+)$/gm, '<h3>$1</h3>'); // H2 -> H3
    html = html.replace(/^### (.+)$/gm, '<h4>$1</h4>'); // H3 -> H4

    // リスト
    html = html.replace(/^- (.+)$/gm, '<ul><li>$1</li></ul>');
    // Note: 連続するulを結合する処理が必要だが、まずは簡易実装

    // 強調
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');

    // 画像 (簡易)
    html = html.replace(/!\[(.*?)\]\((.*?)\)/g, '<figure><img src="$2" alt="$1"></figure>');

    // リンク
    html = html.replace(/\[(.*?)\]\((.*?)\)/g, '<a href="$2">$1</a>');

    // 段落
    // 空行で分割してpタグで囲む
    const paragraphs = html.split('\n\n');
    html = paragraphs.map(p => {
        const trimmed = p.trim();
        if (!trimmed) return '';
        if (trimmed.startsWith('<')) return trimmed; // 既にタグの場合はそのまま
        return `<p>${trimmed}</p>`;
    }).join('\n');

    // 最終的なHTMLが空にならないように
    if (!html) html = "<p>（本文なし）</p>";

    return html;
}

function getCookiesFromSession(): string | null {
    try {
        if (!fs.existsSync(SESSION_FILE)) return null;
        const data = JSON.parse(fs.readFileSync(SESSION_FILE, 'utf-8'));
        if (!data.cookies || !Array.isArray(data.cookies)) return null;

        // note.com のクッキーのみを抽出（念のため）
        // Playwrightのcookiesは { name, value, domain, ... }
        return data.cookies
            .map((c: any) => `${c.name}=${c.value}`)
            .join('; ');
    } catch (e) {
        console.error("Cookie Load Error:", e);
        return null;
    }
}

function getXsrfTokenFromSession(): string | null {
    try {
        if (!fs.existsSync(SESSION_FILE)) return null;
        const data = JSON.parse(fs.readFileSync(SESSION_FILE, 'utf-8'));
        if (!data.cookies || !Array.isArray(data.cookies)) return null;

        const tokenCookie = data.cookies.find((c: any) => c.name === 'XSRF-TOKEN');
        return tokenCookie ? tokenCookie.value : null;
    } catch (e) {
        return null; // Silent fail
    }
}

export async function POST(req: NextRequest) {
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
        async start(controller) {
            const sendUpdate = (step: string) => { controller.enqueue(encoder.encode(`${JSON.stringify({ last_step: step })}\n`)); };
            try {
                const body = await req.json();
                const { title, body: noteBody } = body;

                sendUpdate('Rabbit: Loading Session...');
                const cookieHeader = getCookiesFromSession();

                if (!cookieHeader) {
                    throw new Error("セッションファイルが見つかりません。一度通常モードでログインを完了させてください。");
                }

                sendUpdate('Rabbit: Converting Content...');
                console.log("Rabbit: Received Body Length:", noteBody?.length);
                console.log("Rabbit: Received Body Preview:", noteBody?.substring(0, 100));

                const htmlContent = mdToHtml(noteBody || "");
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
                    // Step 2: SAVE as Draft using 'draft_save' endpoint (Official Editor Method)
                    sendUpdate('Rabbit: Finalizing Draft (Draft Save API)...');

                    // Note: Browser sniff showed query params: draft_save?id=...&is_temp_saved=true
                    const draftSaveUrl = `https://note.com/api/v1/text_notes/draft_save?id=${articleId}&is_temp_saved=true`;

                    const updateData = {
                        body: htmlContent,
                        body_length: htmlContent.length,
                        name: title,
                        index: false,
                        is_lead_form: false
                    };

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
