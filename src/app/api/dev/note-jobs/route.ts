import { NextRequest, NextResponse } from "next/server";
import { validateDevMode } from "@/lib/server/flags";
import fs from "fs";
import path from "path";

const isServerless = !!(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.BROWSERLESS_API_KEY || process.env.BROWSERLESS_TOKEN);

const JOBS_DIR = isServerless
    ? path.join('/tmp', 'note-draft-jobs')
    : path.join(process.cwd(), '.gemini', 'note-draft-jobs');

export async function GET(req: NextRequest) {
    const { searchParams } = new URL(req.url);
    const mode = searchParams.get('mode') || 'production';

    if (!validateDevMode(mode)) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    try {
        let allJobs: any[] = [];

        // Read from individual job files
        if (fs.existsSync(JOBS_DIR)) {
            const files = fs.readdirSync(JOBS_DIR).filter(f => f.endsWith('.json'));
            for (const file of files) {
                try {
                    const data = fs.readFileSync(path.join(JOBS_DIR, file), 'utf-8');
                    allJobs.push(JSON.parse(data));
                } catch (e) {
                    console.error(`Failed to parse job file: ${file}`, e);
                }
            }
        }

        // Sort by started_at desc
        allJobs.sort((a, b) => new Date(b.started_at || 0).getTime() - new Date(a.started_at || 0).getTime());

        // Limit to 50
        const limitedJobs = allJobs.slice(0, 50);

        return NextResponse.json(limitedJobs);
    } catch (e) {
        console.error("[API Error] note-jobs:", e);
        return NextResponse.json({ error: "Failed to fetch jobs" }, { status: 500 });
    }
}
