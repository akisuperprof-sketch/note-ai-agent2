import { NextRequest, NextResponse } from "next/server";
import { getAllJobs } from "@/lib/server/jobs";
import { validateDevMode } from "@/lib/server/flags";

export async function GET(req: NextRequest) {
    const { searchParams } = new URL(req.url);
    const mode = searchParams.get('mode') || 'production';

    console.log(`[API] Fetching jobs. Mode=${mode}`);

    if (!validateDevMode(mode)) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    try {
        const jobs = getAllJobs();
        console.log(`[API] note-jobs: Retrieved ${jobs.length} jobs.`);
        return NextResponse.json(jobs);
    } catch (e) {
        console.error("[API Error] note-jobs:", e);
        return NextResponse.json({ error: "Failed to fetch jobs" }, { status: 500 });
    }
}
