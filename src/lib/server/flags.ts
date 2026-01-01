
// 開発モード用の安全柵・フラグ管理

export const DEV_SETTINGS = {
    // 自動投稿を許可するかどうか (緊急停止スイッチ)
    AUTO_POST_ENABLED: true, // 開発中はここをfalseにすると即停止

    // 予約投稿系のフラグ（将来用）
    SCHEDULE_ENABLED: false,
    ALLOW_PUBLISH: false, // 絶対にfalse

    // 安全制限
    MAX_JOBS_PER_DAY: 10,
    MIN_INTERVAL_SECONDS: 30, // 連投防止インターバル
};

// サーバーサイドでの開発モード判定
// NODE_ENV だけでなく、明示的なチェックを行う
export function validateDevMode(requestMode: string): boolean {
    if (requestMode !== 'development') return false;
    // ここに環境変数のチェックなどを追加可能
    return true;
}
