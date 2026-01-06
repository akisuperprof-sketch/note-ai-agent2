import { chromium } from 'playwright-core';
import fs from 'fs';
import path from 'path';

const SESSION_JSON_PATH = process.env.NOTE_SESSION_JSON || "";
if (!SESSION_JSON_PATH) { console.error("NOTE_SESSION_JSON not set"); process.exit(1); }

const DUMMY_IMAGE_PATH = path.join(process.cwd(), 'dummy_upload.png');
const base64Png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
if (!fs.existsSync(DUMMY_IMAGE_PATH)) fs.writeFileSync(DUMMY_IMAGE_PATH, Buffer.from(base64Png, 'base64'));

(async () => {
    console.log("Launching browser...");
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' });

    if (fs.existsSync(SESSION_JSON_PATH)) {
        try {
            const sessionData = JSON.parse(fs.readFileSync(SESSION_JSON_PATH, 'utf-8'));
            if (sessionData.cookies && Array.isArray(sessionData.cookies)) await context.addCookies(sessionData.cookies);
            else if (Array.isArray(sessionData)) await context.addCookies(sessionData);
        } catch (e) { console.error("Cookies Error:", e); }
    }

    const page = await context.newPage();

    page.on('request', request => {
        if (['POST', 'PUT'].includes(request.method())) {
            console.log("---------------------------------------------------");
            console.log(`DETECTED ${request.method()} REQUEST:`);
            console.log("URL:", request.url());
            // console.log("Headers:", JSON.stringify(request.headers()));
            console.log("---------------------------------------------------");
        }
    });

    console.log("Navigating to editor...");
    await page.goto('https://note.com/notes/new');
    await page.waitForTimeout(5000);

    console.log("Attempting upload...");
    const addImgBtn = await page.$('button[aria-label="画像を追加"]');

    if (addImgBtn) {
        console.log("Found '画像を追加'. Clicking...");
        await addImgBtn.click();
        await page.waitForTimeout(1000);

        // Check for popover buttons
        const popoverButtons = await page.$$('button');
        let uploadBtn = null;
        for (const btn of popoverButtons) {
            const text = await btn.innerText();
            if (text.includes('アップロード') || text.includes('Upload')) {
                uploadBtn = btn;
                console.log(`Found Popover Button: ${text}`);
                break;
            }
        }

        if (uploadBtn) {
            console.log("Clicking upload button...");
            const fileChooserPromise = page.waitForEvent('filechooser', { timeout: 10000 });
            await uploadBtn.click();
            const fileChooser = await fileChooserPromise;
            await fileChooser.setFiles(DUMMY_IMAGE_PATH);
            console.log("File set via Popover. Waiting for network...");
            await page.waitForTimeout(15000);
        } else {
            console.log("Could not find 'アップロード' button. Dumping buttons:");
            for (const btn of popoverButtons) {
                console.log("Popover Btn:", await btn.innerText(), await btn.getAttribute('aria-label'));
            }
        }
    } else {
        console.log("Button '画像を追加' not found.");
        const html = await page.content();
        fs.writeFileSync('debug_page.html', html);
        console.log("Saved debug_page.html");
    }

    await browser.close();
})();
