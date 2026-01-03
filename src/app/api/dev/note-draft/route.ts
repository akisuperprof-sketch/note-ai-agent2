import { NextRequest, NextResponse } from 'next/server';
import path from 'path';
import fs from 'fs';
import { chromium } from 'playwright-core';
import { getDevSettings, validateDevMode } from '@/lib/server/flags';

// --- Config ---
const isVercel = !!(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);
const BROWSERLESS_TOKEN = process.env.BROWSERLESS_API_KEY || process.env.BROWSERLESS_TOKEN;

const JOBS_DIR = isVercel ? path.join('/tmp', 'note-draft-jobs') : path.join(process.cwd(), '.gemini', 'note-draft-jobs');
const SESSION_FILE = isVercel ? path.join('/tmp', 'note-session.json') : path.join(process.cwd(), '.gemini', 'note-session.json');

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

function mdToHtml(md: string): string {
    return md.split('\n').map(line => {
        if (line.startsWith('# ')) return `<h1>${line.substring(2)}</h1>`;
        if (line.startsWith('## ')) return `<h2>${line.substring(3)}</h2>`;
        if (line.startsWith('> ')) return `<blockquote>${line.substring(2)}</blockquote>`;
        if (line.startsWith('- ')) return `<ul><li>${line.substring(2)}</li></ul>`;
        if (line.trim() === '') return '';
        return `<p>${line}</p>`;
    }).join('').replace(/\n/g, '');
}

