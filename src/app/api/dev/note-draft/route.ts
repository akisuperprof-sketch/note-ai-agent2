import { NextRequest, NextResponse } from 'next/server';
import path from 'path';
import fs from 'fs';
import playwright from 'playwright-core';
import { getDevSettings, validateDevMode } from '@/lib/server/flags';

const JOBS_DIR = path.join(process.cwd(), '.gemini', 'note-draft-jobs');
const SESSION_FILE = path.join(process.cwd(), '.gemini', 'note-session.json');

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
    if (!fs.existsSync(JOBS_DIR)) fs.mkdirSync(JOBS_DIR, { recursive: true });
    fs.writeFileSync(path.join(JOBS_DIR, `${job.job_id}.json`), JSON.stringify(job, null, 2));
}

const isServerless = !!(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.BROWSERLESS_API_KEY || process.env.BROWSERLESS_TOKEN);

export async function POST(req: NextRequest) {
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
        async start(controller) {
            const sendUpdate = (step: string) => {
                controller.enqueue(encoder.encode(`data: ${JSON.stringify({ step })}\n\n`));
            };

            const heartbeat = setInterval(() => {
                controller.enqueue(encoder.encode(': heartbeat\n\n'));
            }, 5000);

            try {
                const body = await req.json();
                const { title, body: noteBody, tags, scheduled_at, mode, visualDebug } = body;

                validateDevMode(mode);

                const jobId = `job-${Date.now()}`;
                const job: NoteJob = {
                    job_id: jobId,
                    mode,
                    status: 'pending',
                    last_step: 'Initializing...',
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

                controller.enqueue(encoder.encode(`data: ${JSON.stringify({ status: 'success', job_id: jobId, note_url: result.note_url })}\n\n`));
            } catch (error: any) {
                console.error("Action Error:", error);
                controller.enqueue(encoder.encode(`data: ${JSON.stringify({ status: 'error', message: error.message })}\n\n`));
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
    job.tags = content.tags || [];
    job.scheduled_at = content.scheduled_at || null;

    const update = (stepId: string, stepName: string) => {
        const fullStep = `${stepId}: ${stepName}`;
        job.last_step = fullStep;
        saveJob(job);
        onUpdate(fullStep);
    };

    update('S00', 'Precheck (安全性確認)');
    const settings = getDevSettings();
    if (!settings.AUTO_POST_ENABLED) throw new Error("AUTO_POST_ENABLED is globally FALSE");

    let browser: any;
    let page: any;

    try {
        const VERSION = "2026-01-03-2215-FIXED";
        update('S01', `Load Session / Browser Init [v:${VERSION}]`);
        const BROWSERLESS_TOKEN = process.env.BROWSERLESS_API_KEY || process.env.BROWSERLESS_TOKEN;

        const isHeadless = content.visualDebug ? false : !settings.VISUAL_DEBUG;
        if (isServerless) {
            browser = await playwright.connectOverCDP(`wss://chrome.browserless.io?token=${BROWSERLESS_TOKEN}&--shm-size=2gb&stealth`, { timeout: 15000 });
        } else {
            browser = await playwright.launch({ headless: isHeadless, args: ['--no-sandbox'] });
        }

        const profile = { ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36', w: 1440, h: 900 };
        const context = await browser.newContext({
            userAgent: profile.ua,
            viewport: { width: profile.w, height: profile.h },
            locale: 'ja-JP',
            timezoneId: 'Asia/Tokyo'
        });

        // Stealth
        await context.addInitScript(() => { Object.defineProperty(navigator, 'webdriver', { get: () => undefined }); });

        if (fs.existsSync(SESSION_FILE)) {
            const savedData = JSON.parse(fs.readFileSync(SESSION_FILE, 'utf-8'));
            if (savedData.cookies) await context.addCookies(savedData.cookies);
        }

        page = await context.newPage();
        page.on('console', (msg: any) => { if (msg.type() === 'error') onUpdate(`[Browser Error] ${msg.text().substring(0, 80)}`); });
        page.on('pageerror', (err: any) => onUpdate(`[SPA Crash] ${err.message.substring(0, 80)}`); );

        await page.setDefaultTimeout(30000);
        update('S02', 'Navigating to note.com');
        await page.goto('https://note.com/', { waitUntil: 'load' }).catch(() => { });
        await page.waitForTimeout(6000);

        const isLoginPage = page.url().includes('/login');
        const isGuest = await page.evaluate(() => !!document.querySelector('a[href*="/login"], .nc-header__login-button'));

        if (isLoginPage || isGuest) {
            update('S03', 'Guest detected. Forcing login...');
            if (!isLoginPage) await page.goto('https://note.com/login', { waitUntil: 'load' });
            if (content.email && content.password) {
                update('S03', 'Entering credentials...');
                await page.waitForSelector('input#email', { timeout: 10000 });
                await page.fill('input#email', content.email);
                await page.fill('input#password', content.password);
                await page.click('button[type="submit"], button:has-text("ログイン")');
                await page.waitForURL((u: URL) => !u.href.includes('/login'), { timeout: 15000 });
                update('S03', 'Login success. Stabilizing...');
                const state = await context.storageState();
                fs.writeFileSync(SESSION_FILE, JSON.stringify(state));
                await page.goto('https://note.com/', { waitUntil: 'load' });
                await page.waitForTimeout(5000);
            }
        }

        // --- S04: Editor Entry ---
        update('S04', 'Entering Editor (Pen Mode)...');
        await page.goto('https://note.com/', { waitUntil: 'domcontentloaded' }).catch(() => { });
        await page.waitForTimeout(6000);

        // Modal Wipe
        await page.evaluate(() => {
            document.querySelectorAll('.nc-modal, .nc-popover, .nc-modal-backdrop').forEach(el => el.remove());
            document.body.style.overflow = 'auto';
        }).catch(() => { });

        const postBtnSelectors = ['.nc-header__post-button', 'button[aria-label="投稿"]', '.nc-header__create-button', 'a[href="/notes/new"]'].join(', ');
        let clicked = false;
        try {
            const btn = page.locator(postBtnSelectors).first();
            if (await btn.isVisible()) {
                await btn.click({ force: true });
                clicked = true;
            }
        } catch (e) { }

        if (clicked) {
            await page.waitForTimeout(4000);
            const textOpt = page.locator('a[href="/notes/new"], button:has-text("テキスト"), .nc-post-menu__item-text').first();
            if (await textOpt.isVisible()) {
                await textOpt.click();
            } else {
                await page.goto('https://note.com/notes/new', { waitUntil: 'domcontentloaded' });
            }
        } else {
            await page.goto('https://note.com/notes/new', { waitUntil: 'domcontentloaded' });
        }

        update('S04', 'Monitoring Editor Creation...');
        let redirectSuccess = false;
        for (let i = 0; i < 15; i++) {
            const currentUrl = page.url();
            let tagCount = await page.evaluate(() => document.querySelectorAll('*').length).catch(() => 0);

            if ((/\/n[a-z0-9]+\/edit/.test(currentUrl) || currentUrl.includes('editor.note.com')) && tagCount > 100 && !currentUrl.endsWith('/new')) {
                update('S04', `Editor Connected (Tags: ${tagCount})`);
                redirectSuccess = true;
                break;
            }

            update('S04', `Monitor Session (${i + 1}/15): ${tagCount < 70 ? "Skeleton..." : "Hydrating..."} [Tags: ${tagCount}]`);

            if (i > 3 && tagCount < 70) {
                if (i % 3 === 0) {
                    await page.goto('https://note.com/notes/new', { waitUntil: 'domcontentloaded' }).catch(() => { });
                } else {
                    await page.mouse.click(720, 450).catch(() => { });
                    await page.keyboard.press('Escape').catch(() => { });
                }
            }
            await page.waitForTimeout(3500);
        }

        if (!redirectSuccess) throw new Error("エディタへのリダイレクトに失敗しました");

        // --- S05: Tutorial Bypass & Stabilize ---
        update('S05', 'Ghost Bypass: Clearing overlays...');
        await page.evaluate(() => {
            const btnT = ["次へ", "閉じる", "スキップ", "理解しました", "OK", "Close", "×"];
            document.querySelectorAll('button, div[role="button"], span, a').forEach((el: any) => {
                if (btnT.some(t => el.textContent?.includes(t) || el.getAttribute('aria-label')?.includes(t))) el.click();
            });
            document.querySelectorAll('.nc-modal, .nc-tutorial-modal, .nc-modal-backdrop, .nc-popover, .nc-overlay').forEach(el => el.remove());
            document.body.style.overflow = 'auto';
        }).catch(() => { });
        await page.waitForTimeout(2000);
        await page.mouse.click(1100, 100).catch(() => { });

        let editorFound = false;
        for (let i = 0; i < 5; i++) {
            const hasEditor = await page.evaluate(() => !!document.querySelector('.ProseMirror, .note-editor, [contenteditable="true"]'));
            if (hasEditor) {
                editorFound = true;
                break;
            }
            update('S05', `Waiting for Editor mount (${i + 1}/5)`);
            if (i === 1) await page.keyboard.press('Escape');
            await page.waitForTimeout(4000);
        }

        if (!editorFound) throw new Error("エディタの入力領域が見つかりませんでした");

        // --- S06: Injection ---
        update('S06', 'Starting Ghost Injection');
        const bestSelectors = await page.evaluate(() => {
            const title = document.querySelector('h1, textarea[placeholder*="タイトル"], input[placeholder*="タイトル"], .note-editor__title');
            const body = document.querySelector('.ProseMirror, .note-editor__body, [contenteditable="true"]');
            return {
                title: title ? (title.id ? `#${title.id}` : title.className.split(' ').map(c => `.${c}`).join('')) : 'textarea',
                body: body ? (body.id ? `#${body.id}` : '.ProseMirror') : '.ProseMirror'
            };
        });

        const forceInput = async (selector: string, text: string, isBody: boolean = false) => {
            const el = page.locator(selector).first();
            await el.scrollIntoViewIfNeeded();
            await el.click();
            await page.waitForTimeout(1000);
            const chunks = isBody ? text.match(/[\s\S]{1,150}/g) || [text] : text.match(/[\s\S]{1,30}/g) || [text];
            for (const chunk of chunks) {
                await page.evaluate(({ sel, txt }: { sel: string, txt: string }) => {
                    const t = document.querySelector(sel) as any;
                    if (t) { t.focus(); document.execCommand('insertText', false, txt); }
                }, { sel: selector, txt: chunk });
                await page.waitForTimeout(400 + Math.random() * 500);
            }
        };

        update('S07', 'Typing Title...');
        await forceInput(bestSelectors.title, content.title);
        update('S08', 'Typing Body...');
        await forceInput(bestSelectors.body, content.body, true);

        update('S10', 'Executing Save...');
        await page.click('button:has-text("下書き保存")').catch(() => page.mouse.click(1100, 50));
        await page.waitForTimeout(5000);

        job.status = 'success';
        job.finished_at = new Date().toISOString();
        job.note_url = page.url();
        update('S99', 'Job Complete');
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
