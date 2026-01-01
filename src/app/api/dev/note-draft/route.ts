import { NextRequest, NextResponse } from "next/server";
import { chromium as playwright } from "playwright-core";
import chromium from "@sparticuz/chromium";
import fs from "fs";
import path from "path";
import { DEV_SETTINGS, validateDevMode } from "@/lib/server/flags";
import { getAllJobs, saveJob, NoteJob } from "@/lib/server/jobs";

// 認証情報のパス（Vercel等の制限を回避するため、書き込みが必要な場合は /tmp を使用）
const isServerless = process.env.VERCEL === '1' || process.env.NODE_ENV === 'production';
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

        console.log(`[API] Note Draft Request Received: article_id=${article_id}, mode=${mode}`);

        // --- 安全柵 1: モードチェック ---
        if (!validateDevMode(mode)) {
            console.warn(`[API] Forbidden: Draft requested in production mode.`);
            return NextResponse.json({ error: "Forbidden: Production mode cannot access Note API" }, { status: 403 });
        }

        // --- 安全柵 2: 緊急停止フラグ ---
        if (!DEV_SETTINGS.AUTO_POST_ENABLED) {
            console.warn(`[API] Service Unavailable: Auto-post is disabled by flags.`);
            return NextResponse.json({ error: "Auto-post is disabled by flags" }, { status: 503 });
        }

        // --- 安全柵 3: 冪等性チェック (Article ID & Request ID) ---
        const allJobs = getAllJobs();
        if (allJobs.find(j => j.article_id === article_id && j.status === 'success')) {
            console.log(`[API] Skipped: Article ${article_id} already posted successfully.`);
            return NextResponse.json({ status: 'skipped', message: 'Article already posted' });
        }
        if (allJobs.find(j => j.request_id === request_id)) {
            console.log(`[API] Skipped: Request ID ${request_id} already processed.`);
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
        console.log(`[API] Job Created: ${job.job_id}`);

        // 非同期で実行（Next.js Edge Runtimeなどでは工夫が必要だが、ここでは標準的なAPI環境を想定）
        // 実際には 202 Accepted を返してバックグラウンドで処理するのが望ましいが、Next.js API Routesの制約内で同期的に実行する

        const result = await runNoteDraftAction(job, { title, body, tags, email, password });

        console.log(`[API] Action Result: ${result.status}`);
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
    console.log(`[Action] Starting NoteDraftAction for job ${job.job_id}`);
    job.status = 'running';
    job.started_at = new Date().toISOString();
    saveJob(job);

    let browser: any;
    let page: any;
    try {
        console.log(`[Action] Launching browser (Serverless: ${isServerless})...`);

        if (isServerless) {
            // Vercel / Production environment
            browser = await playwright.launch({
                args: chromium.args,
                executablePath: await chromium.executablePath(),
                headless: chromium.headless,
            });
        } else {
            // Local development environment
            browser = await playwright.launch({ headless: true });
        }

        // セッションがあれば読み込む
        const context = fs.existsSync(SESSION_FILE)
            ? await browser.newContext({ storageState: SESSION_FILE })
            : await browser.newContext();

        page = await context.newPage();

        // スクショ用ディレクトリ作成
        if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });

        const captureFailure = async (step: string, err: any) => {
            console.error(`[Action] Step ${step} failed:`, err);
            const ts = Date.now();
            try {
                if (page) {
                    await page.screenshot({ path: path.join(LOG_DIR, `${step}_${ts}_fail.png`) });
                    const html = await page.content();
                    fs.writeFileSync(path.join(LOG_DIR, `${step}_${ts}_fail.html`), html);
                }
            } catch (e) { console.error("Failed to capture evidence", e); }

            job.status = 'failed';
            job.last_step = step;
            job.error_code = 'STEP_FAILED';
            job.error_message = err.message;
            job.finished_at = new Date().toISOString();
            saveJob(job);
        };

        // S01: Load Session & Access Editor
        console.log(`[Action] Loading editor page...`);
        job.last_step = 'S01_load_session';
        saveJob(job);
        try {
            await page.goto('https://note.com/notes/new', { waitUntil: 'networkidle', timeout: 30000 });
        } catch (e) {
            await captureFailure('S01_load_session', e);
            throw e;
        }

        // S03: Verify Login
        job.last_step = 'S03_verify_login';
        saveJob(job);

        // ログインが必要な場合
        if (page.url().includes('login')) {
            console.log(`[Action] Login required. Attempting with credentials...`);
            if (content.email && content.password) {
                job.last_step = 'S02b_login_attempt';
                saveJob(job);

                try {
                    // ログイン実行
                    await page.goto('https://note.com/login', { waitUntil: 'networkidle' });
                    await page.fill('input[name="mail"]', content.email);
                    await page.fill('input[name="password"]', content.password);
                    await page.click('button:has-text("ログイン")');

                    // ログイン成功を待つ（エディタまたはトップページへ遷移）
                    console.log(`[Action] Waiting for navigation after login...`);
                    await page.waitForNavigation({ waitUntil: 'networkidle', timeout: 45000 });

                    // セッションを保存して次回からログイン不要にする
                    const state = await context.storageState();
                    if (!fs.existsSync(path.dirname(SESSION_FILE))) {
                        fs.mkdirSync(path.dirname(SESSION_FILE), { recursive: true });
                    }
                    fs.writeFileSync(SESSION_FILE, JSON.stringify(state));

                    // 再度エディタへ
                    console.log(`[Action] Navigating back to editor...`);
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

        // S04: Fill Title
        console.log(`[Action] Filling title...`);
        job.last_step = 'S04_fill_title';
        saveJob(job);
        try {
            await page.waitForSelector('.note-editor-v3__title-textarea', { timeout: 20000 });
            await page.fill('.note-editor-v3__title-textarea', content.title);
        } catch (e) {
            await captureFailure('S04_fill_title', e);
            throw e;
        }

        // S05: Fill Body
        console.log(`[Action] Filling body...`);
        job.last_step = 'S05_fill_body';
        saveJob(job);
        try {
            // noteのeditorは ProseMirror 等の複雑な構造の場合があるが、ここでは標準的な textarea/contenteditable を想定した簡易版
            // 実際には [role="textbox"] や [contenteditable="true"] を狙う
            const bodySelector = '.note-editor-v3__body-content [role="textbox"]';
            await page.waitForSelector(bodySelector, { timeout: 20000 });
            await page.click(bodySelector);
            await page.keyboard.type(content.body);
        } catch (e) {
            await captureFailure('S05_fill_body', e);
            throw e;
        }

        // S07: Click Draft Save
        console.log(`[Action] Clicking draft save...`);
        job.last_step = 'S07_click_draft_save';
        saveJob(job);
        try {
            // 「保存」または「下書き保存」ボタンを探す
            const saveButton = page.getByRole('button', { name: /下書き保存|保存/ });
            await saveButton.click();
        } catch (e) {
            await captureFailure('S07_click_draft_save', e);
            throw e;
        }

        // S08: Confirm Saved
        console.log(`[Action] Waiting for save confirmation...`);
        job.last_step = 'S08_confirm_saved';
        saveJob(job);
        await page.waitForTimeout(5000); // 保存完了を余裕を持って待つ

        // S09: Capture Result
        job.last_step = 'S09_capture_result';
        job.note_url = page.url();
        job.status = 'success';
        job.posted_at = new Date().toISOString();
        job.finished_at = new Date().toISOString();
        saveJob(job);
        console.log(`[Action] Draft saved successfully: ${job.note_url}`);

        await browser.close();
        return job;

    } catch (error: any) {
        console.error("[Action] Fatal error during Note draft action:", error);
        if (browser) await browser.close();
        job.status = 'failed';
        job.error_message = error?.message || "Internal Server Error during browser automation";
        saveJob(job);
        return job;
    }
}
