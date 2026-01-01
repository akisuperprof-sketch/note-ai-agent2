import { NextRequest, NextResponse } from "next/server";
import { chromium as playwright } from "playwright-core";
import fs from "fs";
import path from "path";
import { DEV_SETTINGS, validateDevMode } from "@/lib/server/flags";
import { getAllJobs, saveJob, NoteJob } from "@/lib/server/jobs";

// 認証情報のパス（Vercel等の制限を回避するため、書き込みが必要な場合は /tmp を使用）
const isServerless = !!(process.env.VERCEL || process.env.AWS_EXECUTION_ENV || process.env.NODE_ENV === 'production');
const SESSION_FILE = isServerless
    ? path.join('/tmp', 'note_session.json')
    : path.join(process.cwd(), '.secret/note_session.json');
const LOG_DIR = isServerless
    ? path.join('/tmp', 'logs')
    : path.join(process.cwd(), '.gemini/data/logs');

export async function POST(req: NextRequest) {
    try {
        const {
            article_id,
            title,
            body,
            tags,
            mode,
            request_id,
            scheduled_at,
            email,
            password
        } = await req.json();

        console.log(`[API] Note Draft Request Received. Mode=${mode}, Env=${isServerless ? 'Production' : 'Local'}`);

        // --- 安全柵 1: モードチェック ---
        if (!validateDevMode(mode)) {
            return NextResponse.json({ error: "Forbidden: Production mode cannot access Note API" }, { status: 403 });
        }

        // --- 安全柵 2: 緊急停止フラグ ---
        if (!DEV_SETTINGS.AUTO_POST_ENABLED) {
            return NextResponse.json({ error: "Auto-post is disabled by flags" }, { status: 503 });
        }

        // --- 安全柵 3: 冪等性チェック ---
        const allJobs = getAllJobs();
        if (allJobs.find(j => j.article_id === article_id && j.status === 'success')) {
            return NextResponse.json({ status: 'skipped', message: 'Article already posted' });
        }
        if (allJobs.find(j => j.request_id === request_id)) {
            return NextResponse.json({ status: 'skipped', message: 'Request ID already used' });
        }

        // ジョブ作成
        const job: NoteJob = {
            job_id: `job_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
            article_id,
            request_id,
            mode: 'development',
            status: 'pending',
            attempt_count: 1,
            created_at: new Date().toISOString(),
            started_at: null,
            finished_at: null,
            posted_at: null,
            note_url: null,
            error_code: null,
            error_message: null,
            last_step: 'S00_init'
        };

        saveJob(job);
        const result = await runNoteDraftAction(job, { title, body, tags, email, password });
        return NextResponse.json(result);
    } catch (e: any) {
        console.error(`[API] Fatal Crash:`, e);
        return NextResponse.json({
            error: "Internal Server Error",
            error_message: e instanceof Error ? e.message : String(e),
            status: 'failed'
        }, { status: 500 });
    }
}

async function runNoteDraftAction(job: NoteJob, content: { title: string, body: string, tags?: string[], email?: string, password?: string }) {
    console.log(`[Action] Starting NoteDraftAction. Env: ${isServerless ? 'Production' : 'Local'}`);
    job.status = 'running';
    job.started_at = new Date().toISOString();
    saveJob(job);

    let browser: any;
    let page: any;
    try {
        const BROWSERLESS_TOKEN = process.env.BROWSERLESS_API_KEY || process.env.BROWSERLESS_TOKEN;

        if (isServerless) {
            if (!BROWSERLESS_TOKEN) {
                console.error("[Action] CRITICAL: BROWSERLESS_API_KEY is not set.");
                throw new Error("APIキーが設定されていません。");
            }

            job.last_step = 'S00b_connecting';
            saveJob(job);
            console.log(`[Action] Connecting to Browserless.io (CDP)...`);

            try {
                browser = await playwright.connectOverCDP(
                    `wss://chrome.browserless.io?token=${BROWSERLESS_TOKEN}`,
                    { timeout: 15000 }
                );
            } catch (e: any) {
                console.warn("[Action] CDP Connection failed, falling back to Playwright native...", e.message);
                browser = await playwright.connect({
                    wsEndpoint: `wss://chrome.browserless.io/playwright?token=${BROWSERLESS_TOKEN}`,
                    timeout: 15000
                });
            }
        } else {
            console.log(`[Action] Launching standard chromium (Local)...`);
            browser = await playwright.launch({ headless: true });
        }

        const context = fs.existsSync(SESSION_FILE)
            ? await browser.newContext({ storageState: SESSION_FILE })
            : await browser.newContext();

        page = await context.newPage();

        if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });

        const captureFailure = async (step: string, err: any) => {
            console.error(`[Action] Step ${step} failed:`, err);
            const ts = Date.now();
            try {
                if (page) {
                    await page.screenshot({ path: path.join(LOG_DIR, `${step}_${ts}_fail.png`) });
                }
            } catch (e) { console.error("Failed to capture evidence", e); }

            job.status = 'failed';
            job.last_step = step;
            job.error_code = 'STEP_FAILED';
            job.error_message = err.message;
            job.finished_at = new Date().toISOString();
            saveJob(job);
        };

        // S01: Load Session / Login Check
        job.last_step = 'S01_load_session';
        saveJob(job);
        console.log(`[Action] Loading session/editor...`);
        await page.goto('https://note.com/notes/new', { waitUntil: 'networkidle', timeout: 30000 });

        const isLoginPage = page.url().includes('note.com/login');
        if (isLoginPage || !fs.existsSync(SESSION_FILE)) {
            console.log(`[Action] Session invalid or not found. Attempting login...`);
            if (content.email && content.password) {
                try {
                    job.last_step = 'S02b_login_attempt';
                    saveJob(job);
                    await page.goto('https://note.com/login', { waitUntil: 'networkidle', timeout: 30000 });

                    const mailSelector = 'input[name="mail"], input[type="email"], #email';
                    await page.waitForSelector(mailSelector, { state: 'visible', timeout: 20000 });
                    await page.fill(mailSelector, content.email);
                    await page.fill('input[name="password"], input[type="password"]', content.password);

                    const loginBtn = 'button:has-text("ログイン"), button[type="submit"]';
                    await page.click(loginBtn);

                    await page.waitForNavigation({ waitUntil: 'networkidle', timeout: 45000 });

                    const state = await context.storageState();
                    if (!fs.existsSync(path.dirname(SESSION_FILE))) {
                        fs.mkdirSync(path.dirname(SESSION_FILE), { recursive: true });
                    }
                    fs.writeFileSync(SESSION_FILE, JSON.stringify(state));

                    await page.goto('https://note.com/notes/new', { waitUntil: 'networkidle', timeout: 30000 });
                } catch (e) {
                    await captureFailure('S02b_login_attempt', e);
                    throw e;
                }
            } else {
                const err = new Error('Note session expired and no credentials provided.');
                await captureFailure('S03_verify_login', err);
                throw err;
            }
        }

        // S04: Content Input
        try {
            await page.waitForTimeout(7000); // 新エディタは重いため長めに待機

            const currentUrl = page.url();
            console.log(`[Action] Current URL before input: ${currentUrl}`);

            // 現在のURLをステップ名に含めて可視化
            const urlKey = currentUrl.includes('editor.note.com') ? 'new_editor' : (currentUrl.split('/').pop() || 'unknown');
            job.last_step = `S04_at_${urlKey}`;
            saveJob(job);

            // エディタ画面であることを確認（URLに editor.note.com が含まれていればOKとする）
            const isEditor = currentUrl.includes('editor.note.com') || await page.evaluate(() => {
                return !!document.querySelector('.note-editor-v3, .note-common-editor, [placeholder*="タイトル"], [placeholder*="書いてみませんか"]');
            });

            if (!isEditor) {
                console.warn(`[Action] Not on editor page. URL: ${currentUrl}`);
                throw new Error(`エディタ画面にたどり着けませんでした。ログインに失敗したか、予期せぬページにリダイレクトされました。`);
            }

            job.last_step = 'S04_fill_title';
            saveJob(job);
            console.log(`[Action] Filling title...`);
            // 「記事タイトル」というプレースホルダーに対応
            const titleSelector = 'textarea[placeholder*="タイトル"], .note-editor-v3__title-textarea, #note-title-input';
            await page.waitForSelector(titleSelector, { state: 'visible', timeout: 30000 });
            await page.fill(titleSelector, content.title);

            job.last_step = 'S05_fill_body';
            saveJob(job);
            console.log(`[Action] Filling body...`);
            // 「書いてみませんか？」というプレースホルダー、または role="textbox" に対応
            const bodySelector = '[role="textbox"], .note-common-editor__editable, [placeholder*="書いてみませんか"], .lavender-editor__content';
            await page.waitForSelector(bodySelector, { state: 'visible', timeout: 20000 });
            await page.click(bodySelector);
            await page.keyboard.type(content.body, { delay: 5 }); // 1文字ずつ確実に入力

            await page.waitForTimeout(5000); // 保存待ち

            job.status = 'success';
            job.finished_at = new Date().toISOString();
            job.posted_at = new Date().toISOString();
            job.note_url = page.url();
            job.last_step = 'S99_complete';
            saveJob(job);

            await browser.close();
            return { status: 'success', note_url: job.note_url };
        } catch (e) {
            await captureFailure('S04_fill_content', e);
            throw e;
        }

    } catch (e: any) {
        if (browser) await browser.close();
        console.error(`[Action] Fatal Error:`, e);
        return {
            status: 'failed',
            error_message: e.message,
            last_step: job.last_step
        };
    }
}
