import { NextRequest, NextResponse } from 'next/server';
import path from 'path';
import fs from 'fs';
import { chromium } from 'playwright-core';
import { getDevSettings, validateDevMode } from '@/lib/server/flags';

// --- Config ---
const isServerless = !!(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.BROWSERLESS_API_KEY || process.env.BROWSERLESS_TOKEN);

const JOBS_DIR = isServerless
    ? path.join('/tmp', 'note-draft-jobs')
    : path.join(process.cwd(), '.gemini', 'note-draft-jobs');

const SESSION_FILE = isServerless
    ? path.join('/tmp', 'note-session.json')
    : path.join(process.cwd(), '.gemini', 'note-session.json');

type NoteJob = {
    job_id: string; article_id: string; request_id: string;
    mode: string; status: 'pending' | 'running' | 'success' | 'failed';
    last_step: string; title: string; body: string;
    tags: string[]; scheduled_at: string | null;
    note_url?: string; error_message?: string; error_screenshot?: string;
    started_at: string; finished_at?: string;
};

function saveJob(job: NoteJob) {
    try {
        const dir = path.dirname(path.join(JOBS_DIR, `${job.job_id}.json`));
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(JOBS_DIR, `${job.job_id}.json`), JSON.stringify(job, null, 2));
    } catch (e) { console.error("Job Save Error:", e); }
}

export async function POST(req: NextRequest) {
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
        async start(controller) {
            const sendUpdate = (step: string) => {
                controller.enqueue(encoder.encode(`${JSON.stringify({ last_step: step })}\n`));
            };
            const heartbeat = setInterval(() => { controller.enqueue(encoder.encode('\n')); }, 5000);

            try {
                const body = await req.json();
                const { title, body: noteBody, tags, scheduled_at, mode, visualDebug, email, password, request_id, article_id } = body;

                sendUpdate("Connection Established");
                if (!validateDevMode(mode)) throw new Error(`Invalid mode: ${mode}`);

                const jobId = `job-${Date.now()}`;
                const job: NoteJob = {
                    job_id: jobId, article_id: article_id || 'unknown', request_id: request_id || 'unknown',
                    mode, status: 'pending', last_step: 'Initializing Engine...', title, body: noteBody,
                    tags: tags || [], scheduled_at: scheduled_at || null, started_at: new Date().toISOString(),
                };

                saveJob(job);
                sendUpdate(`Job Created: ${jobId}`);

                const result = await runNoteDraftAction(job, {
                    title, body: noteBody, tags, scheduled_at,
                    email: email || process.env.NOTE_EMAIL,
                    password: password || process.env.NOTE_PASSWORD,
                    visualDebug, mode
                }, sendUpdate);

                controller.enqueue(encoder.encode(`${JSON.stringify({ status: 'success', job_id: jobId, note_url: result.note_url })}\n`));
            } catch (error: any) {
                console.error("Action Error:", error);
                controller.enqueue(encoder.encode(`${JSON.stringify({ error: error.message })}\n`));
            } finally {
                clearInterval(heartbeat);
                controller.close();
            }
        }
    });

    return new NextResponse(stream, {
        headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' },
    });
}

