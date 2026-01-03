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
                controller.enqueue(encoder.encode(`${JSON.stringify({ error: error.message })}\n`));
            } finally { clearInterval(heartbeat); controller.close(); }
        }
    });
    return new NextResponse(stream, { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' } });
}

async function runNoteDraftAction(job: NoteJob, content: { title: string, body: string, tags?: string[], scheduled_at?: string, email?: string, password?: string, visualDebug?: boolean, mode?: string }, onUpdate: (step: string) => void) {
    job.status = 'running';
    let browser: any; let page: any;
    const update = async (stepId: string, stepName: string) => {
        let debug = "";
        if (page) {
            try {
                const u = page.url();
                debug = ` >>> URL[...${u.substring(Math.max(0, u.length - 35))}]`;
            } catch (e) { debug = " >>> URL[UNAVAILABLE]"; }
        }
        const fullStep = `${stepId} - ${stepName}${debug}`;
        job.last_step = fullStep; saveJob(job); onUpdate(fullStep);
    };

    try {
        const VERSION = "2026-01-04-0915-STABLE-STEALTH-V2";
        await update('S01', `Engine v${VERSION}`);
        if (isVercel || (!content.visualDebug && BROWSERLESS_TOKEN)) {
            browser = await chromium.connectOverCDP(`wss://chrome.browserless.io?token=${BROWSERLESS_TOKEN}&--shm-size=2gb&stealth`, { timeout: 35000 });
        } else {
            browser = await chromium.launch({ headless: false, args: ['--no-sandbox', '--disable-blink-features=AutomationControlled'] });
        }
        const context = await browser.newContext({
            userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
            viewport: { width: 1440, height: 900 }, locale: 'ja-JP', timezoneId: 'Asia/Tokyo'
        });
        const injectStealth = async (p: any) => {
            await p.addInitScript(() => {
                Object.defineProperty(navigator, 'webdriver', { get: () => false });
                Object.defineProperty(navigator, 'languages', { get: () => ['ja-JP', 'ja', 'en-US', 'en'] });
            });
        };
        if (fs.existsSync(SESSION_FILE)) await context.addCookies(JSON.parse(fs.readFileSync(SESSION_FILE, 'utf-8')).cookies || []);
        page = await context.newPage(); await injectStealth(page);

        await update('S02', 'Visiting Note');
        await page.goto('https://note.com/', { waitUntil: 'domcontentloaded' }).catch(() => { });
        await page.waitForTimeout(3000);

        const loggedIn = await page.evaluate(() => !!document.querySelector('.nc-header__user-menu, .nc-header__profile'));
        if (!loggedIn) {
            await update('S03', 'Login Required');
            await page.goto('https://note.com/login');
            if (content.email && content.password) {
                await page.fill('input#email', content.email); await page.fill('input#password', content.password);
                await page.click('button:has-text("ログイン")');
                await page.waitForURL((u: URL) => !u.href.includes('/login'), { timeout: 35000 });
                fs.writeFileSync(SESSION_FILE, JSON.stringify(await context.storageState()));
            }
        }

        await update('S04', 'Opening Editor');
        await page.goto('https://note.com/notes/new', { waitUntil: 'domcontentloaded' }).catch(() => { });

        let success = false;
        for (let i = 0; i < 12; i++) {
            const stats = await page.evaluate(() => {
                return { tags: document.querySelectorAll('*').length, hasEditor: !!document.querySelector('.ProseMirror') };
            }).catch(() => ({ tags: 0, hasEditor: false }));
            await update('S04', `Sync ${i + 1}/12 - Tags[${stats.tags}]`);
            if (stats.tags > 200 && stats.hasEditor) { success = true; break; }
            if (stats.tags <= 45 && (i === 3 || i === 8)) {
                await update('S04', 'CRITICAL REBOOT');
                await page.close().catch(() => { });
                page = await context.newPage(); await injectStealth(page);
                await page.goto('https://note.com/notes/new').catch(() => { });
            }
            await page.mouse.move(Math.random() * 100, Math.random() * 100);
            await page.waitForTimeout(5000);
        }
        if (!success) throw new Error("Editor Load Timeout");

        await update('S07', 'Injecting');
        const html = mdToHtml(content.body);
        await page.evaluate(({ t, b }: { t: string, b: string }) => {
            const titleEl = document.querySelector('textarea[placeholder*="タイトル"]') as any;
            const bodyEl = document.querySelector('.ProseMirror') as any;
            if (titleEl) { titleEl.focus(); document.execCommand('insertText', false, t); }
            if (bodyEl) {
                bodyEl.focus(); document.execCommand('selectAll', false, undefined); document.execCommand('delete', false, undefined);
                document.execCommand('insertHTML', false, b);
            }
        }, { t: content.title, b: html });

        await update('S10', 'Finalizing');
        await page.click('button:has-text("下書き保存")').catch(() => page.mouse.click(1240, 50));
        await page.waitForTimeout(6000);
        job.status = 'success'; job.note_url = page.url();
        await update('S99', 'Note Created!');
        saveJob(job); await browser.close(); return { status: 'success', note_url: job.note_url };
    } catch (e: any) {
        job.status = 'failed'; job.error_message = e.message;
        if (page) {
            const buf = await page.screenshot({ type: 'png' }).catch(() => null);
            if (buf) job.error_screenshot = `data:image/png;base64,${buf.toString('base64')}`;
        }
        saveJob(job); if (browser) await browser.close(); throw e;
    }
}
