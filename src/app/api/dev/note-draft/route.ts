import { NextRequest, NextResponse } from "next/server";
import { chromium as playwright } from "playwright-core";
import fs from "fs";
import path from "path";
import { DEV_SETTINGS, validateDevMode } from "@/lib/server/flags";
import { getAllJobs, saveJob, NoteJob } from "@/lib/server/jobs";

const isServerless = !!(process.env.VERCEL || process.env.AWS_EXECUTION_ENV || process.env.NODE_ENV === 'production');
const SESSION_FILE = isServerless
    ? path.join('/tmp', 'note_session.json')
    : path.join(process.cwd(), '.secret/note_session.json');
const LOG_DIR = isServerless
    ? path.join('/tmp', 'logs')
    : path.join(process.cwd(), '.gemini/data/logs');

export async function POST(req: NextRequest) {
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
        async start(controller) {
            const sendUpdate = (data: any) => {
                try {
                    controller.enqueue(encoder.encode(JSON.stringify(data) + "\n"));
                } catch (e) {
                    console.error("[Stream] Controller closed or error:", e);
                }
            };

            // Heartbeat to keep connection alive
            const heartbeat = setInterval(() => {
                sendUpdate({ type: 'heartbeat', time: Date.now() });
            }, 8000);

            try {
                const { article_id, title, body, mode, request_id, email, password } = await req.json();

                if (!validateDevMode(mode)) {
                    sendUpdate({ error: "Forbidden" });
                    clearInterval(heartbeat);
                    controller.close();
                    return;
                }

                const job: NoteJob = {
                    job_id: `job_${Date.now()}`,
                    article_id,
                    request_id,
                    mode: 'development',
                    status: 'running',
                    attempt_count: 1,
                    created_at: new Date().toISOString(),
                    started_at: new Date().toISOString(),
                    finished_at: null,
                    posted_at: null,
                    note_url: null,
                    error_code: null,
                    error_message: null,
                    last_step: 'S00_認証中'
                };

                sendUpdate({ status: 'running', last_step: job.last_step });

                await runNoteDraftAction(job, { title, body, email, password }, (step) => {
                    sendUpdate({ status: 'running', last_step: step });
                });

                sendUpdate({ status: 'success', note_url: job.note_url, last_step: 'S99 (完了)' });
                clearInterval(heartbeat);
                controller.close();
            } catch (e: any) {
                console.error("[Stream Error]:", e);
                sendUpdate({ error: e.message, status: 'failed', last_step: 'FATAL_ERROR' });
                clearInterval(heartbeat);
                controller.close();
            }
        }
    });

    return new Response(stream, {
        headers: {
            'Content-Type': 'application/x-ndjson',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
        },
    });
}

