import { chromium } from 'playwright-core';
import fs from 'fs';
import path from 'path';

// Arguments: [node, script, imagePath, sessionJsonPath]
const imagePath = process.argv[2];
const sessionJsonPath = process.argv[3];

if (!imagePath || !sessionJsonPath) {
    console.error("Usage: tsx upload_image_to_note.ts <image_path> <session_json_path>");
    process.exit(1);
}

if (!fs.existsSync(imagePath)) {
    console.error(`Image file not found: ${imagePath}`);
    process.exit(1);
}

(async () => {
    let browser;
    try {
        browser = await chromium.launch({ headless: true }); // Headless is fine
        const context = await browser.newContext({
            userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        });

        // Load cookies
        if (fs.existsSync(sessionJsonPath)) {
            const sessionData = JSON.parse(fs.readFileSync(sessionJsonPath, 'utf-8'));
            if (sessionData.cookies && Array.isArray(sessionData.cookies)) {
                await context.addCookies(sessionData.cookies);
            } else if (Array.isArray(sessionData)) {
                await context.addCookies(sessionData);
            }
        }

        const page = await context.newPage();

        // ---------------------------------------------------------
        // Intercept Auto-Save to get the key
        // ---------------------------------------------------------
        let eyecatchKey = null;
        page.on('request', request => {
            if (request.method() === 'POST' && request.url().includes('/api/v1/text_notes')) {
                const postData = request.postData();
                if (postData) {
                    try {
                        const json = JSON.parse(postData);
                        // The payload usually contains 'eyecatch_image_id' or similar if set.
                        // note.com API often sends: { note: { eyecatch_image_id: 123... } }
                        // OR if it's the *upload* response we need...
                        // Wait, auto-save sends the current state.
                        if (json.note && json.note.eyecatch_image_key) {
                            eyecatchKey = json.note.eyecatch_image_key;
                        }
                    } catch (e) { }
                }
            }
        });

        // Also listen for the upload RESPONSE, just in case
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

        // ---------------------------------------------------------
        // Navigation & Upload
        // ---------------------------------------------------------
        await page.goto('https://note.com/notes/new');

        // Wait for editor
        await page.waitForTimeout(3000);

        // Click "Image" -> "Upload" logic (robust)
        const addImgBtn = await page.$('button[aria-label="画像を追加"]');
        if (addImgBtn) {
            await addImgBtn.click();

            // Wait for popover and find upload button
            const uploadBtn = await page.waitForSelector('button:has-text("アップロード"), button:has-text("Upload")', { timeout: 3000 }).catch(() => null);

            if (uploadBtn) {
                const fileChooserPromise = page.waitForEvent('filechooser');
                await uploadBtn.click();
                const fileChooser = await fileChooserPromise;
                await fileChooser.setFiles(imagePath);

                // Wait for upload to process and auto-save
                // We poll for eyecatchKey
                for (let i = 0; i < 20; i++) {
                    if (eyecatchKey) break;
                    await page.waitForTimeout(1000);
                }
            }
        } else {
            // Maybe simplified editor or different state
            // Try file input directly
            const fileInput = await page.$('input[type="file"]');
            if (fileInput) {
                await fileInput.setInputFiles(imagePath);
                for (let i = 0; i < 20; i++) {
                    if (eyecatchKey) break;
                    await page.waitForTimeout(1000);
                }
            }
        }

        if (eyecatchKey) {
            console.log(JSON.stringify({ status: 'success', key: eyecatchKey }));
        } else {
            console.log(JSON.stringify({ status: 'error', message: 'Failed to extract key' }));
        }

    } catch (error: any) {
        console.log(JSON.stringify({ status: 'error', message: error.message }));
    } finally {
        if (browser) await browser.close();
    }
})();
