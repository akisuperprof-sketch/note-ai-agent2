import { NextRequest, NextResponse } from "next/server";
import { getDevSettings, validateDevMode, DEV_SETTINGS } from "@/lib/server/flags";
import fs from "fs";
import path from "path";

const SETTINGS_FILE = !!(process.env.VERCEL)
    ? path.join('/tmp', 'note_settings.json')
    : path.join(process.cwd(), '.gemini/data/note_settings.json');

function saveSettings(settings: any) {
    try {
        const dir = path.dirname(SETTINGS_FILE);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2));
    } catch (e) {
        console.error("Failed to save settings:", e);
    }
}


export async function GET(req: NextRequest) {
    const { searchParams } = new URL(req.url);
    const mode = searchParams.get('mode');

    if (!validateDevMode(mode || '')) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    return NextResponse.json(getDevSettings());
}

export async function POST(req: NextRequest) {
    const { mode, settings } = await req.json();

    if (!validateDevMode(mode)) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const current = getDevSettings();
    const updated = { ...current, ...settings };
    saveSettings(updated);

    return NextResponse.json(updated);
}
