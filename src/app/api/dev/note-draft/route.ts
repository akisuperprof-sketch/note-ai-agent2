import { NextRequest, NextResponse } from 'next/server';
import path from 'path';
import fs from 'fs';
import { chromium } from 'playwright-core';
import { getDevSettings, validateDevMode } from '@/lib/server/flags';

// --- Configuration & Paths ---
const isServerless = !!(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.BROWSERLESS_API_KEY || process.env.BROWSERLESS_TOKEN);

const JOBS_DIR = isServerless
    ? path.join('/tmp', 'note-draft-jobs')
    : path.join(process.cwd(), '.gemini', 'note-draft-jobs');

const SESSION_FILE = isServerless
    ? path.join('/tmp', 'note-session.json')
    : path.join(process.cwd(), '.gemini', 'note-session.json');

type NoteJob = {
    job_id: string;
    article_id: string;
    request_id: string;
    mode: string;
    status: 'pending' | 'running' | 'success' | 'failed';
    last_step: string;
    title: string;
    body: string;
    tags: string[];
    scheduled_at: string | null;
    note_url?: string;
    error_message?: string;
    error_screenshot?: string;
    started_at: string;
    finished_at?: string;
};

function saveJob(job: NoteJob) {
    try {
        const dir = path.dirname(path.join(JOBS_DIR, `${job.job_id}.json`));
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(JOBS_DIR, `${job.job_id}.json`), JSON.stringify(job, null, 2));
    } catch (e) {
        console.error("Failed to save job metadata:", e);
    }
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
                    job_id: jobId,
                    article_id: article_id || 'unknown',
                    request_id: request_id || 'unknown',
                    mode,
                    status: 'pending',
                    last_step: 'Initializing Engine...',
                    title,
                    body: noteBody,
                    tags: tags || [],
                    scheduled_at: scheduled_at || null,
                    started_at: new Date().toISOString(),
                };

                saveJob(job);
                sendUpdate(`Job Created: ${jobId}`);

                const result = await runNoteDraftAction(job, {
                    title,
                    body: noteBody,
                    tags,
                    scheduled_at,
                    email: email || process.env.NOTE_EMAIL,
                    password: password || process.env.NOTE_PASSWORD,
                    visualDebug,
                    mode
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
        headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
        },
    });
}

