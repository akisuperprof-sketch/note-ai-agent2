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

// --- Infrastructure Utils ---
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

// --- The Core Logic (Restored to Stable Baseline) ---
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
    if (!settings.AUTO_POST_ENABLED) throw new Error("AUTO_POST_ENABLED is globally FALSE");

    let browser: any;
    let page: any;

    try {
        const VERSION = "2026-01-04-0500-STABLE-RESTORE";
        update('S01', `Browser Initialization [v:${VERSION}]`);

        const BROWSERLESS_TOKEN = process.env.BROWSERLESS_API_KEY || process.env.BROWSERLESS_TOKEN;
        const isHeadless = content.visualDebug ? false : !settings.VISUAL_DEBUG;

        // 【復元】シンプルなブラウザ起動 (CORS干渉を避ける)
        if (isServerless) {
            browser = await chromium.connectOverCDP(`wss://chrome.browserless.io?token=${BROWSERLESS_TOKEN}&--shm-size=2gb&stealth`, { timeout: 20000 });
        } else {
            browser = await chromium.launch({ headless: isHeadless, args: ['--no-sandbox'] });
        }

        const context = await browser.newContext({
            userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
            viewport: { width: 1440, height: 900 },
            locale: 'ja-JP',
            timezoneId: 'Asia/Tokyo'
        });

        // 【復元】ステルス初期化
        await context.addInitScript(() => { Object.defineProperty(navigator, 'webdriver', { get: () => undefined }); });

        // 【復元】セッション復元
        if (fs.existsSync(SESSION_FILE)) {
            const savedData = JSON.parse(fs.readFileSync(SESSION_FILE, 'utf-8'));
            if (savedData.cookies) await context.addCookies(savedData.cookies);
        }

        page = await context.newPage();
        page.on('console', (msg: any) => { if (msg.type() === 'error') onUpdate(`[Browser Error] ${msg.text().substring(0, 80)}`); });
        page.on('pageerror', (err: any) => onUpdate(`[SPA Crash] ${err.message.substring(0, 80)}`));

        await page.setDefaultTimeout(35000);
        update('S02', 'Navigating to note.com');
        await page.goto('https://note.com/', { waitUntil: 'load' }).catch(() => { });
        await page.waitForTimeout(6000);

        // --- S03: Authentication ---
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
                await page.waitForURL((u: URL) => !u.href.includes('/login'), { timeout: 15000 });

                update('S03', 'Login success. Saving session...');
                const state = await context.storageState();
                fs.writeFileSync(SESSION_FILE, JSON.stringify(state));
                await page.goto('https://note.com/', { waitUntil: 'load' });
                await page.waitForTimeout(5000);
            } else {
                throw new Error("Credentials missing");
            }
        }

        // --- S04: Editor Entry (Proven Workflow) ---
        update('S04', 'Triggering Editor Entry flow...');
        await page.goto('https://note.com/', { waitUntil: 'domcontentloaded' }).catch(() => { });
        await page.waitForTimeout(6000);

        // 【復元】邪魔なモーダルを強制的かつ丁寧に掃除
        await page.evaluate(() => {
            const btnT = ['閉じる', 'close', 'スキップ', '×'];
            document.querySelectorAll('button, div[role="button"]').forEach((el: any) => {
                if (btnT.some(t => el.textContent?.includes(t) || el.getAttribute('aria-label')?.includes(t))) el.click();
            });
            document.querySelectorAll('.nc-modal, .nc-popover, .nc-modal-backdrop').forEach(el => el.remove());
            document.body.style.overflow = 'auto'; // スクロール不全を解消
        }).catch(() => { });

        const postBtnSelectors = ['.nc-header__post-button', 'button[aria-label="投稿"]', '.nc-header__create-button'].join(', ');
        let entrySuccessful = false;
        try {
            const btn = page.locator(postBtnSelectors).first();
            if (await btn.isVisible()) {
                update('S04', 'Clicking Post Button...');
                await btn.click({ force: true });
                await page.waitForTimeout(4000);
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

        // --- S04: Monitoring (Wait for Tags 300+) ---
        update('S04', 'Waiting for Editor Hydration...');
        let editorBound = false;
        for (let i = 0; i < 15; i++) {
            const url = page.url();
            const tagCount = await page.evaluate(() => document.querySelectorAll('*').length).catch(() => 0);

            // 【復元】タグ数150以上を成功の基準とする
            if ((/\/n[a-z0-9]+\/edit/.test(url) || url.includes('editor.note.com')) && tagCount > 150 && !url.endsWith('/new')) {
                update('S04', `Editor Connected (Tags: ${tagCount})`);
                editorBound = true;
                break;
            }

            update('S04', `Step 04 Sync (${i + 1}/15): Tags=${tagCount}`);

            // 【進化】Tags=40等で固まった時だけピンポイント刺激
            if (i > 3 && tagCount < 100) {
                if (i % 4 === 0) {
                    update('S04', 'Skeleton stall. Hard Resetting...');
                    await page.goto('https://note.com/notes/new', { waitUntil: 'domcontentloaded' }).catch(() => { });
                } else {
                    await page.mouse.click(720, 450).catch(() => { });
                    await page.keyboard.press('Escape'); // モーダルが裏で出てる可能性を潰す
                }
            }
            await page.waitForTimeout(4000);
        }

        if (!editorBound) throw new Error("Editor hydration failed (Stayed at skeleton)");

        // --- S05: Tutorial Bypass (Pure Recovery) ---
        update('S05', 'Ghost Bypass: Clearing Editor Tutorials');
        await page.waitForTimeout(4000);
        await page.evaluate(() => {
            const skipT = ["次へ", "閉じる", "スキップ", "理解しました", "OK", "×"];
            document.querySelectorAll('button, div[role="button"], span, a').forEach((el: any) => {
                const txt = (el.textContent || "").trim();
                const aria = (el.getAttribute('aria-label') || "");
                if (skipT.some(t => txt.includes(t) || aria.includes(t))) el.click();
            });
            document.querySelectorAll('.nc-modal, .nc-tutorial-modal, .nc-modal-backdrop, .nc-popover').forEach(el => el.remove());
            document.body.style.overflow = 'auto';
        }).catch(() => { });
        await page.waitForTimeout(2000);
        await page.mouse.click(1100, 100).catch(() => { }); // 欄外クリックで念押し

        // --- S06: Injection Analysis ---
        update('S06', 'Inspecting Editor Areas');
        let editorFound = false;
        for (let i = 0; i < 5; i++) {
            const hasEditor = await page.evaluate(() => !!document.querySelector('.ProseMirror, .note-editor, [contenteditable="true"]'));
            if (hasEditor) {
                editorFound = true;
                break;
            }
            update('S06', `Waiting for Editor mount (${i + 1}/5)`);
            await page.keyboard.press('Escape');
            await page.waitForTimeout(4000);
        }

        if (!editorFound) throw new Error("Editor areas not found");

        // --- S07~S10: Injection (The Ghost Way) ---
        const selectors = await page.evaluate(() => {
            const title = document.querySelector('h1, textarea[placeholder*="タイトル"], input[placeholder*="タイトル"]');
            const body = document.querySelector('.ProseMirror, .note-editor__body, [contenteditable="true"]');
            return {
                title: title ? (title.id ? `#${title.id}` : 'textarea') : 'textarea',
                body: body ? '.ProseMirror' : '.ProseMirror'
            };
        });

        const inject = async (sel: string, txt: string, isBody: boolean) => {
            const el = page.locator(sel).first();
            await el.scrollIntoViewIfNeeded();
            await el.click();
            await page.waitForTimeout(1000);
            const chunkLen = isBody ? 130 : 25;
            const chunks = txt.match(new RegExp(`[\\s\\S]{1,${chunkLen}}`, 'g')) || [txt];
            for (const chunk of chunks) {
                await page.evaluate(({ s, t }: { s: string, t: string }) => {
                    const target = document.querySelector(s) as any;
                    if (target) { target.focus(); document.execCommand('insertText', false, t); }
                }, { s: sel, t: chunk });
                await page.waitForTimeout(350 + Math.random() * 400);
            }
        };

        update('S07', 'Injecting Title...');
        await inject(selectors.title, content.title, false);
        update('S08', 'Injecting Body...');
        await inject(selectors.body, content.body, true);

        update('S10', 'Finalizing Draft Save');
        await page.click('button:has-text("下書き保存")').catch(() => page.mouse.click(1240, 50));
        await page.waitForTimeout(6000);

        job.status = 'success';
        job.finished_at = new Date().toISOString();
        job.note_url = page.url();
        update('S99', 'Success: Note Drafted');
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
