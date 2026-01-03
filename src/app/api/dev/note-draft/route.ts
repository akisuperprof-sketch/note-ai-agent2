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
        try { if (page) { const u = page.url(); debug = ` > ${u.substring(Math.max(0, u.length - 30))}`; } } catch (e) { }
        const fullStep = `${stepId} ${stepName}${debug}`;
        job.last_step = fullStep; saveJob(job); onUpdate(fullStep);
    };

    try {
        const VERSION = "2026-01-04-1045-REBOOT-FIRE-AND-FORGET";
        await update('S01', `Engine v${VERSION}`);

        // ローカル実行時はIP偽装のためBrowserlessを使わず、MacのGoogle Chromeを優先
        if (!isVercel) {
            const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
            browser = await chromium.launch({
                headless: false,
                executablePath: fs.existsSync(chromePath) ? chromePath : undefined,
                args: ['--no-sandbox', '--disable-blink-features=AutomationControlled', '--start-maximized']
            });
        } else {
            // 本番環境（Vercel）ではBrowserlessを使用
            browser = await chromium.connectOverCDP(`wss://chrome.browserless.io?token=${BROWSERLESS_TOKEN}&--shm-size=2gb&stealth`);
        }

        const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'ja-JP', timezoneId: 'Asia/Tokyo' });

        // --- 究極の擬態 (Stealth 3.0) ---
        const injectStealth = async (p: any) => {
            await p.addInitScript(() => {
                Object.defineProperty(navigator, 'webdriver', { get: () => false });
                (window as any).chrome = { runtime: {} };
                Object.defineProperty(navigator, 'languages', { get: () => ['ja-JP', 'ja', 'en-US', 'en'] });
                Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
            });
        };

        if (fs.existsSync(SESSION_FILE)) await context.addCookies(JSON.parse(fs.readFileSync(SESSION_FILE, 'utf-8')).cookies || []);
        page = await context.newPage(); await injectStealth(page);

        await update('S02', 'Visiting Note');
        await page.goto('https://note.com/', { waitUntil: 'load' });
        await page.waitForTimeout(4000);

        const loggedIn = await page.evaluate(() => !!document.querySelector('.nc-header__user-menu, .nc-header__profile'));
        if (!loggedIn) {
            await update('S03', 'Login Required');
            await page.goto('https://note.com/login', { waitUntil: 'networkidle' });
            if (content.email && content.password) {
                await page.fill('input#email', content.email); await page.fill('input#password', content.password);
                await page.click('button:has-text("ログイン")');
                await page.waitForURL((u: URL) => !u.href.includes('/login'), { timeout: 40000 });
                await page.waitForTimeout(6000);
                fs.writeFileSync(SESSION_FILE, JSON.stringify(await context.storageState()));
            }
        }

        // --- 人間動線：トップからペンマークをクリック ---
        await update('S04', 'Clearing Overlays & Clicking');

        // 邪魔なモーダルを物理的に消去
        await page.evaluate(() => {
            const selectors = ['.nc-modal', '.nc-modal-backdrop', '.modal-content-wrapper', '[class*="modal"]'];
            selectors.forEach(s => {
                document.querySelectorAll(s).forEach(el => (el as HTMLElement).style.display = 'none');
                document.querySelectorAll(s).forEach(el => el.remove());
            });
            document.body.style.overflow = 'auto'; // スクロールロック解除
        }).catch(() => { });

        if (page.url().includes('editor.note.com')) { /* Skip */ }
        else {
            const postBtn = await page.$('.nc-header__post-button, [aria-label="投稿"], .nc-header__user-menu');
            if (postBtn) {
                await postBtn.click({ timeout: 5000 }).catch(async () => {
                    await page.goto('https://note.com/notes/new');
                });
                await page.waitForTimeout(2000);
                await page.click('text=テキスト', { timeout: 3000 }).catch(() => { });
            } else {
                await page.goto('https://note.com/notes/new');
            }
        }

        let hydrated = false;
        for (let i = 0; i < 15; i++) {
            const currentUrl = page.url();
            const stats = await page.evaluate(() => {
                return { tags: document.querySelectorAll('*').length, hasEditor: !!document.querySelector('.ProseMirror') };
            }).catch(() => ({ tags: 0, hasEditor: false }));

            await update('S04', `Sync ${i + 1}/15 Tags ${stats.tags}`);

            if (stats.hasEditor && currentUrl.includes('editor.note.com')) {
                await update('S04', 'Hydration OK');
                hydrated = true; break;
            }

            // 【救済1】ホームページで固まっている場合は強制ジャンプ
            if (!currentUrl.includes('editor.note.com') && i === 3) {
                await update('S04', 'FORCE JUMP TO EDITOR');
                await page.goto('https://note.com/notes/new', { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => { });
            }

            // 【救済2：成功要因】Tagsが45以下（膠着）ならタブを物理的に作り直す
            if (stats.tags <= 45 && (i === 5 || i === 11)) {
                await update('S04', 'CRITICAL REBOOT (NEW TAB)');
                try {
                    const oldPage = page;
                    page = await context.newPage();
                    await injectStealth(page);
                    await oldPage.close().catch(() => { });
                    await page.goto('https://note.com/notes/new', { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => { });
                    await update('S04', 'REBOOT DONE');
                } catch (e) {
                    await update('S04', 'REBOOT ERROR/RECOVERY');
                }
            }

            await page.mouse.move(Math.random() * 100, Math.random() * 100);
            await page.waitForTimeout(5000);
        }
        if (!hydrated) throw new Error("Block detected. Please check if IP is restricted.");

        await update('S07', 'Injecting Content');
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
        await update('S99', 'Success!');
        saveJob(job); await browser.close(); return { status: 'success', note_url: job.note_url };
    } catch (e: any) {
        job.status = 'failed'; job.error_message = e.message;
        if (browser) await browser.close(); throw e;
    }
}
