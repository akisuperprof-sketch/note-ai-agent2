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
        const { article_id, title, body, mode, request_id, email, password } = await req.json();

        if (!validateDevMode(mode)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
        if (!DEV_SETTINGS.AUTO_POST_ENABLED) return NextResponse.json({ error: "Disabled" }, { status: 503 });

        const job: NoteJob = {
            job_id: `job_${Date.now()}`,
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

        const result = await runNoteDraftAction(job, { title, body, email, password });
        return NextResponse.json(result);
    } catch (e: any) {
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}

async function runNoteDraftAction(job: NoteJob, content: { title: string, body: string, email?: string, password?: string }) {
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

        job.last_step = 'S01_goto_new';
        saveJob(job);
        await page.goto('https://note.com/notes/new', { waitUntil: 'domcontentloaded', timeout: 30000 });

        if (page.url().includes('/login')) {
            console.log("[Action] Login starting...");
            job.last_step = 'S02_login';
            saveJob(job);
            if (content.email && content.password) {
                await page.fill('input[type="email"], #email', content.email);
                await page.fill('input[type="password"]', content.password);
                await page.click('button:has-text("ログイン"), button[type="submit"]');
                await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 20000 });

                const state = await context.storageState();
                if (!fs.existsSync(path.dirname(SESSION_FILE))) fs.mkdirSync(path.dirname(SESSION_FILE), { recursive: true });
                fs.writeFileSync(SESSION_FILE, JSON.stringify(state));

                await page.goto('https://note.com/notes/new', { waitUntil: 'domcontentloaded' });
            } else {
                throw new Error("Login required.");
            }
        }

        job.last_step = 'S03_find_selectors';
        saveJob(job);
        await page.waitForTimeout(5000);
        await page.keyboard.press('Escape');

        const bestSelectors = await page.evaluate(() => {
            const candidates: any[] = [];
            const els = document.querySelectorAll("input, textarea, [contenteditable='true'], [role='textbox']");
            els.forEach(el => {
                const rect = el.getBoundingClientRect();
                if (rect.width < 40 || rect.height < 14) return;
                const ph = (el.getAttribute("placeholder") || "").toLowerCase();
                const aria = (el.getAttribute("aria-label") || "").toLowerCase();
                const role = el.getAttribute("role") || "";
                const ce = el.getAttribute("contenteditable") || "";
                const tag = el.tagName;
                let sTitle = 0;
                if (ph.includes("タイトル") || ph.includes("title")) sTitle += 10;
                if (aria.includes("タイトル") || aria.includes("title")) sTitle += 10;
                if (tag === "TEXTAREA" && rect.top < 400) sTitle += 5;
                let sBody = 0;
                if (ce === "true" || role === "textbox") sBody += 10;
                if (ph.includes("書いてみませんか") || ph.includes("本文")) sBody += 10;
                if (rect.height > 100) sBody += 5;
                let selector = el.tagName.toLowerCase();
                const testid = el.getAttribute("data-testid");
                if (testid) selector = `[data-testid="${testid}"]`;
                else if (el.getAttribute("name")) selector = `[name="${el.getAttribute("name")}"]`;
                else if (el.getAttribute("id")) selector = `#${el.getAttribute("id")}`;
                candidates.push({ selector, sTitle, sBody });
            });
            return {
                title: candidates.sort((a, b) => b.sTitle - a.sTitle)[0]?.selector,
                body: candidates.sort((a, b) => b.sBody - a.sBody)[0]?.selector
            };
        });

        if (!bestSelectors.title || !bestSelectors.body) {
            throw new Error(`記事入力フィールドが見つかりませんでした (Title: ${!!bestSelectors.title}, Body: ${!!bestSelectors.body})`);
        }

        if (bestSelectors.title) {
            job.last_step = 'S04_input_title';
            saveJob(job);
            const t = page.locator(bestSelectors.title).first();
            await t.click();
            await t.fill(content.title);
        }

        if (bestSelectors.body) {
            job.last_step = 'S05_input_body';
            saveJob(job);
            const b = page.locator(bestSelectors.body).first();
            await b.click();
            await page.keyboard.type(content.body, { delay: 1 });
            await page.keyboard.press('Escape');
        }

        // 5. 保存ボタンを明示的にクリック（確実な保存を促す）
        job.last_step = 'S06_click_save';
        saveJob(job);
        try {
            // "公開設定" button is usually the trigger for a stable draft state in the new editor
            const saveBtn = page.locator('button:has-text("公開設定"), button:has-text("保存"), button:has-text("完了")').first();
            if (await saveBtn.isVisible()) {
                console.log(`[Action] Clicking Save/Publish button.`);
                await saveBtn.click();
                await page.waitForTimeout(3000);
            }
        } catch (e) {
            console.warn(`[Action] Save button not found, relying on auto-save.`);
        }

        job.last_step = 'S07_wait_save';
        saveJob(job);
        console.log(`[Action] Waiting for URL transition. Current: ${page.url()}`);

        try {
            // New editor is on editor.note.com, old one on note.com
            await page.waitForURL((u: URL) => {
                const h = u.href;
                return (h.includes('/edit') || h.includes('/notes/n')) && !h.endsWith('/new');
            }, { timeout: 20000 });
            console.log(`[Action] Save detected: ${page.url()}`);
        } catch (e) {
            console.warn(`[Action] URL transition timeout. Final URL: ${page.url()}`);
        }

        await page.waitForTimeout(3000);

        job.status = 'success';
        job.finished_at = new Date().toISOString();
        const finalUrl = page.url();
        job.note_url = finalUrl;

        // If it still says "/new", it means the post likely didn't persist as a draft with a unique ID
        if (finalUrl.endsWith('/new')) {
            throw new Error(`下書きURLの取得に失敗しました。現在のURL: ${finalUrl}`);
        }

        job.last_step = 'S99_complete';
        saveJob(job);

        await browser.close();
        return { status: 'success', job_id: job.job_id, note_url: job.note_url, last_step: job.last_step };

    } catch (e: any) {
        await captureFailure(job.last_step || 'FATAL', e);
        if (browser) await browser.close();
        return { status: 'failed', error_message: e.message, last_step: job.last_step };
    }
}