async function runNoteDraftAction(job: NoteJob, content: { title: string, body: string, email?: string, password?: string }, onUpdate: (step: string) => void) {
    job.status = 'running';
    job.started_at = new Date().toISOString();
    const update = (step: string) => {
        job.last_step = step;
        saveJob(job);
        onUpdate(step);
    };

    update('S00_認証中');
    let browser: any;
    let page: any;

    try {
        const BROWSERLESS_TOKEN = process.env.BROWSERLESS_API_KEY || process.env.BROWSERLESS_TOKEN;
        if (isServerless) {
            // Enhanced connection with stealth and shm-size flags
            browser = await playwright.connectOverCDP(`wss://chrome.browserless.io?token=${BROWSERLESS_TOKEN}&--shm-size=2gb&stealth`, { timeout: 15000 });
        } else {
            browser = await playwright.launch({ headless: true });
        }

        const context = await browser.newContext({
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            viewport: { width: 1280, height: 1000 },
            locale: 'ja-JP',
            timezoneId: 'Asia/Tokyo',
            extraHTTPHeaders: {
                'Accept-Language': 'ja-JP,ja;q=0.9,en-US;q=0.8,en;q=0.7'
            }
        });
        if (fs.existsSync(SESSION_FILE)) {
            const state = JSON.parse(fs.readFileSync(SESSION_FILE, 'utf-8'));
            await context.addCookies(state.cookies || []);
        }

        page = await context.newPage();
        await page.setDefaultTimeout(15000);
        update('S01_INIT (進行中)');
        // Direct editor access is faster and more stable
        await page.goto('https://editor.note.com/notes/new', { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {
            console.warn("[Action] S01 navigation timed out, but proceeding.");
        });
        update('S01 (完了)');

        if (page.url().includes('/login')) {
            console.log("[Action] Login starting...");
            update('S02_LOGIN (進行中)');
            if (content.email && content.password) {
                await page.waitForSelector('input[type="email"], input[name="mail"], #email', { timeout: 10000 });
                await page.fill('input[type="email"], input[name="mail"], #email', content.email);
                await page.fill('input[type="password"], input[name="password"]', content.password);

                const loginBtn = page.locator('button:has-text("ログイン"), button[type="submit"], .nc-login__submit-button').first();
                await loginBtn.click();

                try {
                    await page.waitForURL((u: URL) => !u.href.includes('/login'), { timeout: 10000 });
                    console.log(`[Action] Login successful. URL: ${page.url()}`);
                } catch (e) {
                    const errorText = await page.textContent('.nc-login__error, [role="alert"]').catch(() => null);
                    if (errorText) throw new Error(`ログインに失敗しました: ${errorText.trim()}`);
                    throw new Error("ログイン後の遷移がタイムアウトしました。");
                }

                const state = await context.storageState();
                if (!fs.existsSync(path.dirname(SESSION_FILE))) fs.mkdirSync(path.dirname(SESSION_FILE), { recursive: true });
                fs.writeFileSync(SESSION_FILE, JSON.stringify(state));

                // Step 2.5: Stabilize session by visiting main site first
                update('☕ セッションをブラウザに馴染ませています...');
                await page.goto('https://note.com/', { waitUntil: 'domcontentloaded', timeout: 10000 }).catch(() => { });
                await page.waitForTimeout(1000 + Math.random() * 500);

                // Now go to editor
                update('🚀 エディタ画面へ向かっています...');
                await page.goto('https://editor.note.com/notes/new', { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => { });
            } else {
                throw new Error("ログインが必要ですが、資格情報がありません。");
            }
        }
        update('✅ ログイン・アクセス完了');
        await page.waitForTimeout(500 + Math.random() * 500);

        // Tutorial Bypass (Aggressive)
        update('S02b_MODAL (進行中)');
        try {
            await page.waitForTimeout(800);
            const overlaySelectors = [
                'button:has-text("次へ")', 'button:has-text("閉じる")',
                'button:has-text("スキップ")', 'button:has-text("理解しました")',
                '.nc-tutorial-modal__close', 'div[aria-label="閉じる"]', '[aria-label="Close"]'
            ];
            for (const sel of overlaySelectors) {
                const btns = await page.locator(sel).all();
                for (const btn of btns) {
                    if (await btn.isVisible()) {
                        await btn.click().catch(() => { });
                        await page.waitForTimeout(300);
                    }
                }
            }
            // Click top-right corner as a last resort to close potential popups
            await page.mouse.click(1100, 100).catch(() => { });
        } catch (e) { }

        update('🔍 記事の入力場所を探しています...');

        // Wait for Note's SPA hydration
        await page.waitForTimeout(2000);

        // Patiently poll for elements (Note's editor is heavy)
        let editorFound = false;
        for (let i = 0; i < 6; i++) {
            // Skeleton Detection
            const tagCount = await page.evaluate(() => document.querySelectorAll('*').length);
            if (tagCount < 50 && i > 0) {
                update(`⏳ 画面がまだ準備中のようです... (タグ数:${tagCount})`);
                if (i === 2) {
                    update('🔄 一度画面をリフレッシュして様子を見ます');
                    await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => { });
                }
                if (i === 4) {
                    update('⚡ 強制的にエディタを呼び出します');
                    await page.goto('https://editor.note.com/notes/new', { waitUntil: 'domcontentloaded' }).catch(() => { });
                }
                await page.waitForTimeout(2000);
            }

            const el = await page.waitForSelector('textarea, [role="textbox"], .ProseMirror, .note-editor', { timeout: 4000 }).catch(() => null);
            if (el && await el.isVisible()) {
                await page.waitForTimeout(1000 + Math.random() * 500); // React hydration buffer
                editorFound = true;
                break;
            }
            update(`👀 読み込みを待っています... (${i + 1}/6回目)`);

            if (i === 1) await page.mouse.click(600, 400).catch(() => { });
            if (i === 3) await page.keyboard.press('Escape');
        }

        const bestSelectors = await page.evaluate(() => {
            const getSelector = (el: Element) => {
                const tid = el.getAttribute("data-testid") || el.getAttribute("data-test-id");
                if (tid) return `[data-testid="${tid}"]`;
                return null;
            };

            // Aggressive search for anything that looks like title/body
            const titleCandidates = [
                'textarea[placeholder*="タイトル"]', 'textarea[placeholder*="Title"]',
                'h1[contenteditable="true"]', '[data-testid="note-title"]',
                'textarea' // Last resort: the first textarea
            ];
            const bodyCandidates = [
                'div.ProseMirror[role="textbox"]', '.note-editor',
                '[data-editor-type="article"]', '[aria-label*="本文"]',
                '[role="textbox"]' // Last resort
            ];

            let titleEl = null;
            for (const sel of titleCandidates) {
                titleEl = document.querySelector(sel);
                if (titleEl) break;
            }

            let bodyEl = null;
            for (const sel of bodyCandidates) {
                bodyEl = document.querySelector(sel);
                if (bodyEl) break;
            }

            const saveBtn = Array.from(document.querySelectorAll('button')).find(b =>
                b.textContent?.includes('下書き保存') || b.textContent?.includes('Save draft') || b.textContent?.includes('完了')
            );

            return {
                title: titleEl ? (getSelector(titleEl) || (titleEl.tagName === 'H1' ? 'h1[contenteditable="true"]' : 'textarea')) : null,
                body: bodyEl ? (getSelector(bodyEl) || (bodyEl.classList.contains('ProseMirror') ? 'div.ProseMirror[role="textbox"]' : '.note-editor')) : null,
                save: saveBtn ? 'button:has-text("下書き保存")' : null
            };
        });

        console.log(`[Diagnostic] Final Selectors:`, bestSelectors);

        if (!bestSelectors.title || !bestSelectors.body) {
            if (fs.existsSync(SESSION_FILE)) fs.unlinkSync(SESSION_FILE);
            const diag = await page.evaluate(() => ({
                len: document.body.innerText.length,
                tags: document.querySelectorAll('*').length,
                title: document.title
            }));
            throw new Error(`解析失敗(S03)。状況: ${JSON.stringify(diag)} URL: ${page.url().substring(0, 40)}`);
        }

        update('S03 (完了)');

        const forceInput = async (selector: string, text: string, isBody: boolean = false) => {
            const el = page.locator(selector).first();
            await el.scrollIntoViewIfNeeded();
            await el.click();
            await page.waitForTimeout(500);

            // Use execCommand as primary for rich text, or direct manipulation as fallback
            await page.evaluate(({ sel, txt, bodyMode }: { sel: string, txt: string, bodyMode: boolean }) => {
                const element = document.querySelector(sel) as any;
                if (!element) return;

                element.focus();
                // Try execCommand first (better for React/ProseMirror state)
                try {
                    document.execCommand('selectAll', false);
                    document.execCommand('insertText', false, txt);
                } catch (e) {
                    if (bodyMode) {
                        element.innerHTML = `<p>${txt}</p>`;
                    } else {
                        element.value = txt;
                    }
                }

                element.dispatchEvent(new Event('input', { bubbles: true }));
                element.dispatchEvent(new Event('change', { bubbles: true }));
            }, { sel: selector, txt: text, bodyMode: isBody });

            // Trigger possible auto-save triggers in React
            await page.keyboard.press('End');
            await page.keyboard.press('Space');
            await page.keyboard.press('Backspace');
        };

        update('✍️ タイトルを丁寧に書き込んでいます...');
        await forceInput(bestSelectors.title, content.title);
        await page.waitForTimeout(500 + Math.random() * 500);

        update('📄 本文を流し込んで記事の形を整えています...');
        await forceInput(bestSelectors.body, content.body, true);
        await page.waitForTimeout(800 + Math.random() * 500);

        update('💾 大切な下書きとして保存しています...');
        if (bestSelectors.save) {
            console.log(`[Action] Clicking Save Draft button.`);
            await page.click(bestSelectors.save);
            await page.waitForTimeout(3000);
        } else {
            // Fallback for save button if selector was missed
            await page.click('button:has-text("下書き保存")').catch(() => { });
        }
        update('✨ 保存が完了しました');

        update('🏁 最終確認を行っています...');
        console.log(`[Action] Waiting for URL transition. Current: ${page.url()}`);

        try {
            // New editor is on editor.note.com, old one on note.com
            await page.waitForURL((u: URL) => {
                const h = u.href;
                return (h.includes('/edit') || h.includes('/notes/n')) && !h.endsWith('/new');
            }, { timeout: 20000 });
            console.log(`[Action] Save detected: ${page.url()}`);
        } catch (e) {
            console.warn(`[Action] URL transition timeout. Final URL: ${page.url()}`);
        }

        await page.waitForTimeout(2000);

        job.status = 'success';
        job.finished_at = new Date().toISOString();
        const finalUrl = page.url();
        job.note_url = finalUrl;

        // If it still says "/new", it means the post likely didn't persist as a draft with a unique ID
        if (finalUrl.endsWith('/new')) {
            throw new Error(`下書き保存は完了しましたが、URLの特定に失敗しました。現在のURL: ${finalUrl}`);
        }

        update('🎉 すべての作業が正常に完了しました！');
        saveJob(job); // Final save after all updates

        await browser.close();
        return { status: 'success', job_id: job.job_id, note_url: job.note_url, last_step: job.last_step };

    } catch (e: any) {
        job.status = 'failed';
        job.error_code = 'STEP_FAILED';
        job.error_message = e.message;
        job.finished_at = new Date().toISOString();
        saveJob(job); // Save job with error details
        try {
            if (page) {
                if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
                await page.screenshot({ path: path.join(LOG_DIR, `${job.last_step || 'FATAL'}_fail.png`) });
            }
        } catch (screenshotError) {
            console.error("Failed to take screenshot on error:", screenshotError);
        }
        if (browser) await browser.close();
        throw e; // Re-throw to be caught by the POST handler
    }
}
