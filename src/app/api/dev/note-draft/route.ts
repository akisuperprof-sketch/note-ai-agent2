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
                // Wait for any login input to be present
                await page.waitForSelector('input[type="email"], input[name="mail"], #email', { timeout: 15000 });

                await page.fill('input[type="email"], input[name="mail"], #email', content.email);
                await page.fill('input[type="password"], input[name="password"]', content.password);

                // Find and click the login button by text or common selectors
                const loginBtn = page.locator('button:has-text("ログイン"), button[type="submit"], .nc-login__submit-button').first();
                await loginBtn.click();

                // Wait for navigation or a successful login indicator
                try {
                    await page.waitForURL((u: URL) => !u.href.includes('/login'), { timeout: 20000 });
                    console.log(`[Action] Login successful. URL: ${page.url()}`);
                } catch (e) {
                    // Check if there's an error message on the page
                    const errorText = await page.textContent('.nc-login__error, [role="alert"]').catch(() => null);
                    if (errorText) throw new Error(`ログインに失敗しました: ${errorText.trim()}`);
                    throw new Error("ログイン後の遷移がタイムアウトしました。アカウント情報を再確認してください。");
                }

                const state = await context.storageState();
                if (!fs.existsSync(path.dirname(SESSION_FILE))) fs.mkdirSync(path.dirname(SESSION_FILE), { recursive: true });
                fs.writeFileSync(SESSION_FILE, JSON.stringify(state));

                await page.goto('https://note.com/notes/new', { waitUntil: 'domcontentloaded' });
            } else {
                throw new Error("Login required but credentials not provided.");
            }
        }

        // Verify Login Identity (Diagnostic)
        try {
            const userName = await page.locator('.nc-header-account-menu__profile-name, [aria-label*="メニュー"]').first().textContent();
            console.log(`[Diagnostic] Logged in as: ${userName?.trim() || 'Unknown'}`);
        } catch (e) {
            console.warn("[Diagnostic] Could not determine user name.");
        }

        job.last_step = 'S02b_bypass_tutorials';
        saveJob(job);
        try {
            // Wait a bit for potential overlays to appear
            await page.waitForTimeout(2000);
            const overlaySelectors = [
                'button:has-text("次へ")',
                'button:has-text("閉じる")',
                '.nc-tutorial-modal__close',
                '.nc-survey-modal__close',
                'div[aria-label="閉じる"]'
            ];
            for (const sel of overlaySelectors) {
                const btn = page.locator(sel).first();
                if (await btn.isVisible()) {
                    console.log(`[Action] Closing overlay: ${sel}`);
                    await btn.click();
                    await page.waitForTimeout(500);
                }
            }
        } catch (e) {
            console.warn("[Action] Tutorial bypass error or nothing found.");
        }

        job.last_step = 'S03_find_selectors';
        saveJob(job);

        // Wait for the editor to stabilize
        await page.waitForTimeout(5000);

        const bestSelectors = await page.evaluate(() => {
            const getSelector = (el: Element) => {
                const tid = el.getAttribute("data-testid") || el.getAttribute("data-test-id");
                if (tid) return `[data-testid="${tid}"]`;
                if (el.getAttribute("id")) return `#${el.getAttribute("id")}`;
                return null;
            };

            const titleEl = document.querySelector('textarea[placeholder="記事タイトル"], h1[contenteditable="true"]');
            const bodyEl = document.querySelector('div.ProseMirror[role="textbox"], .note-editor');
            const saveBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent?.includes('下書き保存'));

            return {
                title: titleEl ? (getSelector(titleEl) || 'textarea[placeholder="記事タイトル"]') : null,
                body: bodyEl ? (getSelector(bodyEl) || 'div.ProseMirror[role="textbox"]') : null,
                save: saveBtn ? 'button:has-text("下書き保存")' : null
            };
        });

        console.log(`[Diagnostic] Final Selectors:`, bestSelectors);

        if (!bestSelectors.title || !bestSelectors.body) {
            throw new Error(`記事入力フィールドが見つかりませんでした。URL: ${page.url()} (Title: ${!!bestSelectors.title}, Body: ${!!bestSelectors.body})`);
        }

        const forceInput = async (selector: string, text: string, isBody: boolean = false) => {
            const el = page.locator(selector).first();
            await el.scrollIntoViewIfNeeded();
            await el.click();
            await page.waitForTimeout(500);

            // For React-based editors, sometimes simple fill is not enough
            await page.evaluate(({ sel, txt, bodyMode }: { sel: string, txt: string, bodyMode: boolean }) => {
                const element = document.querySelector(sel) as any;
                if (!element) return;
                if (bodyMode) {
                    element.innerHTML = `<p>${txt}</p>`;
                } else {
                    const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")?.set;
                    if (nativeSetter) nativeSetter.call(element, txt);
                    else element.value = txt;
                }
                element.dispatchEvent(new Event('input', { bubbles: true }));
                element.dispatchEvent(new Event('change', { bubbles: true }));
            }, { sel: selector, txt: text, bodyMode: isBody });

            // Also use keyboard to trigger auto-save logic
            await page.keyboard.press('End');
            await page.keyboard.type(' ', { delay: 10 });
            await page.keyboard.press('Backspace');
        };

        job.last_step = 'S04_input_title';
        saveJob(job);
        await forceInput(bestSelectors.title, content.title);

        job.last_step = 'S05_input_body';
        saveJob(job);
        await forceInput(bestSelectors.body, content.body, true);

        job.last_step = 'S06_click_save';
        saveJob(job);
        if (bestSelectors.save) {
            console.log(`[Action] Clicking Save Draft button.`);
            await page.click(bestSelectors.save);
            await page.waitForTimeout(3000);
        } else {
            // Fallback for save button if selector was missed
            await page.click('button:has-text("下書き保存")').catch(() => { });
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
