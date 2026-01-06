import { chromium, Browser, BrowserContext, Page } from 'playwright-core';
import fs from 'fs';
import path from 'path';

interface UploadResult {
    status: 'success' | 'error';
    key?: string;
    message?: string;
}

export async function uploadImageToNote(
    imagePath: string,
    sessionJsonPath: string,
    onProgress?: (msg: string) => void
): Promise<UploadResult> {
    const log = (msg: string) => {
        console.log(msg);
        if (onProgress) onProgress(msg);
    };

    if (!fs.existsSync(imagePath)) {
        return { status: 'error', message: `Image file not found: ${imagePath}` };
    }

    let browser: Browser | null = null;
    try {
        // Try to find executable path for Chrome/Chromium
        let executablePath: string | undefined = undefined;

        // Common Linux/Mac paths
        const possiblePaths = [
            '/usr/bin/google-chrome',
            '/usr/bin/chromium',
            '/usr/bin/chromium-browser',
            '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
            '/Program Files/Google/Chrome/Application/chrome.exe'
        ];

        // If on Vercel/Lambda, rely on system configuration or specific env vars if needed.
        // For now, check common paths.
        for (const p of possiblePaths) {
            if (fs.existsSync(p)) {
                executablePath = p;
                break;
            }
        }

        let launchArgs = ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'];

        // If not found locally and we are on Linux (likely Vercel/Sandbox), try @sparticuz/chromium
        if (!executablePath && process.platform === 'linux') {
            try {
                log("Rabbit: Detected Linux. Attempting to use @sparticuz/chromium...");
                const sparticuz = require('@sparticuz/chromium');
                executablePath = await sparticuz.executablePath();
                launchArgs = [...sparticuz.args, ...launchArgs];
                log(`Rabbit: @sparticuz/chromium path resolved: ${executablePath}`);
            } catch (e: any) {
                log(`Rabbit: Failed to load @sparticuz/chromium: ${e.message}`);
            }
        }

        log(`Rabbit: Launching Browser. Executable: ${executablePath || 'Bundled/Default'}`);

        browser = await chromium.launch({
            headless: true,
            executablePath: executablePath,
            args: [...new Set(launchArgs)]
        });

        const context: BrowserContext = await browser.newContext({
            userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        });

        // Load cookies
        if (fs.existsSync(sessionJsonPath)) {
            try {
                const sessionFile = fs.readFileSync(sessionJsonPath, 'utf-8');
                const sessionData = JSON.parse(sessionFile);
                if (sessionData.cookies && Array.isArray(sessionData.cookies)) {
                    await context.addCookies(sessionData.cookies);
                } else if (Array.isArray(sessionData)) {
                    await context.addCookies(sessionData);
                }
            } catch (e) {
                console.warn("Failed to parse session cookies", e);
            }
        }

        const page: Page = await context.newPage();
        let eyecatchKey: string | null = null;

        // 1. Intercept Auto-Save (preferred method)
        page.on('request', request => {
            if (request.method() === 'POST' && request.url().includes('/api/v1/text_notes')) {
                const postData = request.postData();
                if (postData) {
                    try {
                        const json = JSON.parse(postData);
                        if (json.note && json.note.eyecatch_image_key) {
                            eyecatchKey = json.note.eyecatch_image_key;
                        }
                    } catch (e) { }
                }
            }
        });

        // 2. Intercept Upload Response (backup method)
        page.on('response', async response => {
            if (response.request().method() === 'POST' && (response.url().includes('upload') || response.url().includes('file'))) {
                try {
                    const json = await response.json();
                    if (json.data && json.data.key) {
                        eyecatchKey = json.data.key;
                    }
                } catch (e) { }
            }
        });

        // Navigate
        log("Rabbit: Navigating to note.com/notes/new");
        const navigationResponse = await page.goto('https://note.com/notes/new', { timeout: 30000 });

        // Debug: Check if redirected to login
        if (page.url().includes('login') || page.url().includes('signin')) {
            log("Rabbit: Redirected to login page. Session might be invalid/expired.");
            const shotPath = path.join('/tmp', `debug_failed_login_${Date.now()}.png`);
            await page.screenshot({ path: shotPath });
            return { status: 'error', message: 'Session expired. Please update note-session.json.' };
        }

        await page.waitForLoadState('networkidle');
        await page.waitForTimeout(5000);

        // Upload Logic - Try multiple strategies
        let fileInput = await page.$('input[type="file"]');

        // Strategy A: Direct Input (Hidden or not)
        if (fileInput) {
            log("Rabbit: Found direct file input. Attempting upload...");
            try {
                await fileInput.setInputFiles(imagePath);
                log("Rabbit: Set files to direct input success.");
            } catch (e: any) {
                log(`Rabbit: Direct input failed: ${e.message}`);
            }
        } else {
            // Strategy B: Click "Add Image"
            log("Rabbit: Direct input not found. Looking for buttons...");

            const addImgSelectors = [
                'button[aria-label="画像を追加"]',
                'button[aria-label="ファイルをアップロード"]',
                'svg[aria-label="画像"]',
                'div[role="button"]:has-text("画像")',
                '.o-editorAddBlock__item[aria-label="画像"]'
            ];

            let addImgBtn = null;
            for (const sel of addImgSelectors) {
                addImgBtn = await page.$(sel);
                if (addImgBtn) {
                    log(`Rabbit: Found button with selector: ${sel}`);
                    await addImgBtn.click();
                    break;
                }
            }

            if (addImgBtn) {
                const uploadBtn = await page.waitForSelector('button:has-text("アップロード"), button:has-text("Upload"), li:has-text("アップロード")', { timeout: 5000 }).catch(() => null);

                if (uploadBtn) {
                    log("Rabbit: Found 'Upload' button in menu");
                    const fileChooserPromise = page.waitForEvent('filechooser');
                    await uploadBtn.click();
                    const fileChooser = await fileChooserPromise;
                    await fileChooser.setFiles(imagePath);
                    log("Rabbit: File set via filechooser");
                } else {
                    log("Rabbit: 'Upload' button not found after clicking add image.");
                }
            } else {
                log("Rabbit: NO 'Add Image' button found. Dumping page content for debug.");
                const bodyText = await page.evaluate(() => document.body.innerText.substring(0, 200).replace(/\n/g, ' '));
                log(`Rabbit: Page text snippet: ${bodyText}...`);
            }
        }

        // Wait for key
        log("Rabbit: Waiting for eyecatch key...");
        for (let i = 0; i < 20; i++) {
            if (eyecatchKey) {
                log(`Rabbit: Key found: ${eyecatchKey}`);
                break;
            }
            await page.waitForTimeout(1000);
        }

        if (eyecatchKey) {
            return { status: 'success', key: eyecatchKey };
        } else {
            // Debug: Screenshot
            const shotPath = path.join('/tmp', `debug_failed_upload_${Date.now()}.png`);
            await page.screenshot({ path: shotPath, fullPage: true });
            log(`Rabbit: Debug screenshot saved to ${shotPath}`);
            return { status: 'error', message: 'Failed to extract key after upload. Screenshot saved.' };
        }

    } catch (error: any) {
        // Debug: Screenshot on crash
        try {
            if (browser) {
                const page = (await browser.contexts()[0]?.pages())?.[0];
                if (page) {
                    const shotPath = path.join('/tmp', `debug_crash_${Date.now()}.png`);
                    await page.screenshot({ path: shotPath });
                    log(`Rabbit: Crash screenshot saved to ${shotPath}`);
                }
            }
        } catch (e) { }

        return { status: 'error', message: `Browser Error: ${error.message}` };
    } finally {
        if (browser) await browser.close();
    }
}
