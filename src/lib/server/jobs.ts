
import fs from 'fs';
import path from 'path';

// 実行環境（Vercel等）の読み取り専用制限を回避するため、書き込み可能な /tmp フォルダを使用する
const isServerless = process.env.VERCEL === '1' || process.env.NODE_ENV === 'production';
const DATA_DIR = isServerless ? '/tmp' : path.join(process.cwd(), '.gemini/data');
const JOBS_FILE = path.join(DATA_DIR, 'note_jobs.json');

export type JobStatus = 'pending' | 'running' | 'success' | 'failed' | 'skipped';

export interface NoteJob {
    job_id: string;
    article_id: string;
    request_id: string;
    mode: 'production' | 'development';
    status: JobStatus;
    attempt_count: number;
    created_at: string;
    started_at: string | null;
    finished_at: string | null;
    posted_at: string | null;
    note_url: string | null;
    error_code: string | null;
    error_message: string | null;
    last_step: string | null;
}

export function getAllJobs(): NoteJob[] {
    if (!fs.existsSync(JOBS_FILE)) return [];
    try {
        const data = fs.readFileSync(JOBS_FILE, 'utf-8');
        return JSON.parse(data);
    } catch (e) {
        console.error('Failed to read jobs file', e);
        return [];
    }
}

export function saveJob(job: NoteJob) {
    const jobs = getAllJobs();
    const index = jobs.findIndex(j => j.job_id === job.job_id);
    if (index >= 0) {
        jobs[index] = job;
    } else {
        jobs.push(job);
    }

    if (!fs.existsSync(path.dirname(JOBS_FILE))) {
        fs.mkdirSync(path.dirname(JOBS_FILE), { recursive: true });
    }

    fs.writeFileSync(JOBS_FILE, JSON.stringify(jobs, null, 2));
}

export function findJobByRequestId(requestId: string): NoteJob | undefined {
    return getAllJobs().find(j => j.request_id === requestId);
}

export function findJobByArticleId(articleId: string): NoteJob | undefined {
    return getAllJobs().find(j => j.article_id === articleId);
}