export async function POST(req: NextRequest) {
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
        async start(controller) {
            const sendUpdate = (step: string) => { controller.enqueue(encoder.encode(`${JSON.stringify({ last_step: step })}\n`)); };
            const heartbeat = setInterval(() => { controller.enqueue(encoder.encode('\n')); }, 5000);
            try {
                const body = await req.json();
                const { title, body: noteBody, tags, scheduled_at, mode, visualDebug, email, password, request_id, article_id } = body;
                if (!validateDevMode(mode)) throw new Error(`Invalid mode: ${mode}`);

                const jobId = `job-${Date.now()}`;
                const job: NoteJob = {
                    job_id: jobId, article_id: article_id || 'unknown', request_id: request_id || 'unknown',
                    mode, status: 'pending', last_step: 'Initializing...', title, body: noteBody,
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
    return new NextResponse(stream, { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' } });
}

async function runNoteDraftAction(job: NoteJob, content: { title: string, body: string, tags?: string[], scheduled_at?: string, email?: string, password?: string, visualDebug?: boolean, mode?: string }, onUpdate: (step: string) => void) {
    job.status = 'running';
    let browser: any; let page: any;
    const update = async (stepId: string, stepName: string) => {
        let debug = "";
        try { if (page) { const u = page.url(); debug = ` URL ${u.substring(Math.max(0, u.length - 35))}`; } } catch (e) { }
        const fullStep = `${stepId} ${stepName}${debug}`;
        job.last_step = fullStep; saveJob(job); onUpdate(fullStep);
    };

    try {
        const VERSION = "2026-01-04-1330-STABLE-STEALTH-PRO";
        const envName = isVercel ? "SERVER" : "LOCAL_MAC";
        await update('S01', `Engine v${VERSION} ENV ${envName}`);

        if (isVercel && BROWSERLESS_TOKEN) {
            // Browserless Debugger URL をログに出す（お客様がクラウドの画面を直接見れるように）
            const sessionUrl = `https://chrome.browserless.io/debugger?token=${BROWSERLESS_TOKEN}`;
            await update('S01', `VISUAL DEBUG URL ${sessionUrl}`);
            browser = await chromium.connectOverCDP(`wss://chrome.browserless.io?token=${BROWSERLESS_TOKEN}&--shm-size=2gb&stealth`, { timeout: 35000 });
        } else {
            const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
            browser = await chromium.launch({
                headless: false,
                executablePath: fs.existsSync(chromePath) ? chromePath : undefined,
                args: ['--no-sandbox', '--disable-blink-features=AutomationControlled', '--start-maximized']
            });
        }

        const contextOptions: any = {
            userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
            viewport: { width: 1440, height: 900 }, locale: 'ja-JP', timezoneId: 'Asia/Tokyo',
            deviceScaleFactor: 2
        };
        if (fs.existsSync(SESSION_FILE)) contextOptions.storageState = SESSION_FILE;

        const context = await browser.newContext(contextOptions);
        const injectStealth = async (p: any) => {
            await p.addInitScript(() => {
                Object.defineProperty(navigator, 'webdriver', { get: () => false });
                (window as any).chrome = { runtime: {} };
                Object.defineProperty(navigator, 'languages', { get: () => ['ja-JP', 'ja', 'en-US', 'en'] });
                Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3] });
            });
        };

        page = await context.newPage(); await injectStealth(page);
        await page.setDefaultTimeout(40000);

        await update('S02', 'Approaching Note');
        await page.goto('https://note.com/', { waitUntil: 'domcontentloaded' }).catch(() => { });
        await page.waitForTimeout(4000);

        const loginCheck = await page.evaluate(() => {
            return !!document.querySelector('.nc-header__user-menu, .nc-header__profile, .nc-header__post-button');
        });

        if (!loginCheck) {
            await update('S03', 'Login Required');
            await page.goto('https://note.com/login', { waitUntil: 'networkidle' });
            if (content.email && content.password) {
                const selectors = {
                    email: 'input#email, input[name="email"]',
                    password: 'input#password, input[name="password"]',
                    submit: 'button:has-text("ログイン"), button[type="submit"]'
                };
                await page.waitForSelector(selectors.email, { timeout: 15000 });
                await page.fill(selectors.email, content.email);
                await page.fill(selectors.password, content.password);
                await page.click(selectors.submit);
                await Promise.race([
                    page.waitForURL((u: URL) => !u.href.includes('/login'), { timeout: 35000 }),
                    page.waitForSelector('.nc-header__user-menu, .nc-header__profile', { timeout: 35000 })
                ]);
                fs.writeFileSync(SESSION_FILE, JSON.stringify(await context.storageState()));
                await update('S03', 'Login Verified');
            } else { throw new Error("Credentials missing."); }
        }

        // --- S04: Editor Entry ---
        // 直接URLではなく、note.com経由のリダイレクトURLを使うことでセッションを安定させる
        const ENTRY_URL = 'https://note.com/notes/new';
        await update('S04', 'Going to Editor');
        await page.goto(ENTRY_URL, { waitUntil: 'domcontentloaded' }).catch(() => { });

        let hydrated = false;
        for (let i = 0; i < 15; i++) {
            const stats = await page.evaluate(() => {
                const tags = document.querySelectorAll('*').length;
                const body = document.body.innerText;
                return {
                    tags,
                    hasEditor: !!document.querySelector('.ProseMirror'),
                    isBlocked: body.includes('Access Denied') || body.includes('ロボットではありません')
                };
            }).catch(() => ({ tags: 0, hasEditor: false, isBlocked: false }));

            await update('S04', `SYNC ${i + 1}/15 TAGS ${stats.tags}${stats.isBlocked ? ' BLOCKED' : ''}`);

            if (stats.hasEditor) {
                await update('S04', 'HYDRATION DONE');
                hydrated = true; break;
            }

            if (stats.isBlocked || (stats.tags <= 50 && (i === 4 || i === 9))) {
                await update('S04', 'REBOOTING TAB');
                await page.close().catch(() => { });
                page = await context.newPage(); await injectStealth(page);
                await page.goto(ENTRY_URL, { waitUntil: 'load' }).catch(() => { });
                await page.waitForTimeout(3000);
            }
            await page.waitForTimeout(5000);
        }
        if (!hydrated) throw new Error("Editor hydration failed. Please check VISUAL DEBUG URL and solve challenges if any.");

        await update('S07', 'Injecting Content');
        const html = mdToHtml(content.body);
        await page.evaluate(({ t, b }: { t: string, b: string }) => {
            const titleEl = document.querySelector('textarea[placeholder*="タイトル"]') as any;
            const bodyEl = document.querySelector('.ProseMirror') as any;
            if (titleEl) {
                titleEl.focus(); titleEl.value = '';
                document.execCommand('insertText', false, t);
                titleEl.dispatchEvent(new Event('input', { bubbles: true }));
            }
            if (bodyEl) {
                bodyEl.focus();
                document.execCommand('selectAll', false, undefined); document.execCommand('delete', false, undefined);
                document.execCommand('insertHTML', false, b);
            }
        }, { t: content.title, b: html });

        await update('S10', 'Saving');
        await page.click('button:has-text("下書き保存")').catch(() => page.mouse.click(1240, 50));
        await page.waitForTimeout(6000);
        job.status = 'success'; job.note_url = page.url();
        await update('S99', 'Complete');
        saveJob(job); await browser.close(); return { status: 'success', note_url: job.note_url };
    } catch (e: any) {
        job.status = 'failed'; job.error_message = e.message;
        if (browser) {
            try {
                if (page) {
                    const buf = await page.screenshot({ type: 'png' });
                    job.error_screenshot = `data:image/png;base64,${buf.toString('base64')}`;
                    saveJob(job);
                }
            } catch (err) { }
            await browser.close();
        }
        throw e;
    }
}
