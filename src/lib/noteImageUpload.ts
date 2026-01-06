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
        await page.goto('https://note.com/notes/new');
        await page.waitForTimeout(3000);

        // Upload Logic
        const addImgBtn = await page.$('button[aria-label="画像を追加"]');
        if (addImgBtn) {
            log("Rabbit: Found 'Add Image' button");
            await addImgBtn.click();
            const uploadBtn = await page.waitForSelector('button:has-text("アップロード"), button:has-text("Upload"), button:has-text("upload")', { timeout: 3000 }).catch(() => null);

            if (uploadBtn) {
                log("Rabbit: Found 'Upload' button");
                const fileChooserPromise = page.waitForEvent('filechooser');
                await uploadBtn.click();
                const fileChooser = await fileChooserPromise;
                await fileChooser.setFiles(imagePath);
                log("Rabbit: File set to chooser");
            } else {
                log("Rabbit: 'Upload' button NOT found in popover");
                // Check if there is already an input type file we can use
                const fileInput = await page.$('input[type="file"]');
                if (fileInput) {
                    await fileInput.setInputFiles(imagePath);
                    log("Rabbit: Used direct file input from Popover?");
                }
            }
        } else {
            log("Rabbit: 'Add Image' button NOT found");
            // Fallback: direct file input
            const fileInput = await page.$('input[type="file"]');
            if (fileInput) {
                await fileInput.setInputFiles(imagePath);
                log("Rabbit: Used direct file input");
            } else {
                log("Rabbit: Direct file input NOT found");
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