// --- Main Engine ---
async function runNoteDraftAction(job: NoteJob, content: { title: string, body: string, tags?: string[], scheduled_at?: string, email?: string, password?: string, visualDebug?: boolean, mode?: string }, onUpdate: (step: string) => void) {
    job.status = 'running';
    const update = (stepId: string, stepName: string) => {
        const fullStep = `${stepId}: ${stepName}`;
        job.last_step = fullStep;
        saveJob(job);
        onUpdate(fullStep);
    };

    let browser: any;
    let page: any;

    try {
        const VERSION = "2026-01-04-0655-AUTH-VERIFY";
        update('S01', `Engine v${VERSION}`);

        const settings = getDevSettings();
        const BROWSERLESS_TOKEN = process.env.BROWSERLESS_API_KEY || process.env.BROWSERLESS_TOKEN;
        const isHeadless = content.visualDebug ? false : !settings.VISUAL_DEBUG;

        if (isServerless) {
            browser = await chromium.connectOverCDP(`wss://chrome.browserless.io?token=${BROWSERLESS_TOKEN}&--shm-size=2gb&stealth`, { timeout: 25000 });
        } else {
            browser = await chromium.launch({ headless: isHeadless, args: ['--no-sandbox', '--disable-blink-features=AutomationControlled'] });
        }

        const contextOptions: any = {
            userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
            viewport: { width: 1440, height: 900 },
            locale: 'ja-JP', timezoneId: 'Asia/Tokyo'
        };

        if (fs.existsSync(SESSION_FILE)) contextOptions.storageState = SESSION_FILE;

        const context = await browser.newContext(contextOptions);
        page = await context.newPage();

        await page.setDefaultTimeout(35000);
        update('S02', 'Accessing note.com');
        await page.goto('https://note.com/', { waitUntil: 'load' }).catch(() => { });
        await page.waitForTimeout(4000);

        // --- S03: Authentication (Strict Verification) ---
        const loggedInSelector = '.nc-header__user-menu, .nc-header__profile, a[href="/notes/new"]';
        let isGuest = await page.evaluate((sel) => !document.querySelector(sel), loggedInSelector);

        if (isGuest || page.url().includes('/login')) {
            update('S03', `Initial State: Guest. URL: ${page.url()}`);
            if (!page.url().includes('/login')) await page.goto('https://note.com/login', { waitUntil: 'load' });

            if (content.email && content.password) {
                await page.fill('input#email', content.email);
                await page.fill('input#password', content.password);
                const btn = page.locator('button[data-type="primaryNext"], button:has-text("ログイン"), .o-login__submit').first();
                await btn.click({ force: true });

                update('S03', 'Waiting for Login Success Verification...');
                // 1. URLが変わるのを待つ
                await page.waitForURL((u: URL) => !u.href.includes('/login'), { timeout: 25000 });
                // 2. ログイン後のみ出現する要素の存在を確認して「真の成功」を判定
                try {
                    await page.waitForSelector(loggedInSelector, { timeout: 15000 });
                    update('S03', 'Login Verified (Profile/Post button found).');
                } catch (e) {
                    throw new Error("Login failed or was blocked by CAPTCHA/Bot protection (Profile icon not found).");
                }

                // セッション定着のための小休止
                await page.waitForTimeout(3000);
                const fullState = await context.storageState();
                fs.writeFileSync(SESSION_FILE, JSON.stringify(fullState));
            } else { throw new Error("Credentials missing"); }
        } else {
            update('S03', 'Already Logged In.');
        }

        // --- S04: Editor Entry ---
        update('S04', 'Opening Editor Canvas...');
        await page.goto('https://note.com/notes/new', { waitUntil: 'domcontentloaded' }).catch(() => { });

        let editorBound = false;
        for (let i = 0; i < 6; i++) {
            const url = page.url();
            const tags = await page.evaluate(() => document.querySelectorAll('*').length).catch(() => 0);
            const hasEditor = await page.evaluate(() => !!document.querySelector('.ProseMirror'));
            const title = await page.title().catch(() => 'No Title');

            // ログの形式を修正: TagsとURLが確実に見えるように
            update('S04', `Sync ${i + 1}/6: [Tags:${tags}] [URL:${url.substring(0, 50)}] (${title})`);

            // 成功条件
            if (tags > 180 && (hasEditor || url.includes('editor.note.com'))) {
                update('S04', 'Hydration confirmed.');
                editorBound = true;
                break;
            }

            if (tags < 100) {
                if (i === 2) {
                    update('S04', 'Stall detected. Hard Reloading...');
                    await page.goto('https://note.com/notes/new', { waitUntil: 'load' }).catch(() => { });
                } else {
                    // もしnote.comのトップに戻されていたら、手動でログインボタンや作成ボタンを探してみる
                    if (url === 'https://note.com/') {
                        update('S04', 'Redirected to home. Attempting Rescue Click...');
                        await page.click('a[href="/notes/new"], .nc-header__post-button').catch(() => { });
                    }
                    await page.mouse.click(720, 450).catch(() => { });
                    await page.keyboard.press('Escape').catch(() => { });
                }
            }
            await page.waitForTimeout(5000);
        }

        if (!editorBound) throw new Error(`Editor failed to load. Likely login was insufficient. Final Tags:${await page.evaluate(() => document.querySelectorAll('*').length).catch(() => 0)}`);

        // --- S05 ~ S10: Execution ---
        update('S05', 'Bypassing Overlays...');
        await page.evaluate(() => {
            const skip = ["次へ", "閉じる", "スキップ", "理解しました", "OK", "×"];
            document.querySelectorAll('button, div[role="button"], span').forEach((el: any) => {
                if (skip.some(t => el.textContent?.includes(t) || el.getAttribute('aria-label')?.includes(t))) el.click();
            });
            document.querySelectorAll('.nc-modal, .nc-popover, .nc-modal-backdrop, [class*="modal"]').forEach(el => el.remove());
        }).catch(() => { });
        await page.waitForTimeout(2000);

        update('S07', 'Injecting Content into Red/Blue Boxes...');
        await page.evaluate(({ t, b }: { t: string, b: string }) => {
            const titleEl = document.querySelector('textarea[placeholder*="タイトル"]') as HTMLTextAreaElement;
            const bodyEl = document.querySelector('.ProseMirror') as HTMLElement;

            if (titleEl) {
                titleEl.focus();
                titleEl.value = '';
                document.execCommand('insertText', false, t);
                titleEl.dispatchEvent(new Event('input', { bubbles: true }));
            }

            if (bodyEl) {
                bodyEl.focus();
                document.execCommand('selectAll', false, undefined);
                document.execCommand('delete', false, undefined);
                document.execCommand('insertText', false, b);
                bodyEl.dispatchEvent(new Event('input', { bubbles: true }));
            }
        }, { t: content.title, b: content.body });

        update('S10', 'Finalizing...');
        await page.click('button:has-text("下書き保存")').catch(() => page.mouse.click(1240, 50));
        await page.waitForTimeout(5000);

        job.status = 'success';
        job.note_url = page.url();
        update('S99', 'Note Drafted Successfully.');
        saveJob(job);
        await browser.close();
        return { status: 'success', note_url: job.note_url };

    } catch (e: any) {
        job.status = 'failed'; job.error_message = e.message;
        if (page) {
            const buf = await page.screenshot({ type: 'png' }).catch(() => null);
            if (buf) job.error_screenshot = `data:image/png;base64,${buf.toString('base64')}`;
        }
        saveJob(job); if (browser) await browser.close();
        throw e;
    }
}
