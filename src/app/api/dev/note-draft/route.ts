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

// Simple Markdown to HTML converter for insertHTML
function mdToHtml(md: string): string {
    return md
        .split('\n')
        .map(line => {
            if (line.startsWith('# ')) return `<h1>${line.substring(2)}</h1>`;
            if (line.startsWith('## ')) return `<h2>${line.substring(3)}</h2>`;
            if (line.startsWith('> ')) return `<blockquote>${line.substring(2)}</blockquote>`;
            if (line.startsWith('- ')) return `<ul><li>${line.substring(2)}</li></ul>`;
            if (line.trim() === '') return '';
            return `<p>${line}</p>`;
        })
        .join('')
        .replace(/\n/g, ''); // Must be one line to avoid SyntaxError
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
        const VERSION = "2026-01-04-0650-PROCEDURE-PROTOCOL";
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

        // --- S03: Authentication ---
        const loggedInSelector = '.nc-header__user-menu, .nc-header__profile, .nc-header__post-button';
        let isGuest = await page.evaluate((sel: string) => !document.querySelector(sel), loggedInSelector);

        if (isGuest || page.url().includes('/login')) {
            update('S03', 'Auth Triggered.');
            if (!page.url().includes('/login')) await page.goto('https://note.com/login', { waitUntil: 'load' });

            if (content.email && content.password) {
                await page.fill('input#email', content.email);
                await page.fill('input#password', content.password);
                await page.click('button[data-type="primaryNext"], button:has-text("ログイン")');
                await page.waitForURL((u: URL) => !u.href.includes('/login'), { timeout: 25000 });
                await page.waitForSelector(loggedInSelector, { timeout: 15000 }).catch(() => { });

                const fullState = await context.storageState();
                fs.writeFileSync(SESSION_FILE, JSON.stringify(fullState));
                update('S03', 'Login success.');
            } else { throw new Error("Auth required but credentials missing"); }
        }

        // --- S04: Editor Entry via "Procedure Manual" Protocol ---
        update('S04', 'Entering Editor Canvas...');
        if (!page.url().includes('editor.note.com')) {
            // 手順書に則り、トップからの遷移を試みる
            await page.click('.nc-header__post-button').catch(() => { });
            await page.click('a[href*="/notes/new"], span:has-text("テキスト")').catch(() => { });
            // フォールバック
            if (!page.url().includes('editor.note.com')) {
                await page.goto('https://note.com/notes/new', { waitUntil: 'domcontentloaded' }).catch(() => { });
            }
        }

        let editorBound = false;
        for (let i = 0; i < 8; i++) {
            const tags = await page.evaluate(() => document.querySelectorAll('*').length).catch(() => 0);
            const hasEditor = await page.evaluate(() => !!document.querySelector('.ProseMirror'));
            update('S04', `Sync ${i + 1}/8: [Tags:${tags}] [URL:${page.url().substring(0, 40)}]`);

            if (tags > 180 && hasEditor) {
                update('S04', 'Hydration Complete.');
                editorBound = true;
                break;
            }

            if (tags < 100) {
                if (i === 3) await page.reload({ waitUntil: 'load' }).catch(() => { });
                await page.mouse.click(720, 450).catch(() => { });
                await page.keyboard.press('Escape').catch(() => { });
            }
            await page.waitForTimeout(4000);
        }

        if (!editorBound) throw new Error("Editor hydration failed.");

        // --- S100: Final Content Injection (Referencing Manual) ---
        update('S05', 'Clearing Overlays...');
        await page.evaluate(() => {
            document.querySelectorAll('.nc-modal, .nc-popover, .nc-modal-backdrop, [class*="modal"]').forEach(el => el.remove());
        }).catch(() => { });

        update('S07', 'Injecting via insertHTML Protocol...');
        const bodyHtml = mdToHtml(content.body);

        await page.evaluate(({ t, b }: { t: string, b: string }) => {
            // 赤枠: タイトル
            const titleEl = document.querySelector('textarea[placeholder*="タイトル"]') as HTMLTextAreaElement;
            if (titleEl) {
                titleEl.focus();
                titleEl.value = '';
                document.execCommand('insertText', false, t);
                titleEl.dispatchEvent(new Event('input', { bubbles: true }));
            }
            // 青枠: 本文
            const bodyEl = document.querySelector('.ProseMirror') as HTMLElement;
            if (bodyEl) {
                // 手順書 Step 2: フォーカスして全削除
                bodyEl.focus();
                document.execCommand('selectAll', false, undefined);
                document.execCommand('delete', false, undefined);
                // 手順書 Step 2: insertHTML で投入
                document.execCommand('insertHTML', false, b);
            }
        }, { t: content.title, b: bodyHtml });

        update('S10', 'Saving Draft.');
        await page.click('button:has-text("下書き保存")').catch(() => page.mouse.click(1240, 50));
        await page.waitForTimeout(5000);

        job.status = 'success'; job.note_url = page.url();
        update('S99', 'Success.');
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
