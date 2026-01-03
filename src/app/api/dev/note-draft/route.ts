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

// --- Main API Handler ---
export async function POST(req: NextRequest) {
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
        async start(controller) {
            const sendUpdate = (step: string) => {
                controller.enqueue(encoder.encode(`${JSON.stringify({ last_step: step })}\n`));
            };

            const heartbeat = setInterval(() => {
                controller.enqueue(encoder.encode('\n'));
            }, 5000);

            try {
                const body = await req.json();
                const { title, body: noteBody, tags, scheduled_at, mode, visualDebug } = body;

                sendUpdate("Connection Established");

                if (!validateDevMode(mode)) throw new Error(`Invalid mode: ${mode}`);

                const jobId = `job-${Date.now()}`;
                const job: NoteJob = {
                    job_id: jobId,
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
                    email: process.env.NOTE_EMAIL,
                    password: process.env.NOTE_PASSWORD,
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

// --- Logic Body ---
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
    if (!settings.AUTO_POST_ENABLED) throw new Error("AUTO_POST_ENABLED is globally FALSE (Emergency Stop)");

    let browser: any;
    let page: any;

    try {
        const VERSION = "2026-01-03-2222-STABLE-RECOVERY";
        update('S01', `Browser Initialization [v:${VERSION}]`);

        const BROWSERLESS_TOKEN = process.env.BROWSERLESS_API_KEY || process.env.BROWSERLESS_TOKEN;
        const isHeadless = content.visualDebug ? false : !settings.VISUAL_DEBUG;

        if (isServerless) {
            browser = await chromium.connectOverCDP(`wss://chrome.browserless.io?token=${BROWSERLESS_TOKEN}&--shm-size=2gb&stealth`, { timeout: 20000 });
        } else {
            browser = await chromium.launch({
                headless: isHeadless,
                args: ['--no-sandbox', '--disable-setuid-sandbox']
            });
        }

        const profile = {
            ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
            w: 1440,
            h: 900
        };

        const context = await browser.newContext({
            userAgent: profile.ua,
            viewport: { width: profile.w, height: profile.h },
            locale: 'ja-JP',
            timezoneId: 'Asia/Tokyo',
            // Proven safe headers
            extraHTTPHeaders: { 'Accept-Language': 'ja,en-US;q=0.9,en;q=0.8' }
        });

        // Stealth Injection
        await context.addInitScript(() => { Object.defineProperty(navigator, 'webdriver', { get: () => undefined }); });

        if (fs.existsSync(SESSION_FILE)) {
            const savedData = JSON.parse(fs.readFileSync(SESSION_FILE, 'utf-8'));
            if (savedData.cookies) await context.addCookies(savedData.cookies);
        }

        page = await context.newPage();
        page.on('console', (msg: any) => { if (msg.type() === 'error') onUpdate(`[Browser Error] ${msg.text().substring(0, 80)}`); });
        page.on('pageerror', (err: any) => onUpdate(`[SPA Crash] ${err.message.substring(0, 80)}`));

        await page.setDefaultTimeout(30000);
        update('S02', 'Navigating to note.com Home');
        await page.goto('https://note.com/', { waitUntil: 'load' }).catch(() => { });
        await page.waitForTimeout(6000);

        // Check Login State
        const isGuest = await page.evaluate(() => !!document.querySelector('a[href*="/login"], .nc-header__login-button'));
        if (isGuest || page.url().includes('/login')) {
            update('S03', 'Authentication Required. Logging in...');
            if (!page.url().includes('/login')) await page.goto('https://note.com/login', { waitUntil: 'load' });

            if (content.email && content.password) {
                update('S03', 'Filling credentials...');
                await page.waitForSelector('input#email', { timeout: 10000 });
                await page.fill('input#email', content.email);
                await page.fill('input#password', content.password);
                await page.click('button[type="submit"], button:has-text("ログイン")');
                await page.waitForURL((u: URL) => !u.href.includes('/login'), { timeout: 20000 });

                update('S03', 'Login success. Saving session...');
                const state = await context.storageState();
                fs.writeFileSync(SESSION_FILE, JSON.stringify(state));
                await page.goto('https://note.com/', { waitUntil: 'load' });
                await page.waitForTimeout(5000);
            } else {
                throw new Error("Credentials missing in environment");
            }
        }

        // --- S04: Editor Entry Point ---
        update('S04', 'Triggering Editor Entry flow...');
        await page.goto('https://note.com/', { waitUntil: 'domcontentloaded' }).catch(() => { });
        await page.waitForTimeout(6000);

        // Remove Home Modals
        await page.evaluate(() => {
            const btnTexts = ['閉じる', 'close', 'スキップ', '×'];
            document.querySelectorAll('button, div[role="button"]').forEach((el: any) => {
                if (btnTexts.some(t => el.textContent?.includes(t) || el.getAttribute('aria-label')?.includes(t))) el.click();
            });
            document.querySelectorAll('.nc-modal, .nc-popover, .nc-modal-backdrop').forEach(el => el.remove());
        }).catch(() => { });

        const postBtnSelectors = ['.nc-header__post-button', 'button[aria-label="投稿"]', '.nc-header__create-button', 'a[href="/notes/new"]'].join(', ');
        let entrySuccessful = false;
        try {
            const btn = page.locator(postBtnSelectors).first();
            if (await btn.isVisible()) {
                update('S04', 'Clicking Post Button...');
                await btn.click({ force: true });
                await page.waitForTimeout(3000);
                const textOpt = page.locator('a[href="/notes/new"], button:has-text("テキスト"), .nc-post-menu__item-text').first();
                if (await textOpt.isVisible()) {
                    update('S04', 'Selecting Text Creation...');
                    await textOpt.click();
                    entrySuccessful = true;
                }
            }
        } catch (e) { }

        if (!entrySuccessful) {
            update('S04', 'UI navigation failed. Forcing direct /notes/new...');
            await page.goto('https://note.com/notes/new', { waitUntil: 'domcontentloaded' }).catch(() => { });
        }

        // Monitoring for Note ID redirection
        update('S04', 'Waiting for Editor Hydration...');
        let editorBound = false;
        for (let i = 0; i < 15; i++) {
            const url = page.url();
            const tagCount = await page.evaluate(() => document.querySelectorAll('*').length).catch(() => 0);

            if ((/\/n[a-z0-9]+\/edit/.test(url) || url.includes('editor.note.com')) && tagCount > 100 && !url.endsWith('/new')) {
                update('S04', `Editor Connected (Tags: ${tagCount})`);
                editorBound = true;
                break;
            }

            update('S04', `Step 04 Sync (${i + 1}/15): Tags=${tagCount}`);
            if (i > 4 && tagCount < 80) {
                if (i % 4 === 0) {
                    update('S04', 'Hydration stall. Refreshing...');
                    await page.goto('https://note.com/notes/new', { waitUntil: 'domcontentloaded' }).catch(() => { });
                } else {
                    await page.mouse.click(720, 450).catch(() => { });
                    await page.keyboard.press('Escape').catch(() => { });
                }
            }
            await page.waitForTimeout(3500);
        }

        if (!editorBound) throw new Error("Editor (Note ID) generation timed out");

        // --- S05: Tutorial Bypass ---
        update('S05', 'Ghost Bypass: Clearing Editor Tutorials');
        await page.waitForTimeout(3000);
        await page.evaluate(() => {
            const skipTexts = ["次へ", "閉じる", "スキップ", "理解しました", "OK", "×"];
            document.querySelectorAll('button, div[role="button"], span, a').forEach((el: any) => {
                const txt = (el.textContent || "").trim();
                const aria = (el.getAttribute('aria-label') || "");
                if (skipTexts.some(t => txt.includes(t) || aria.includes(t))) el.click();
            });
            document.querySelectorAll('.nc-modal, .nc-tutorial-modal, .nc-modal-backdrop, .nc-popover').forEach(el => el.remove());
            document.body.style.overflow = 'auto';
        }).catch(() => { });
        await page.waitForTimeout(2000);
        await page.mouse.click(1100, 100).catch(() => { }); // Click away

        // --- S06: Injection Analysis ---
        update('S06', 'Inspecting Editor Areas');
        let editorResponsive = false;
        for (let i = 0; i < 5; i++) {
            const hasEditor = await page.evaluate(() => !!document.querySelector('.ProseMirror, .note-editor, [contenteditable="true"]'));
            if (hasEditor) {
                editorResponsive = true;
                break;
            }
            update('S06', `Waiting for Editor mount (${i + 1}/5)`);
            await page.keyboard.press('Escape');
            await page.waitForTimeout(4000);
        }

        if (!editorResponsive) throw new Error("Editor areas fail to mount");

        // Ghost Injection Step
        const targetSelectors = await page.evaluate(() => {
            const title = document.querySelector('h1, textarea[placeholder*="タイトル"], input[placeholder*="タイトル"]');
            const body = document.querySelector('.ProseMirror, .note-editor__body, [contenteditable="true"]');
            return {
                title: title ? (title.id ? `#${title.id}` : (title.className ? `.${title.className.split(' ')[0]}` : 'textarea')) : 'textarea',
                body: body ? '.ProseMirror' : '.ProseMirror'
            };
        });

        const injectInput = async (selector: string, text: string, type: 'title' | 'body') => {
            const el = page.locator(selector).first();
            await el.scrollIntoViewIfNeeded();
            await el.click();
            await page.waitForTimeout(1000);

            const chunkLen = type === 'body' ? 120 : 25;
            const chunks = text.match(new RegExp(`[\\s\\S]{1,${chunkLen}}`, 'g')) || [text];

            for (const chunk of chunks) {
                await page.evaluate(({ sel, txt }: { sel: string, txt: string }) => {
                    const target = document.querySelector(sel) as any;
                    if (target) {
                        target.focus();
                        document.execCommand('insertText', false, txt);
                    }
                }, { sel: selector, txt: chunk });
                await page.waitForTimeout(300 + Math.random() * 400);
            }
        };

        update('S07', 'Injecting Title...');
        await injectInput(targetSelectors.title, content.title, 'title');
        update('S08', 'Injecting Body...');
        await injectInput(targetSelectors.body, content.body, 'body');

        update('S10', 'Finalizing Draft Save');
        await page.click('button:has-text("下書き保存")').catch(() => page.mouse.click(1200, 50));
        await page.waitForTimeout(6000);

        job.status = 'success';
        job.finished_at = new Date().toISOString();
        job.note_url = page.url();
        update('S99', 'Success: Note Drafted');
        saveJob(job);

        await browser.close();
        return { status: 'success', note_url: job.note_url };

    } catch (error: any) {
        job.status = 'failed';
        job.error_message = error.message;
        job.finished_at = new Date().toISOString();
        if (page) {
            const buf = await page.screenshot({ type: 'png' }).catch(() => null);
            if (buf) job.error_screenshot = `data:image/png;base64,${buf.toString('base64')}`;
        }
        saveJob(job);
        if (browser) await browser.close();
        throw error;
    }
}