async function runNoteDraftAction(job: NoteJob, content: { title: string, body: string, tags?: string[], scheduled_at?: string, email?: string, password?: string, visualDebug?: boolean, mode?: string }, onUpdate: (step: string) => void) {
    job.status = 'running';
    job.started_at = new Date().toISOString();
    const update = (stepId: string, stepName: string) => {
        const fullStep = `${stepId}: ${stepName}`;
        job.last_step = fullStep;
        saveJob(job);
        onUpdate(fullStep);
    };

    update('S00', 'Precheck (安全性確認)');
    const settings = getDevSettings();
    if (!settings.AUTO_POST_ENABLED) throw new Error("AUTO_POST_ENABLED is FALSE");

    let browser: any;
    let page: any;

    try {
        const VERSION = "2026-01-04-0520-FULL-RESTORE";
        update('S01', `Browser Initialization [v:${VERSION}]`);

        const BROWSERLESS_TOKEN = process.env.BROWSERLESS_API_KEY || process.env.BROWSERLESS_TOKEN;
        const isHeadless = content.visualDebug ? false : !settings.VISUAL_DEBUG;

        if (isServerless) {
            browser = await chromium.connectOverCDP(`wss://chrome.browserless.io?token=${BROWSERLESS_TOKEN}&--shm-size=2gb&stealth`, { timeout: 25000 });
        } else {
            browser = await chromium.launch({ headless: isHeadless, args: ['--no-sandbox', '--disable-blink-features=AutomationControlled'] });
        }

        // 【復元】storageStateによる完全復元（クッキー＋LocalStorage）
        const contextOptions: any = {
            userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
            viewport: { width: 1440, height: 900 },
            locale: 'ja-JP',
            timezoneId: 'Asia/Tokyo',
            extraHTTPHeaders: { 'Accept-Language': 'ja,en-US;q=0.9,en;q=0.8' }
        };

        if (fs.existsSync(SESSION_FILE)) {
            contextOptions.storageState = SESSION_FILE;
        }

        const context = await browser.newContext(contextOptions);

        // ステルス初期化
        await context.addInitScript(() => { Object.defineProperty(navigator, 'webdriver', { get: () => undefined }); });

        page = await context.newPage();
        page.on('pageerror', (err: any) => onUpdate(`[SPA Crash] ${err.message.substring(0, 80)}`));

        await page.setDefaultTimeout(35000);
        update('S02', 'Navigating to note.com Home');
        await page.goto('https://note.com/', { waitUntil: 'load' }).catch(() => { });
        await page.waitForTimeout(5000);

        const isGuest = await page.evaluate(() => !!document.querySelector('a[href*="/login"], .nc-header__login-button'));
        if (isGuest || page.url().includes('/login')) {
            update('S03', 'Authentication Required...');
            if (!page.url().includes('/login')) await page.goto('https://note.com/login', { waitUntil: 'load' });
            if (content.email && content.password) {
                await page.fill('input#email', content.email);
                await page.fill('input#password', content.password);
                await page.click('button[type="submit"]');
                await page.waitForURL((u: URL) => !u.href.includes('/login'), { timeout: 20000 });

                // 【復元】完全なストレージ状態を保存
                const fullState = await context.storageState();
                fs.writeFileSync(SESSION_FILE, JSON.stringify(fullState));
                await page.goto('https://note.com/', { waitUntil: 'load' });
            } else {
                throw new Error("Credentials missing");
            }
        }

        update('S04', 'Triggering Editor Entry...');
        await page.goto('https://note.com/', { waitUntil: 'domcontentloaded' }).catch(() => { });
        await page.waitForTimeout(5000);

        // Modal Wipe
        await page.evaluate(() => {
            document.querySelectorAll('.nc-modal, .nc-popover, .nc-modal-backdrop').forEach(el => el.remove());
            document.body.style.overflow = 'auto';
        }).catch(() => { });

        const postBtnSelectors = ['.nc-header__post-button', 'button[aria-label="投稿"]'].join(', ');
        let entrySuccessful = false;
        try {
            const btn = page.locator(postBtnSelectors).first();
            if (await btn.isVisible()) {
                update('S04', 'Clicking Post Button...');
                await btn.click({ force: true });
                await page.waitForTimeout(3000);
                const textOpt = page.locator('a[href="/notes/new"], button:has-text("テキスト")').first();
                if (await textOpt.isVisible()) {
                    await textOpt.click();
                    entrySuccessful = true;
                }
            }
        } catch (e) { }

        if (!entrySuccessful) {
            update('S04', 'Forcing direct /notes/new');
            await page.goto('https://note.com/notes/new', { waitUntil: 'domcontentloaded' }).catch(() => { });
        }

        // --- S04: Monitoring (6 tries limit) ---
        update('S04', 'Waiting for Editor Hydration...');
        let editorBound = false;
        for (let i = 0; i < 6; i++) {
            const url = page.url();
            const tagCount = await page.evaluate(() => document.querySelectorAll('*').length).catch(() => 0);
            const displayUrl = url.length > 40 ? `...${url.substring(url.length - 35)}` : url;

            // タグ数150を境界線とする（かつ編集URLであることを確認）
            if ((/\/n[a-z0-9]+\/edit/.test(url) || url.includes('editor.note.com')) && tagCount > 150 && !url.endsWith('/new')) {
                update('S04', `Editor Connected (Tags: ${tagCount})`);
                editorBound = true;
                break;
            }

            update('S04', `Sync ${i + 1}/6: Tags=${tagCount} [${displayUrl}]`);

            if (tagCount < 80) {
                if (i === 2) {
                    update('S04', 'Skeleton stall. Triggering Rescue Reload...');
                    await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => { });
                } else {
                    await page.mouse.click(720, 450).catch(() => { }); // 適当な位置をクリックして刺激
                    await page.keyboard.press('Escape'); // 隠れた邪魔者を排除
                }
            }
            await page.waitForTimeout(5000);
        }

        if (!editorBound) throw new Error(`Hydration failed at 6 tries (Tags: ${await page.evaluate(() => document.querySelectorAll('*').length).catch(() => 0)})`);

        // --- S05: Tutorial Bypass ---
        update('S05', 'Clearing Editor Overlays');
        await page.evaluate(() => {
            const skip = ["次へ", "閉じる", "スキップ", "理解しました", "OK", "×"];
            document.querySelectorAll('button, div[role="button"], span, a').forEach((el: any) => {
                if (skip.some(t => el.textContent?.includes(t) || el.getAttribute('aria-label')?.includes(t))) el.click();
            });
            document.querySelectorAll('.nc-modal, .nc-tutorial-modal, .nc-modal-backdrop, .nc-popover').forEach(el => el.remove());
        }).catch(() => { });
        await page.waitForTimeout(2000);

        // --- S06~S08: Injection ---
        update('S06', 'Inspecting Editor Areas');
        if (!await page.evaluate(() => !!document.querySelector('.ProseMirror'))) {
            throw new Error("ProseMirror editor not found even after success tag count");
        }

        const ghostInject = async (sel: string, txt: string) => {
            const el = page.locator(sel).first();
            await el.scrollIntoViewIfNeeded();
            await el.click();
            await page.waitForTimeout(1000);
            await page.evaluate(({ s, t }: { s: string, t: string }) => {
                const target = document.querySelector(s) as any;
                if (target) { target.focus(); document.execCommand('insertText', false, t); }
            }, { s: sel, t: txt });
        };

        update('S07', 'Injecting Title...');
        await ghostInject('textarea[placeholder*="タイトル"]', content.title);
        update('S08', 'Injecting Body...');
        await ghostInject('.ProseMirror', content.body);

        update('S10', 'Finalizing Save...');
        await page.click('button:has-text("下書き保存")').catch(() => page.mouse.click(1240, 50));
        await page.waitForTimeout(5000);

        job.status = 'success';
        job.finished_at = new Date().toISOString();
        job.note_url = page.url();
        update('S99', 'Completed Draft Successfully');
        saveJob(job);

        await browser.close();
        return { status: 'success', note_url: job.note_url };

    } catch (e: any) {
        job.status = 'failed';
        job.error_message = e.message;
        job.finished_at = new Date().toISOString();
        if (page) {
            const buf = await page.screenshot({ type: 'png' }).catch(() => null);
            if (buf) job.error_screenshot = `data:image/png;base64,${buf.toString('base64')}`;
        }
        saveJob(job);
        if (browser) await browser.close();
        throw e;
    }
}
