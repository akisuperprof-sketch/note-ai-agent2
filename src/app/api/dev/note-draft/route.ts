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

        // 504回避のため、awaitせずにレスポンスを返したいところですが、
        // Vercelはレスポンス後に処理を停止するため、極限まで高速化して回します。
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

    try {
        const BROWSERLESS_TOKEN = process.env.BROWSERLESS_API_KEY || process.env.BROWSERLESS_TOKEN;
        browser = await playwright.connectOverCDP(`wss://chrome.browserless.io?token=${BROWSERLESS_TOKEN}`, { timeout: 15000 });
        const context = await browser.newContext();

        if (fs.existsSync(SESSION_FILE)) {
            const state = JSON.parse(fs.readFileSync(SESSION_FILE, 'utf-8'));
            await context.addCookies(state.cookies || []);
        }

        page = await context.newPage();

        // 1. エディタへ移動
        job.last_step = 'S01_goto';
        saveJob(job);
        await page.goto('https://note.com/notes/new', { waitUntil: 'domcontentloaded', timeout: 30000 });

        // 2. ログイン判定（より柔軟な検索）
        if (page.url().includes('/login')) {
            job.last_step = 'S02_login';
            saveJob(job);
            if (content.email && content.password) {
                await page.fill('input[type="email"], input[name="mail"], #email', content.email);
                await page.fill('input[type="password"], input[name="password"]', content.password);
                // ログインボタンをテキストで探す
                const loginBtn = page.locator('button:has-text("ログイン"), button[type="submit"], .p-login__submit').first();
                await loginBtn.click();
                await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 20000 });

                const state = await context.storageState();
                if (!fs.existsSync(path.dirname(SESSION_FILE))) fs.mkdirSync(path.dirname(SESSION_FILE), { recursive: true });
                fs.writeFileSync(SESSION_FILE, JSON.stringify(state));
                await page.goto('https://note.com/notes/new', { waitUntil: 'domcontentloaded' });
            } else {
                throw new Error("Login required.");
            }
        }

        // 3. スマート・セレクタ特定 (ユーザー提案のロジックを内蔵)
        job.last_step = 'S03_find_selectors';
        saveJob(job);

        // エディタの初期化を待つ
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

                // タイトルスコア
                let sTitle = 0;
                if (ph.includes("タイトル") || ph.includes("title")) sTitle += 10;
                if (aria.includes("タイトル") || aria.includes("title")) sTitle += 10;
                if (tag === "TEXTAREA" && rect.top < 400) sTitle += 5;
                if (tag === "INPUT") sTitle += 2;

                // 本文スコア
                let sBody = 0;
                if (ce === "true" || role === "textbox") sBody += 10;
                if (ph.includes("書いてみませんか") || ph.includes("本文") || ph.includes("content")) sBody += 10;
                if (rect.height > 100) sBody += 5;

                // セレクタ生成 (testid優先)
                let selector = el.tagName.toLowerCase();
                if (el.getAttribute("data-testid")) selector = `[data-testid="${el.getAttribute("data-testid")}"]`;
                else if (el.getAttribute("name")) selector = `[name="${el.getAttribute("name")}"]`;
                else if (el.getAttribute("id")) selector = `#${el.getAttribute("id")}`;
                else if (el.getAttribute("placeholder")) selector = `${el.tagName.toLowerCase()}[placeholder="${el.getAttribute("placeholder")}"]`;

                candidates.push({ selector, sTitle, sBody, tag });
            });

            return {
                title: candidates.sort((a, b) => b.sTitle - a.sTitle)[0]?.selector,
                body: candidates.sort((a, b) => b.sBody - a.sBody)[0]?.selector
            };
        });

        console.log(`[SmartSelector] Picked Title: ${bestSelectors.title}, Body: ${bestSelectors.body}`);

        // 4. 入力
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
            await page.keyboard.type(content.body);
        }

        await page.waitForTimeout(3000); // 保存待ち

        job.status = 'success';
        job.finished_at = new Date().toISOString();
        job.note_url = page.url();
        job.last_step = 'S99_complete';
        saveJob(job);

        await browser.close();
        return { status: 'success', job_id: job.job_id, note_url: job.note_url };

    } catch (e: any) {
        if (browser) await browser.close();
        job.status = 'failed';
        job.error_message = e.message;
        saveJob(job);
        return { status: 'failed', error_message: e.message, last_step: job.last_step };
    }
}
