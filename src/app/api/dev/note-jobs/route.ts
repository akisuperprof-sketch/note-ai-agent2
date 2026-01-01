
import { NextRequest, NextResponse } from "next/server";
import { getAllJobs } from "@/lib/server/jobs";
import { validateDevMode } from "@/lib/server/flags";

export async function GET(req: NextRequest) {
    const mode = req.nextUrl.searchParams.get('mode') || 'production';

    if (!validateDevMode(mode)) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const jobs = getAllJobs();
    return NextResponse.json(jobs);
}
