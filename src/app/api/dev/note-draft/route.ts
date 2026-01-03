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
        .replace(/\n/g, '');
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
    let browser: any;
    let page: any;

    const update = async (stepId: string, stepName: string) => {
        let urlInfo = "";
        if (page) {
            try {
                const u = page.url();
                urlInfo = u && u !== 'about:blank' ? ` [URL:${u.substring(u.length - 35)}]` : " [URL:Loading...]";
            } catch (e) { urlInfo = " [URL:Pending]"; }
        }
        const fullStep = `${stepId}: ${stepName}${urlInfo}`;
        job.last_step = fullStep;
        saveJob(job);
        onUpdate(fullStep);
    };

    try {
        const VERSION = "2026-01-04-0700-FINAL-STEALTH-SYNC";
        await update('S01', `Engine v${VERSION}`);

        const settings = getDevSettings();
        const BROWSERLESS_TOKEN = process.env.BROWSERLESS_API_KEY || process.env.BROWSERLESS_TOKEN;
        const isHeadless = content.visualDebug ? false : !settings.VISUAL_DEBUG;

        if (isServerless) {
            browser = await chromium.connectOverCDP(`wss://chrome.browserless.io?token=${BROWSERLESS_TOKEN}&--shm-size=2gb&stealth`, { timeout: 30000 });
        } else {
            browser = await chromium.launch({ headless: isHeadless, args: ['--no-sandbox', '--disable-blink-features=AutomationControlled'] });
        }

        const contextOptions: any = {
            userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
            viewport: { width: 1440, height: 900 },
            locale: 'ja-JP', timezoneId: 'Asia/Tokyo'
        };

        if (fs.existsSync(SESSION_FILE)) contextOptions.storageState = SESSION_FILE;

        const context = await browser.newContext(contextOptions);

        // Stealth Injection
        await context.addInitScript(() => {
            Object.defineProperty(navigator, 'webdriver', { get: () => false });
        });

        page = await context.newPage();
        await page.setDefaultTimeout(40000);

        await update('S02', 'Navigating to note.com');
        await page.goto('https://note.com/', { waitUntil: 'domcontentloaded' }).catch(() => { });
        await page.waitForTimeout(3000);

        // --- S03: Authentication ---
        const loginCheck = await page.evaluate(() => !!document.querySelector('.nc-header__user-menu, .nc-header__profile, .nc-header__post-button'));

        if (!loginCheck || page.url().includes('/login')) {
            await update('S03', 'Authentication Required');
            if (!page.url().includes('/login')) await page.goto('https://note.com/login', { waitUntil: 'networkidle' });

            if (content.email && content.password) {
                await page.fill('input#email', content.email);
                await page.fill('input#password', content.password);
                await page.click('button[data-type="primaryNext"], button:has-text("ログイン")');
                await page.waitForURL((u: URL) => !u.href.includes('/login'), { timeout: 30000 });
                await page.waitForTimeout(4000); // ログイン後のセッション安定待ち

                const fullState = await context.storageState();
                fs.writeFileSync(SESSION_FILE, JSON.stringify(fullState));
                await update('S03', 'Login Successful');
            } else { throw new Error("Credentials required"); }
        }

        // --- S04: Editor Entry (The Critical Bridge) ---
        await update('S04', 'Directing to Editor...');
        // 手順書の「投稿ボタン」も試すが、失敗を見越して goto に 30s タイムアウトを設定
        await page.goto('https://note.com/notes/new', { waitUntil: 'domcontentloaded', timeout: 35000 }).catch(() => { });

        let hydrated = false;
        for (let i = 0; i < 10; i++) {
            const stats = await page.evaluate(() => {
                return {
                    tags: document.querySelectorAll('*').length,
                    hasEditor: !!document.querySelector('.ProseMirror'),
                    url: window.location.href
                };
            }).catch(() => ({ tags: 0, hasEditor: false, url: '' }));

            await update('S04', `Sync ${i + 1}/10: [Tags:${stats.tags}]`);

            if (stats.tags > 180 && stats.hasEditor) {
                await update('S04', 'Hydration Confirmed');
                hydrated = true;
                break;
            }

            if (stats.tags < 100) {
                if (i === 3) {
                    await update('S04', 'Attempting Force Jump...');
                    await page.goto('https://editor.note.com/notes/new', { waitUntil: 'load' }).catch(() => { });
                } else if (i % 2 === 0) {
                    await page.mouse.click(720, 10).catch(() => { }); // ヘッダー付近をクリックして刺激
                    await page.keyboard.press('Escape').catch(() => { });
                }
            }
            await page.waitForTimeout(4000);
        }

        if (!hydrated) throw new Error("Editor hydration failed. Stuck in skeleton state.");

        // --- S100: Final Content Injection ---
        await update('S05', 'Clearing Overlays...');
        await page.evaluate(() => {
            document.querySelectorAll('.nc-modal, .nc-popover, .nc-modal-backdrop, [class*="modal"]').forEach(el => el.remove());
        }).catch(() => { });

        await update('S07', 'Injecting Content (insertHTML Strategy)');
        const html = mdToHtml(content.body);

        await page.evaluate(({ t, b }: { t: string, b: string }) => {
            const titleEl = document.querySelector('textarea[placeholder*="タイトル"]') as HTMLTextAreaElement;
            const bodyEl = document.querySelector('.ProseMirror') as HTMLElement;

            if (titleEl) {
                titleEl.focus(); titleEl.value = '';
                document.execCommand('insertText', false, t);
                titleEl.dispatchEvent(new Event('input', { bubbles: true }));
            }
            if (bodyEl) {
                bodyEl.focus();
                document.execCommand('selectAll', false, undefined);
                document.execCommand('delete', false, undefined);
                document.execCommand('insertHTML', false, b);
            }
        }, { t: content.title, b: html });

        await update('S10', 'Finalizing Draft...');
        await page.click('button:has-text("下書き保存")').catch(() => page.mouse.click(1240, 50));
        await page.waitForTimeout(5000);

        job.status = 'success'; job.note_url = page.url();
        await update('S99', 'Note Created Successfully.');
        saveJob(job);
        await browser.close();
        return { status: 'success', note_url: job.note_url };

    } catch (e: any) {
        job.status = 'failed';
        const manualPrompt = "\n\n【自動投稿に失敗しました】\n下記URLより手動で下書き作成をお願いします。\nURL: https://note.com/notes/new";
        job.error_message = e.message + manualPrompt;
        if (page) {
            const buf = await page.screenshot({ type: 'png' }).catch(() => null);
            if (buf) job.error_screenshot = `data:image/png;base64,${buf.toString('base64')}`;
        }
        saveJob(job); if (browser) await browser.close();
        throw new Error(job.error_message);
    }
}
