import { NextRequest, NextResponse } from "next/server";
import { chromium as playwright } from "playwright-core";
import fs from "fs";
import path from "path";
import { DEV_SETTINGS, validateDevMode } from "@/lib/server/flags";
import { getAllJobs, saveJob, NoteJob } from "@/lib/server/jobs";

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
            email,
            password
        } = await req.json();

        console.log(`[API] Note Draft Request Received. Mode=${mode}, Env=${isServerless ? 'Production' : 'Local'}`);

        if (!validateDevMode(mode)) {
            return NextResponse.json({ error: "Forbidden" }, { status: 403 });
        }

        if (!DEV_SETTINGS.AUTO_POST_ENABLED) {
            return NextResponse.json({ error: "Auto-post is disabled" }, { status: 503 });
        }

        const allJobs = getAllJobs();
        if (allJobs.find(j => j.article_id === article_id && j.status === 'success')) {
            return NextResponse.json({ status: 'skipped', message: 'Already posted' });
        }

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

        // 504 Timeout対策: 実行をawaitせずバックグラウンドで走らせたいが、
        // Vercelはレスポンス後に殺すため、ここではawaitしつつ極限まで高速化する。
        const result = await runNoteDraftAction(job, { title, body, tags, email, password });
        return NextResponse.json(result);
    } catch (e: any) {
        console.error(`[API] Fatal Crash:`, e);
        return NextResponse.json({ error: "Internal Error", status: 'failed' }, { status: 500 });
    }
}

async function runNoteDraftAction(job: NoteJob, content: { title: string, body: string, tags?: string[], email?: string, password?: string }) {
    console.log(`[Action] Starting action for ${job.job_id}`);
    job.status = 'running';
    job.started_at = new Date().toISOString();
    saveJob(job);

    let browser: any;
    let page: any;

    const captureFailure = async (step: string, err: any) => {
        console.error(`[Action] Step ${step} failed:`, err.message);
        job.status = 'failed';
        job.last_step = step;
        job.error_code = 'STEP_FAILED';
        job.error_message = err.message;
        job.finished_at = new Date().toISOString();
        saveJob(job);
        try {
            if (page) {
                if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
                await page.screenshot({ path: path.join(LOG_DIR, `${step}_fail.png`) });
            }
        } catch (e) { }
    };

    try {
        const BROWSERLESS_TOKEN = process.env.BROWSERLESS_API_KEY || process.env.BROWSERLESS_TOKEN;

        // 1. 接続 (高速化のため CDP優先)
        if (isServerless) {
            browser = await playwright.connectOverCDP(`wss://chrome.browserless.io?token=${BROWSERLESS_TOKEN}`, { timeout: 15000 });
        } else {
            browser = await playwright.launch({ headless: true });
        }

        const context = await browser.newContext();
        if (fs.existsSync(SESSION_FILE)) {
            const state = JSON.parse(fs.readFileSync(SESSION_FILE, 'utf-8'));
            await context.addCookies(state.cookies || []);
        }

        page = await context.newPage();

        // 2. ページ遷移 (domcontentloadedで時間を稼ぐ)
        job.last_step = 'S01_goto_new';
        saveJob(job);
        await page.goto('https://note.com/notes/new', { waitUntil: 'domcontentloaded', timeout: 30000 });

        // 3. ログインチェック
        if (page.url().includes('/login')) {
            console.log("[Action] Session expired, logging in...");
            job.last_step = 'S02_login';
            saveJob(job);
            if (content.email && content.password) {
                await page.fill('input[type="email"], #email', content.email);
                await page.fill('input[type="password"]', content.password);
                await page.click('button[type="submit"]');
                await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 20000 });

                const state = await context.storageState();
                if (!fs.existsSync(path.dirname(SESSION_FILE))) fs.mkdirSync(path.dirname(SESSION_FILE), { recursive: true });
                fs.writeFileSync(SESSION_FILE, JSON.stringify(state));

                await page.goto('https://note.com/notes/new', { waitUntil: 'domcontentloaded' });
            } else {
                throw new Error("Login required but no credentials provided.");
            }
        }

        // 4. コンテンツ入力
        job.last_step = 'S03_filling';
        saveJob(job);

        // エディタのポップアップをEscapeで消す
        await page.keyboard.press('Escape');
        await page.waitForTimeout(1000);

        const titleInput = page.locator('textarea[placeholder*="タイトル"], [placeholder*="記事タイトル"], h1[contenteditable="true"]').first();
        await titleInput.waitFor({ state: 'visible', timeout: 20000 });
        await titleInput.fill(content.title);

        const bodyInput = page.locator('[role="textbox"], .note-common-editor__editable, [placeholder*="書いてみませんか"]').first();
        await bodyInput.waitFor({ state: 'visible', timeout: 15000 });
        await bodyInput.click();
        await page.keyboard.type(content.body);

        // 念のため自動保存を待つ
        await page.waitForTimeout(3000);

        job.status = 'success';
        job.finished_at = new Date().toISOString();
        job.note_url = page.url();
        job.last_step = 'S99_complete';
        saveJob(job);

        await browser.close();
        return { status: 'success', job_id: job.job_id, note_url: job.note_url };

    } catch (e: any) {
        await captureFailure(job.last_step || 'FATAL', e);
        if (browser) await browser.close();
        return {
            status: 'failed',
            error_message: e.message,
            last_step: job.last_step
        };
    }
}
