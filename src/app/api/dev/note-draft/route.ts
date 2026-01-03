import { NextRequest, NextResponse } from "next/server";
import { chromium as playwright } from "playwright-core";
import fs from "fs";
import path from "path";
import { getDevSettings, validateDevMode } from "@/lib/server/flags";
import { getAllJobs, saveJob, NoteJob } from "@/lib/server/jobs";

const isServerless = !!(process.env.VERCEL || process.env.AWS_EXECUTION_ENV || process.env.NODE_ENV === 'production');
const SESSION_FILE = isServerless
    ? path.join('/tmp', 'note_session.json')
    : path.join(process.cwd(), '.secret/note_session.json');
const LOG_DIR = isServerless
    ? path.join('/tmp', 'logs')
    : path.join(process.cwd(), '.gemini/data/logs');

export async function POST(req: NextRequest) {
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
        async start(controller) {
            const sendUpdate = (data: any) => {
                try {
                    controller.enqueue(encoder.encode(JSON.stringify(data) + "\n"));
                } catch (e) {
                    console.error("[Stream] Controller closed or error:", e);
                }
            };

            // Heartbeat to keep connection alive
            const heartbeat = setInterval(() => {
                sendUpdate({ type: 'heartbeat', time: Date.now() });
            }, 8000);

            try {
                const { article_id, request_id, title, body, tags, scheduled_at, mode, email, password, isTest, visualDebug } = await req.json();

                if (!validateDevMode(mode)) {
                    sendUpdate({ error: "Forbidden" });
                    clearInterval(heartbeat);
                    controller.close();
                    return;
                }

                const job: NoteJob = {
                    job_id: `job_${Date.now()}`,
                    article_id,
                    request_id,
                    mode: 'development',
                    status: 'running',
                    attempt_count: 1,
                    created_at: new Date().toISOString(),
                    started_at: new Date().toISOString(),
                    finished_at: null,
                    posted_at: null,
                    note_url: null,
                    error_code: null,
                    error_message: null,
                    error_screenshot: null,
                    last_step: 'S00: Precheck (安全性確認)',
                    scheduled_at: scheduled_at || null,
                    tags: tags || []
                };

                sendUpdate({ status: 'running', last_step: job.last_step });

                await runNoteDraftAction(job, {
                    title, body, tags, scheduled_at, email, password, visualDebug, mode
                }, (step) => {
                    sendUpdate({ status: 'running', last_step: step });
                });

                sendUpdate({ status: 'success', note_url: job.note_url, last_step: 'S99 (完了)' });
                clearInterval(heartbeat);
                controller.close();
            } catch (e: any) {
                console.error("[Stream Error]:", e);
                sendUpdate({ error: e.message, status: 'failed', last_step: 'FATAL_ERROR' });
                clearInterval(heartbeat);
                controller.close();
            }
        }
    });

    return new Response(stream, {
        headers: {
            'Content-Type': 'application/x-ndjson',
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
    // Check global kill switch
    const settings = getDevSettings();
    if (!settings.AUTO_POST_ENABLED) {
        throw new Error("AUTO_POST_ENABLED is globally FALSE (Emergency Stop)");
    }

    let browser: any;
    let page: any;

    try {
        const VERSION = "2026-01-03-1935-FIX-SPA";
        update('S01', `Load Session / Browser Init [v:${VERSION}]`);
        const BROWSERLESS_TOKEN = process.env.BROWSERLESS_API_KEY || process.env.BROWSERLESS_TOKEN;
        const settings = getDevSettings();

        if (isServerless) {
            browser = await playwright.connectOverCDP(`wss://chrome.browserless.io?token=${BROWSERLESS_TOKEN}&--shm-size=2gb&stealth`, { timeout: 15000 });
        } else {
            // Development Mode 3: Use headless: false if visualDebug is requested
            const isHeadless = content.visualDebug ? false : !settings.VISUAL_DEBUG;
            browser = await playwright.launch({ headless: isHeadless });
        }

        const deviceProfiles = [
            { name: 'iPhone', ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1', w: 390, h: 844 },
            { name: 'Mac', ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36', w: 1280, h: 1000 }
        ];
        const profile = deviceProfiles[Math.floor(Math.random() * deviceProfiles.length)];

        const context = await browser.newContext({
            userAgent: profile.ua,
            viewport: { width: profile.w, height: profile.h },
            deviceScaleFactor: profile.name === 'Mac' ? 1 : 2,
            isMobile: profile.name !== 'Mac',
            hasTouch: profile.name !== 'Mac',
            locale: 'ja-JP',
            timezoneId: 'Asia/Tokyo'
        });

        // Super Stealth Injection
        await context.addInitScript(() => {
            Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
            Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
            if (navigator.serviceWorker) {
                navigator.serviceWorker.getRegistrations().then(regs => {
                    for (let reg of regs) reg.unregister();
                });
            }
        });

        if (fs.existsSync(SESSION_FILE)) {
            const savedData = JSON.parse(fs.readFileSync(SESSION_FILE, 'utf-8'));
            // Support both old cookie-only and new full-storage formats
            if (savedData.cookies) {
                await context.addCookies(savedData.cookies);
                if (savedData.origins) {
                    // Inject local storage if present
                    await context.addInitScript((data: any) => {
                        data.origins.forEach((origin: any) => {
                            origin.localStorage.forEach((item: any) => {
                                window.localStorage.setItem(item.name, item.value);
                            });
                        });
                    }, savedData);
                }
            } else {
                await context.addCookies(savedData);
            }
        }

        page = await context.newPage();

        // --- Technical Audit: Capture Failures ---
        page.on('requestfailed', (request: any) => {
            const url = request.url();
            if (url.includes('note.com') && (url.endsWith('.js') || url.includes('api'))) {
                console.log(`[Network Failure] ${url} - ${request.failure()?.errorText}`);
            }
        });
        page.on('console', (msg: any) => {
            if (msg.type() === 'error') {
                const txt = msg.text();
                console.log(`[JS Error] ${txt}`);
                if (!txt.includes('Failed to load resource')) {
                    onUpdate(`[Browser Error] ${txt.substring(0, 80)}`);
                }
            }
        });

        await page.setDefaultTimeout(20000);
        update('S02', 'Navigating to note.com');
        // Human Observational Wait: Sit still after initial navigation
        await page.goto('https://note.com/', { waitUntil: 'load', timeout: 30000 }).catch(() => { });
        await page.waitForTimeout(8000); // 8s wait to look like a human reading the home page

        // Check if already on editor or need to navigate
        const isLoginPage = page.url().includes('/login');
        const isGuest = await page.evaluate(() => !!document.querySelector('a[href*="/login"], .nc-header__login-button'));

        if (page.url().includes('/notes/new')) {
            update('S02', 'Confirmed: Editor direct access');
            await page.waitForTimeout(5000);
        } else if (isLoginPage || isGuest) {
            update('S03', isGuest ? 'Guest detected. Forcing login...' : 'Authentication required');
            if (isGuest && !isLoginPage) {
                await page.goto('https://note.com/login', { waitUntil: 'load' });
            }
            if (content.email && content.password) {
                update('S03', 'Entering credentials...');
                // Wait for modern or legacy selectors
                await page.waitForSelector('input#email, input[type="email"], #email', { timeout: 10000 });
                await page.fill('input#email, input[type="email"], #email', content.email);
                await page.fill('input#password, input[type="password"]', content.password);

                await page.waitForTimeout(1000); // Wait for validation to settle

                const loginBtn = page.locator('button.a-button[data-type="primaryNext"], button:has-text("ログイン"), button[type="submit"]').first();

                update('S03', 'Executing login click (bypassing overlays)...');

                // Remove potential blockers before clicking
                await page.evaluate(() => {
                    // Remove ultra-high z-index overlays or sticky headers that block clicks
                    const blockers = Array.from(document.querySelectorAll('*')).filter(el => {
                        const style = window.getComputedStyle(el);
                        return (parseInt(style.zIndex) > 1000000) || el.classList.contains('o-navBar');
                    });
                    blockers.forEach(el => (el as HTMLElement).style.display = 'none');
                }).catch(() => { });

                // Try normal click first with force, then fallback to JS eval click
                try {
                    await loginBtn.click({ force: true, timeout: 5000 });
                } catch (e) {
                    update('S03', 'Normal click blocked. Using Ghost Execute.');
                    await page.evaluate(() => {
                        const btn = (Array.from(document.querySelectorAll('button')).find(b => b.textContent?.includes('ログイン') || b.getAttribute('data-type') === 'primaryNext')) as HTMLElement;
                        if (btn) btn.click();
                    });
                }

                try {
                    await page.waitForURL((u: URL) => !u.href.includes('/login'), { timeout: 15000, waitUntil: 'load' });
                    update('S03', 'Login success. Stabilizing session...');
                    await page.waitForTimeout(8000);
                } catch (e) {
                    const errorText = await page.textContent('.nc-login__error, [role="alert"], .a-errorText').catch(() => null);
                    if (errorText) throw new Error(`ログイン失敗: ${errorText.trim()}`);
                    throw new Error("ログイン後の画面が開きませんでした。認証情報を確認してください。");
                }

                const state = await context.storageState();
                if (!fs.existsSync(path.dirname(SESSION_FILE))) fs.mkdirSync(path.dirname(SESSION_FILE), { recursive: true });
                fs.writeFileSync(SESSION_FILE, JSON.stringify(state));

                // Visit main site to stabilize
                update('S03', 'Loading My Page for stability');
                await page.goto('https://note.com/', { waitUntil: 'load' }).catch(() => { });
                await page.waitForTimeout(5000);
            } else {
                throw new Error("ログインが必要ですが、資格情報がありません。");
            }
        }

        // Human Action: Attempt to click "Post" button if not in editor
        if (!page.url().includes('editor.note.com')) {
            update('S04', 'Locating Post button');
            // Wait for header elements to really appear
            await page.waitForSelector('.nc-header', { timeout: 8000 }).catch(() => { });

            // Re-check for guest state (maybe login failed or redirected)
            const stillGuest = await page.evaluate(() => !!document.querySelector('a[href*="/login"], .nc-header__login-button'));
            if (stillGuest) throw new Error("ログイン状態の確認に失敗しました。ゲストとして認識されています。");

            const postBtn = page.locator('button:has-text("投稿"), a[href*="/notes/new"], .nc-header__post-button, .nc-header__post-nav-item').first();

            if (await postBtn.isVisible()) {
                await postBtn.click();
                update('S04', 'Post menu clicked. Waiting for Text option...');
                // Wait for the menu with high resilience
                const textBtn = page.locator('button:has-text("テキスト"), [data-test-id="post-text"], a:has-text("テキスト")').first();
                try {
                    await textBtn.waitFor({ state: 'visible', timeout: 8000 });
                    await textBtn.click();
                } catch (e) {
                    update('S04', 'Post menu hidden. Forcing navigation.');
                    await page.goto('https://note.com/notes/new', { waitUntil: 'domcontentloaded' }).catch(() => { });
                }
            } else {
                update('S04', 'Post button not found. Using direct navigation.');
                await page.goto('https://note.com/notes/new', { waitUntil: 'domcontentloaded' }).catch(() => { });
            }

            update('S04', 'Waiting for Editor redirect...');
            let redirectSuccess = false;
            for (let i = 0; i < 5; i++) {
                const currentUrl = page.url();
                if (currentUrl.includes('/notes/') && !currentUrl.endsWith('/new')) {
                    update('S04', `Redirect success: ${currentUrl.substring(currentUrl.length - 20)}`);
                    redirectSuccess = true;
                    break;
                }
                update('S04', `Waiting for ID redirect (${i + 1}/5)... (Tags: ${await page.evaluate(() => document.querySelectorAll('*').length)})`);
                await page.waitForTimeout(4000);
                if (currentUrl.endsWith('/new') && i === 2) {
                    update('S04', 'Still on /new. Forcing reload.');
                    await page.reload({ waitUntil: 'domcontentloaded' });
                }
            }

            if (!redirectSuccess) {
                const diag = await page.evaluate(() => ({
                    tags: document.querySelectorAll('*').length,
                    title: document.title,
                    url: window.location.href
                }));
                update('S04', `Redirect timeout. State: ${JSON.stringify(diag)}`);
            }
            await page.waitForTimeout(5000);
        }

        update('S04', 'Waiting for React/SPA hydration...');
        try {
            await page.waitForLoadState('networkidle', { timeout: 10000 });
        } catch (e) { }
        await page.waitForTimeout(10000);
        update('S05', `Editor confirmed (Tags: ${await page.evaluate(() => document.querySelectorAll('*').length)})`);

        // Tutorial Bypass (Aggressive)
        update('S05', 'Bypassing tutorials/overlays');
        try {
            await page.waitForTimeout(1000);
            const overlaySelectors = [
                'button:has-text("次へ")', 'button:has-text("閉じる")',
                'button:has-text("スキップ")', 'button:has-text("理解しました")',
                '.nc-tutorial-modal__close', 'div[aria-label="閉じる"]', '[aria-label="Close"]',
                'button:has-text("OK")'
            ];
            for (const sel of overlaySelectors) {
                const btns = await page.locator(sel).all();
                for (const btn of btns) {
                    if (await btn.isVisible()) {
                        await btn.click().catch(() => { });
                        await page.waitForTimeout(400);
                    }
                }
            }
            await page.mouse.click(1100, 100).catch(() => { });
        } catch (e) { }

        update('S05', 'Analyzing editor state');

        // Wait for Note's heavy SPA to settle
        try {
            await page.waitForLoadState('networkidle', { timeout: 10000 });
        } catch (e) {
            console.warn("[Action] Network didn't go idle, but checking DOM anyway.");
        }

        let editorFound = false;
        let lastDiag: any = null;
        for (let i = 0; i < 3; i++) {
            lastDiag = await page.evaluate(() => ({
                tags: document.querySelectorAll('*').length,
                title: document.title,
                url: window.location.href,
                html: document.documentElement.outerHTML.substring(0, 300).replace(/\s+/g, ' ')
            }));

            if (lastDiag.tags < 50 && i > 0) {
                update('S05', `Editor frozen? (Tags: ${lastDiag.tags}, Title: "${lastDiag.title || 'Empty'}", URL: ${lastDiag.url})`);

                if (i === 1) {
                    update('S05', 'Injecting click stimuli');
                    for (let pt of [{ x: 200, y: 400 }, { x: 400, y: 200 }, { x: 100, y: 100 }]) {
                        await (page.touchscreen ? page.touchscreen.tap(pt.x, pt.y) : page.mouse.click(pt.x, pt.y)).catch(() => { });
                    }
                }
                if (i === 2) {
                    update('S05', 'Force reloading page');
                    await page.reload({ waitUntil: 'networkidle' }).catch(() => { });
                }
                await page.waitForTimeout(6000);
            }

            const el = await page.waitForSelector('textarea, [role="textbox"], .ProseMirror, .note-editor', { timeout: 4000 }).catch(() => null);
            if (el && await el.isVisible()) {
                update('S05', 'Analyzing Editor responsiveness');
                await page.waitForTimeout(5000); // Observational wait: looking at the screen after load
                editorFound = true;
                break;
            }
            update('S05', `Waiting for Editor mount (${i + 1}/3)`);

            if (i === 1) await page.mouse.click(600, 400).catch(() => { });
        }

        if (!editorFound) {
            const finalUrl = page.url();
            let reason = "エディタの要素が見つかりませんでした。";
            if (finalUrl.includes('/login')) reason = "ログイン画面にリダイレクトされました（セッション切れの可能性）。";
            if (lastDiag?.tags < 50) reason = `ページが正常に読み込めていない可能性があります（タグ数: ${lastDiag?.tags}）。`;

            throw new Error(`[S05 Error] ${reason} 
                解析結果: [URL: ${finalUrl}] [Title: ${lastDiag?.title || 'none'}] [Tags: ${lastDiag?.tags || 0}]`);
        }

        if (content.mode === 'development_v4') {
            update('S06', 'Ghost Injection: Targeting Editor Core');
            const injectionSuccess = await page.evaluate(({ title, body }: { title: string, body: string }) => {
                const findEl = (selectors: string[]) => {
                    for (let s of selectors) {
                        const el = document.querySelector(s);
                        if (el && (el as HTMLElement).offsetParent !== null) return el;
                    }
                    return null;
                };

                const titleEl = findEl(['textarea[placeholder*="タイトル"]', '.note-editor-title textarea', 'h1[contenteditable="true"]']) as any;
                const bodyEl = findEl(['div.ProseMirror[role="textbox"]', '.ProseMirror', '.note-editor-body']) as any;

                if (!titleEl || !bodyEl) return false;

                titleEl.focus();
                document.execCommand('insertText', false, title);
                bodyEl.focus();
                document.execCommand('insertText', false, body);
                return true;
            }, { title: content.title, body: content.body });

            if (!injectionSuccess) throw new Error("Ghost Injection failed: Editor not found.");
            update('S08', 'Ghost Injection Success');
            await page.waitForTimeout(2000);
        } else {
            const bestSelectors = await page.evaluate(() => {
                const getSelector = (el: Element) => {
                    const tid = el.getAttribute("data-testid") || el.getAttribute("data-test-id");
                    if (tid) return `[data-testid="${tid}"]`;
                    return null;
                };
                const titleCandidates = ['textarea[placeholder*="タイトル"]', '.note-editor-title textarea', 'h1[contenteditable="true"]'];
                const bodyCandidates = ['div.ProseMirror[role="textbox"]', '.note-editor', '.ProseMirror'];

                let titleEl: any = null;
                for (const s of titleCandidates) {
                    const el = document.querySelector(s);
                    if (el && (el as HTMLElement).offsetParent !== null) { titleEl = el; break; }
                }

                let bodyEl: any = null;
                for (const s of bodyCandidates) {
                    const el = document.querySelector(s);
                    if (el && (el as HTMLElement).offsetParent !== null) { bodyEl = el; break; }
                }

                const saveBtn = Array.from(document.querySelectorAll('button')).find(b =>
                    b.textContent?.includes('下書き保存') || b.textContent?.includes('Save draft')
                );

                return {
                    title: titleEl ? (getSelector(titleEl) || (titleEl.tagName === 'H1' ? 'h1[contenteditable="true"]' : 'textarea')) : null,
                    body: bodyEl ? (getSelector(bodyEl) || 'div.ProseMirror[role="textbox"]') : null,
                    save: saveBtn ? 'button:has-text("下書き保存")' : null
                };
            });

            if (!bestSelectors.title || !bestSelectors.body) throw new Error("解析失敗: セレクタが見つかりません");

            update('S06', 'Editor Analysis Success');

            const forceInput = async (selector: string, text: string, isBody: boolean = false) => {
                const el = page.locator(selector).first();
                await el.scrollIntoViewIfNeeded();
                await el.click();
                await page.waitForTimeout(1000);
                const chunks = isBody ? text.match(/[\s\S]{1,150}/g) || [text] : text.match(/[\s\S]{1,20}/g) || [text];
                for (const chunk of chunks) {
                    await page.evaluate(({ sel, txt }: { sel: string, txt: string }) => {
                        const t = document.querySelector(sel) as any;
                        if (t) { t.focus(); document.execCommand('insertText', false, txt); }
                    }, { sel: selector, txt: chunk });
                    await page.waitForTimeout(400 + Math.random() * 600);
                }
            };

            update('S07', 'Typing Title...');
            await forceInput(bestSelectors.title, content.title);
            update('S08', 'Typing Body...');
            await forceInput(bestSelectors.body, content.body, true);
        }

        update('S09', 'Executing Draft Save');
        await page.click('button:has-text("下書き保存"), button:has-text("Save draft")').catch(async () => {
            await page.mouse.click(1100, 50).catch(() => { }); // Common save area
        });
        await page.waitForTimeout(5000);

        try {
            await page.waitForURL((u: URL) => (u.href.includes('/edit') || u.href.includes('/notes/n')) && !u.href.endsWith('/new'), { timeout: 20000 });
        } catch (e) { }

        job.status = 'success';
        job.finished_at = new Date().toISOString();
        job.note_url = page.url();
        update('S99', 'Job Complete');
        saveJob(job);
        await browser.close();
        return { status: 'success', job_id: job.job_id, note_url: job.note_url };

    } catch (e: any) {
        job.status = 'failed';
        job.error_message = e.message;
        job.finished_at = new Date().toISOString();
        saveJob(job);
        if (page) {
            const buf = await page.screenshot({ type: 'png' }).catch(() => null);
            if (buf) job.error_screenshot = `data:image/png;base64,${buf.toString('base64')}`;
            saveJob(job);
        }
        if (browser) await browser.close();
        throw e;
    }
}
