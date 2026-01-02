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
                const { article_id, title, body, mode, request_id, email, password } = await req.json();

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
                    last_step: 'S00_認証中'
                };

                sendUpdate({ status: 'running', last_step: job.last_step });

                await runNoteDraftAction(job, { title, body, email, password }, (step) => {
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

async function runNoteDraftAction(job: NoteJob, content: { title: string, body: string, email?: string, password?: string }, onUpdate: (step: string) => void) {
    job.status = 'running';
    job.started_at = new Date().toISOString();
    const update = (step: string) => {
        job.last_step = step;
        saveJob(job);
        onUpdate(step);
    };

    update('S00_認証中');
    let browser: any;
    let page: any;

    try {
        const BROWSERLESS_TOKEN = process.env.BROWSERLESS_API_KEY || process.env.BROWSERLESS_TOKEN;
        if (isServerless) {
            // Enhanced connection with stealth and shm-size flags
            browser = await playwright.connectOverCDP(`wss://chrome.browserless.io?token=${BROWSERLESS_TOKEN}&--shm-size=2gb&stealth`, { timeout: 15000 });
        } else {
            browser = await playwright.launch({ headless: true });
        }

        const deviceProfiles = [
            { name: 'iPhone', ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1', w: 390, h: 844 },
            { name: 'iPad', ua: 'Mozilla/5.0 (iPad; CPU OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1', w: 834, h: 1194 },
            { name: 'Mac', ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36', w: 1280, h: 1000 }
        ];
        const profile = deviceProfiles[Math.floor(Math.random() * 2)]; // Start with Mobile/Tablet

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
            // Mask WebDriver
            Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
            // Mask Plugins
            Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
            // Mask Chrome
            (window as any).chrome = { runtime: {} };
            // Mask Languages
            Object.defineProperty(navigator, 'languages', { get: () => ['ja-JP', 'ja', 'en-US', 'en'] });
            // Mask Permissions
            const originalQuery = window.navigator.permissions.query;
            (window.navigator.permissions as any).query = (parameters: any) => (
                parameters.name === 'notifications' ?
                    Promise.resolve({ state: Notification.permission }) :
                    originalQuery(parameters)
            );
        });

        if (fs.existsSync(SESSION_FILE)) {
            const savedData = JSON.parse(fs.readFileSync(SESSION_FILE, 'utf-8'));
            // Support both old cookie-only and new full-storage formats
            if (savedData.cookies) {
                await context.addCookies(savedData.cookies);
                if (savedData.origins) {
                    // Inject local storage if present
                    await context.addInitScript((data) => {
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
        page.on('requestfailed', request => {
            const url = request.url();
            if (url.includes('note.com') && (url.endsWith('.js') || url.includes('api'))) {
                console.log(`[Network Failure] ${url} - ${request.failure()?.errorText}`);
            }
        });
        page.on('console', msg => {
            if (msg.type() === 'error') console.log(`[JS Error] ${msg.text()}`);
        });

        await page.setDefaultTimeout(20000);
        update('🚀 モバイルモードでサイトへ向かっています...');
        // Human Observational Wait: Sit still after initial navigation
        await page.goto('https://note.com/', { waitUntil: 'load', timeout: 30000 }).catch(() => { });
        await page.waitForTimeout(8000); // 8s wait to look like a human reading the home page

        // Check if already on editor or need to navigate
        if (page.url().includes('/notes/new')) {
            update('✅ エディタに直通しました。同期を待っています... (5秒待機)');
            await page.waitForTimeout(5000);
        } else if (page.url().includes('/login')) {
            update('🔑 ログインが必要なため、準備しています...');
            if (content.email && content.password) {
                await page.waitForSelector('input[type="email"], input[name="mail"], #email', { timeout: 10000 });
                await page.fill('input[type="email"], input[name="mail"], #email', content.email);
                await page.fill('input[type="password"], input[name="password"]', content.password);

                const loginBtn = page.locator('button:has-text("ログイン"), button[type="submit"], .nc-login__submit-button').first();
                await loginBtn.click();

                try {
                    await page.waitForURL((u: URL) => !u.href.includes('/login'), { timeout: 15000, waitUntil: 'load' });
                    update('🔓 ログイン完了。環境の安定を待っています... (8秒待機)');
                    await page.waitForTimeout(8000);
                } catch (e) {
                    const errorText = await page.textContent('.nc-login__error, [role="alert"]').catch(() => null);
                    if (errorText) throw new Error(`ログイン失敗: ${errorText.trim()}`);
                    throw new Error("ログイン後の画面が開きませんでした。");
                }

                const state = await context.storageState();
                if (!fs.existsSync(path.dirname(SESSION_FILE))) fs.mkdirSync(path.dirname(SESSION_FILE), { recursive: true });
                fs.writeFileSync(SESSION_FILE, JSON.stringify(state));

                // Visit main site to stabilize
                update('☕ マイページを読み込んでいます...');
                await page.goto('https://note.com/', { waitUntil: 'load' }).catch(() => { });
                await page.waitForTimeout(5000);
            } else {
                throw new Error("ログインが必要ですが、資格情報がありません。");
            }
        }

        // Human Action: Attempt to click "Post" button if not in editor
        if (!page.url().includes('editor.note.com')) {
            update('🖱️ 「投稿」ボタンを探してクリックします...');
            // Wait for header elements to really appear
            await page.waitForSelector('.nc-header', { timeout: 5000 }).catch(() => { });
            const postBtn = page.locator('button:has-text("投稿"), a[href*="/notes/new"], .nc-header__post-button, .nc-header__post-nav-item').first();

            if (await postBtn.isVisible()) {
                await postBtn.click();
                await page.waitForTimeout(3000);
                // Handle sub-menu for "Text" if visible
                const textBtn = page.locator('button:has-text("テキスト"), [data-test-id="post-text"], a:has-text("テキスト")').first();
                if (await textBtn.isVisible()) {
                    await textBtn.click();
                } else {
                    await page.goto('https://editor.note.com/notes/new', { waitUntil: 'load', referer: 'https://note.com/' }).catch(() => { });
                }
            } else {
                update('⚡ 直接エディタへ移動します');
                await page.goto('https://editor.note.com/notes/new', { waitUntil: 'load', referer: 'https://note.com/' }).catch(() => { });
            }
            // CRITICAL: Wait for editor application to boot up
            update('⌛ エディタが起動するのを静かに待っています... (10秒待機)');
            await page.waitForTimeout(10000);
        }
        update('✅ 編集画面への到達を確認しました');

        // Tutorial Bypass (Aggressive)
        update('🧹 邪魔な案内を片付けています...');
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

        update('🔍 記事を書き込む準備を整えています...');

        // Wait for Note's heavy SPA to settle
        try {
            await page.waitForLoadState('networkidle', { timeout: 10000 });
        } catch (e) {
            console.warn("[Action] Network didn't go idle, but checking DOM anyway.");
        }

        let editorFound = false;
        for (let i = 0; i < 6; i++) {
            const diag = await page.evaluate(() => ({
                tags: document.querySelectorAll('*').length,
                title: document.title,
                html: document.documentElement.outerHTML.substring(0, 300).replace(/\s+/g, ' ')
            }));

            if (diag.tags < 50 && i > 0) {
                update(`⏳ 画面が固まっています (${diag.tags})。あらゆる手段を講じます...`);

                // Deep Audit: What is actually in the HTML?
                const pageContent = await page.evaluate(() => document.documentElement.outerHTML.substring(0, 500));
                console.log(`[Diagnostic HTML] ${pageContent}`);

                if (i === 1) {
                    update('🖱️ 画面全体をタップして起動を促します');
                    for (let x = 0; x < 3; x++) await page.mouse.tap(100 + x * 100, 300 + x * 100).catch(() => { });
                }
                if (i === 2) {
                    update('🔄 認証を一度破棄して、クリーンな再開を試みます');
                    if (fs.existsSync(SESSION_FILE)) fs.unlinkSync(SESSION_FILE);
                    await page.reload({ waitUntil: 'load' }).catch(() => { });
                }
                if (i === 4) {
                    update('⚡ 最終突破：デスクトップモードに切り替えて再接近します');
                    // In a more complex setup we would change the context, but for now we try a direct force redirect
                    await page.goto('https://editor.note.com/notes/new?force_pc=1', { waitUntil: 'load', referer: 'https://note.com/' }).catch(() => { });
                }
                await page.waitForTimeout(6000);
            }

            const el = await page.waitForSelector('textarea, [role="textbox"], .ProseMirror, .note-editor', { timeout: 4000 }).catch(() => null);
            if (el && await el.isVisible()) {
                update('👁️ 編集画面の内容を確認しています... (5秒待機)');
                await page.waitForTimeout(5000); // Observational wait: looking at the screen after load
                editorFound = true;
                break;
            }
            update(`👀 編集画面が開くのを待っています... (${i + 1}/6回目)`);

            if (i === 1) await page.mouse.click(600, 400).catch(() => { });
            if (i === 3) await page.keyboard.press('Escape');
        }

        const bestSelectors = await page.evaluate(() => {
            const getSelector = (el: Element) => {
                const tid = el.getAttribute("data-testid") || el.getAttribute("data-test-id");
                if (tid) return `[data-testid="${tid}"]`;
                return null;
            };

            const titleCandidates = [
                'textarea[placeholder="記事タイトル"]', 'textarea[placeholder*="タイトル"]',
                'h1[contenteditable="true"]', '[data-testid="note-title"]', 'textarea'
            ];
            const bodyCandidates = [
                'div.ProseMirror[role="textbox"]', '.note-editor',
                '[data-editor-type="article"]', '[aria-label*="本文"]', '[role="textbox"]'
            ];

            let titleEl = null;
            for (const sel of titleCandidates) {
                const el = document.querySelector(sel);
                if (el && (el as HTMLElement).offsetParent !== null) { titleEl = el; break; }
            }

            let bodyEl = null;
            for (const sel of bodyCandidates) {
                const el = document.querySelector(sel);
                if (el && (el as HTMLElement).offsetParent !== null) { bodyEl = el; break; }
            }

            const saveBtn = Array.from(document.querySelectorAll('button')).find(b =>
                b.textContent?.includes('下書き保存') || b.textContent?.includes('Save draft') || b.textContent?.includes('完了')
            );

            return {
                title: titleEl ? (getSelector(titleEl) || (titleEl.tagName === 'H1' ? 'h1[contenteditable="true"]' : 'textarea')) : null,
                body: bodyEl ? (getSelector(bodyEl) || (bodyEl.classList.contains('ProseMirror') ? 'div.ProseMirror[role="textbox"]' : '.note-editor')) : null,
                save: saveBtn ? 'button:has-text("下書き保存")' : null
            };
        });

        console.log(`[Diagnostic] Final Selectors:`, bestSelectors);

        if (!bestSelectors.title || !bestSelectors.body) {
            if (fs.existsSync(SESSION_FILE)) fs.unlinkSync(SESSION_FILE);
            const diag = await page.evaluate(() => ({
                len: document.body.innerText.length,
                tags: document.querySelectorAll('*').length,
                title: document.title
            }));
            throw new Error(`解析失敗(S03)。状況: ${JSON.stringify(diag)} URL: ${page.url().substring(0, 40)}`);
        }

        update('S03 (完了)');

        const forceInput = async (selector: string, text: string, isBody: boolean = false) => {
            const el = page.locator(selector).first();
            await el.scrollIntoViewIfNeeded();
            await el.click();
            await page.waitForTimeout(1000);

            // Split into human-like "bursts" (e.g., paragraphs or character blocks)
            // For Vercel, we can't do char-by-char for long text, but we can do small chunks.
            const chunks = isBody ? text.match(/[\s\S]{1,150}/g) || [text] : text.match(/[\s\S]{1,20}/g) || [text];

            update(`✍️ ${isBody ? '本文' : 'タイトル'}を丁寧に記入中...`);

            for (const chunk of chunks) {
                await page.evaluate(({ sel, txt }: { sel: string, txt: string }) => {
                    const target = document.querySelector(sel) as any;
                    if (!target) return;
                    target.focus();

                    // Use insertText to trigger React/ProseMirror state updates naturally
                    const success = document.execCommand('insertText', false, txt);

                    // Fallback to manual event dispatching if insertText fails
                    if (!success) {
                        if (target.tagName === 'TEXTAREA' || target.tagName === 'INPUT') {
                            target.value += txt;
                            target.dispatchEvent(new Event('input', { bubbles: true }));
                        } else {
                            target.innerText += txt;
                            target.dispatchEvent(new Event('input', { bubbles: true }));
                        }
                    }
                }, { sel: selector, txt: chunk });

                // Randomized human-like pause between "bursts"
                await page.waitForTimeout(400 + Math.random() * 600);

                // Extra pause at paragraph ends (Human checking the progress)
                if (chunk.includes('\n')) {
                    update('👀 打ち間違いがないか確認しています...');
                    await page.waitForTimeout(1200 + Math.random() * 800);
                }
            }
        };

        update('✍️ タイトルを入力しています...');
        await page.waitForTimeout(2000); // Pre-typing pause
        await forceInput(bestSelectors.title, content.title);
        await page.waitForTimeout(3000); // After-typing reflection

        update('📄 本文を作成しています...');
        await page.waitForTimeout(2000); // Switching context pause
        await forceInput(bestSelectors.body, content.body, true);
        await page.waitForTimeout(4000); // Final proofread pause

        update('💾 内容を最終確認して保存ボタンを押します...');
        await page.waitForTimeout(3000); // Final pause before button click
        if (bestSelectors.save) {
            console.log(`[Action] Clicking Save Draft button.`);
            await page.click(bestSelectors.save);
            await page.waitForTimeout(5000); // Long wait for server sync
        } else {
            // Fallback for save button if selector was missed
            await page.click('button:has-text("下書き保存")').catch(() => { });
            await page.waitForTimeout(5000);
        }
        update('✨ 保存が完了しました');

        update('🏁 最終確認を行っています...');
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

        await page.waitForTimeout(2000);

        job.status = 'success';
        job.finished_at = new Date().toISOString();
        const finalUrl = page.url();
        job.note_url = finalUrl;

        // If it still says "/new", it means the post likely didn't persist as a draft with a unique ID
        if (finalUrl.endsWith('/new')) {
            throw new Error(`下書き保存は完了しましたが、URLの特定に失敗しました。現在のURL: ${finalUrl}`);
        }

        update('🎉 すべての作業が正常に完了しました！');
        saveJob(job); // Final save after all updates

        await browser.close();
        return { status: 'success', job_id: job.job_id, note_url: job.note_url, last_step: job.last_step };

    } catch (e: any) {
        job.status = 'failed';
        job.error_code = 'STEP_FAILED';
        job.error_message = e.message;
        job.finished_at = new Date().toISOString();
        saveJob(job); // Save job with error details
        try {
            if (page) {
                if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
                await page.screenshot({ path: path.join(LOG_DIR, `${job.last_step || 'FATAL'}_fail.png`) });
            }
        } catch (screenshotError) {
            console.error("Failed to take screenshot on error:", screenshotError);
        }
        if (browser) await browser.close();
        throw e; // Re-throw to be caught by the POST handler
    }
}
