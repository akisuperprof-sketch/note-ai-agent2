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
            browser = await playwright.connectOverCDP(`wss://chrome.browserless.io?token=${BROWSERLESS_TOKEN}`, { timeout: 15000 });
        } else {
            browser = await playwright.launch({ headless: true });
        }

        const context = await browser.newContext();
        if (fs.existsSync(SESSION_FILE)) {
            const state = JSON.parse(fs.readFileSync(SESSION_FILE, 'utf-8'));
            await context.addCookies(state.cookies || []);
        }

        page = await context.newPage();
        update('S01_INIT (進行中)');
        await page.goto('https://note.com/notes/new', { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {
            console.warn("[Action] S01 navigation timed out, but proceeding to check if page loaded.");
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

                await page.goto('https://note.com/notes/new', { waitUntil: 'domcontentloaded', timeout: 10000 }).catch(() => { });
            } else {
                throw new Error("Login required but credentials not provided.");
            }
        }
        update('S02 (完了)');

        // Tutorial Bypass (Aggressive)
        update('S02b_MODAL (進行中)');
        try {
            await page.waitForTimeout(500);
            const overlaySelectors = ['button:has-text("次へ")', 'button:has-text("閉じる")', '.nc-tutorial-modal__close', 'div[aria-label="閉じる"]'];
            for (const sel of overlaySelectors) {
                const btn = page.locator(sel).first();
                if (await btn.isVisible()) {
                    await btn.click().catch(() => { });
                    await page.waitForTimeout(200);
                }
            }
        } catch (e) { }

        update('S03_解析 (進行中)');

        // Faster editor detection
        let editorFound = await page.waitForSelector('textarea[placeholder*="タイトル"], [role="textbox"]', { timeout: 8000 }).catch(() => null);

        if (!editorFound) {
            console.warn("[Action] Quick fallback for S03...");
            await page.keyboard.press('Escape');
            await page.mouse.click(500, 300).catch(() => { });
            await page.waitForTimeout(1000);
            editorFound = await page.waitForSelector('textarea, [role="textbox"]', { timeout: 4000 }).catch(() => null);
        }

        const bestSelectors = await page.evaluate(() => {
            const getSelector = (el: Element) => {
                const tid = el.getAttribute("data-testid") || el.getAttribute("data-test-id");
                if (tid) return `[data-testid="${tid}"]`;
                if (el.getAttribute("id")) return `#${el.getAttribute("id")}`;
                return null;
            };

            const titleEl = document.querySelector('textarea[placeholder*="タイトル"], h1[contenteditable="true"], [aria-label*="タイトル"]');
            const bodyEl = document.querySelector('div.ProseMirror[role="textbox"], .note-editor, [data-editor-type="article"], [aria-label*="本文"]');
            const saveBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent?.includes('下書き保存'));

            return {
                title: titleEl ? (getSelector(titleEl) || (titleEl.tagName === 'H1' ? 'h1[contenteditable="true"]' : 'textarea[placeholder*="タイトル"]')) : null,
                body: bodyEl ? (getSelector(bodyEl) || (bodyEl.classList.contains('ProseMirror') ? 'div.ProseMirror[role="textbox"]' : '.note-editor')) : null,
                save: saveBtn ? 'button:has-text("下書き保存")' : null
            };
        });

        console.log(`[Diagnostic] Final Selectors:`, bestSelectors);

        if (!bestSelectors.title || !bestSelectors.body) {
            const pageDump = await page.evaluate(() => {
                const inputs = Array.from(document.querySelectorAll('input, textarea, [contenteditable], [role="textbox"]'))
                    .map(el => ({
                        tag: el.tagName,
                        ph: el.getAttribute('placeholder'),
                        aria: el.getAttribute('aria-label'),
                        rect: el.getBoundingClientRect()
                    }));
                return {
                    url: window.location.href,
                    title: document.title,
                    text: document.body.innerText.substring(0, 200).replace(/\n/g, ' '),
                    inputs: inputs.filter(i => i.rect.width > 0).slice(0, 8)
                };
            });
            throw new Error(`入力欄が見つかりません(S03)。URL: ${page.url()} Dump: ${JSON.stringify(pageDump)}`);
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

        update('S04_タイトル記入 (進行中)');
        await forceInput(bestSelectors.title, content.title);
        update('S04 (完了)');

        update('S05_本文記入 (進行中)');
        await forceInput(bestSelectors.body, content.body, true);
        update('S05 (完了)');

        update('S06_保存ボタン (進行中)');
        if (bestSelectors.save) {
            console.log(`[Action] Clicking Save Draft button.`);
            await page.click(bestSelectors.save);
            await page.waitForTimeout(3000);
        } else {
            // Fallback for save button if selector was missed
            await page.click('button:has-text("下書き保存")').catch(() => { });
        }
        update('S06 (完了)');

        update('S07_完了待機 (進行中)');
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
        update('S07 (完了)');

        await page.waitForTimeout(3000);

        job.status = 'success';
        job.finished_at = new Date().toISOString();
        const finalUrl = page.url();
        job.note_url = finalUrl;

        // If it still says "/new", it means the post likely didn't persist as a draft with a unique ID
        if (finalUrl.endsWith('/new')) {
            throw new Error(`下書きURLの取得に失敗しました。現在のURL: ${finalUrl}`);
        }

        update('S99 (完了)');
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
