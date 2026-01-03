
// 開発モード用の安全柵・フラグ管理

import fs from "fs";
import path from "path";

const SETTINGS_FILE = !!(process.env.VERCEL)
    ? path.join('/tmp', 'note_settings.json')
    : path.join(process.cwd(), '.gemini/data/note_settings.json');

export const DEV_SETTINGS = {
    AUTO_POST_ENABLED: true,
    SCHEDULE_ENABLED: false,
    ALLOW_PUBLISH: false,
    MAX_JOBS_PER_DAY: 10,
    MIN_INTERVAL_SECONDS: 30,
    VISUAL_DEBUG: false, // 開発モード3用: 有頭ブラウザでの起動
};

export function getDevSettings() {
    try {
        if (fs.existsSync(SETTINGS_FILE)) {
            const data = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf-8'));
            return { ...DEV_SETTINGS, ...data };
        }
    } catch (e) { }
    return DEV_SETTINGS;
}


// サーバーサイドでの開発モード判定
// NODE_ENV だけでなく、明示的なチェックを行う
export function validateDevMode(requestMode: string): boolean {
    if (requestMode !== 'development') return false;
    // ここに環境変数のチェックなどを追加可能
    return true;
}
