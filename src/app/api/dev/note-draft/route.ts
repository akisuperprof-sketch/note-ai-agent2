
import { NextRequest, NextResponse } from "next/server";
import { chromium } from "playwright";
import fs from "fs";
import path from "path";
import { DEV_SETTINGS, validateDevMode } from "@/lib/server/flags";
import { getAllJobs, saveJob, NoteJob } from "@/lib/server/jobs";

// 認証情報のパス
const SESSION_FILE = path.join(process.cwd(), '.secret/note_session.json');
const LOG_DIR = path.join(process.cwd(), '.gemini/data/logs');

export async function POST(req: NextRequest) {
    const {
        article_id,
        title,
        body,
        tags,
        mode,
        request_id,
        scheduled_at
    } = await req.json();

    // --- 安全柵 1: モードチェック ---
    if (!validateDevMode(mode)) {
        return NextResponse.json({ error: "Forbidden: Production mode cannot access Note API" }, { status: 403 });
    }

    // --- 安全柵 2: 緊急停止フラグ ---
    if (!DEV_SETTINGS.AUTO_POST_ENABLED) {
        return NextResponse.json({ error: "Auto-post is disabled by flags" }, { status: 503 });
    }

    // --- 安全柵 3: 冪等性チェック (Article ID & Request ID) ---
    const allJobs = getAllJobs();
    if (allJobs.find(j => j.article_id === article_id && j.status === 'success')) {
        return NextResponse.json({ status: 'skipped', message: 'Article already posted' });
    }
    if (allJobs.find(j => j.request_id === request_id)) {
        return NextResponse.json({ status: 'skipped', message: 'Request ID already used' });
    }

    // ジョブ作成
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

    // 非同期で実行（Next.js Edge Runtimeなどでは工夫が必要だが、ここでは標準的なAPI環境を想定）
    // 実際には 202 Accepted を返してバックグラウンドで処理するのが望ましいが、Next.js API Routesの制約内で同期的に実行する

    const result = await runNoteDraftAction(job, { title, body, tags });

    return NextResponse.json(result);
}

async function runNoteDraftAction(job: NoteJob, content: { title: string, body: string, tags?: string[] }) {
    job.status = 'running';
    job.started_at = new Date().toISOString();
    saveJob(job);

    const browser = await chromium.launch({ headless: true });
    const context = fs.existsSync(SESSION_FILE)
        ? await browser.newContext({ storageState: SESSION_FILE })
        : await browser.newContext();

    const page = await context.newPage();

    // スクショ用ディレクトリ作成
    if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });

    const captureFailure = async (step: string, error: any) => {
        console.error(`Step ${step} failed:`, error);
        const ts = Date.now();
        await page.screenshot({ path: path.join(LOG_DIR, `${step}_${ts}_fail.png`) });
        const html = await page.content();
        fs.writeFileSync(path.join(LOG_DIR, `${step}_${ts}_fail.html`), html);

        job.status = 'failed';
        job.last_step = step;
        job.error_code = 'STEP_FAILED';
        job.error_message = error.message;
        job.finished_at = new Date().toISOString();
        saveJob(job);
    };

    try {
        // S01: Load Session & Access Editor
        job.last_step = 'S01_load_session';
        saveJob(job);
        await page.goto('https://note.com/notes/new', { waitUntil: 'networkidle' });

        // S03: Verify Login
        job.last_step = 'S03_verify_login';
        saveJob(job);
        if (page.url().includes('login')) {
            throw new Error('Note session expired or login required. Please update note_session.json');
        }

        // S04: Fill Title
        job.last_step = 'S04_fill_title';
        saveJob(job);
        await page.waitForSelector('.note-editor-v3__title-textarea', { timeout: 10000 });
        await page.fill('.note-editor-v3__title-textarea', content.title);

        // S05: Fill Body
        job.last_step = 'S05_fill_body';
        saveJob(job);
        // noteのeditorは ProseMirror 等の複雑な構造の場合があるが、ここでは標準的な textarea/contenteditable を想定した簡易版
        // 実際には [role="textbox"] や [contenteditable="true"] を狙う
        const bodySelector = '.note-editor-v3__body-content [role="textbox"]';
        await page.waitForSelector(bodySelector);
        await page.click(bodySelector);
        await page.keyboard.type(content.body);

        // S07: Click Draft Save
        job.last_step = 'S07_click_draft_save';
        saveJob(job);
        // 「保存」または「下書き保存」ボタンを探す
        const saveButton = page.getByRole('button', { name: /下書き保存|保存/ });
        await saveButton.click();

        // S08: Confirm Saved
        job.last_step = 'S08_confirm_saved';
        saveJob(job);
        // トースト通知やURLの変化を待つ
        await page.waitForTimeout(3000); // 簡易待機

        // S09: Capture Result
        job.last_step = 'S09_capture_result';
        job.note_url = page.url();
        job.status = 'success';
        job.posted_at = new Date().toISOString();
        job.finished_at = new Date().toISOString();
        saveJob(job);

        await browser.close();
        return job;

    } catch (error) {
        await captureFailure(job.last_step || 'unknown', error);
        await browser.close();
        return job;
    }
}
