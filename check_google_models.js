const fs = require('fs');
const path = require('path');
const https = require('https');

// 1. .env.local から APIキーを読み込む
function getApiKey() {
    try {
        const envPath = path.resolve(process.cwd(), '.env.local');
        if (!fs.existsSync(envPath)) return null;
        const content = fs.readFileSync(envPath, 'utf8');
        const match = content.match(/GEMINI_API_KEY=(.*)/);
        return match ? match[1].trim() : null;
    } catch (e) {
        return null;
    }
}

const API_KEY = getApiKey();

if (!API_KEY) {
    console.error("❌ Link Error: .env.local から GEMINI_API_KEY が見つかりませんでした。");
    process.exit(1);
}

console.log("✅ API Key found.");

// 2. モデル一覧を取得する
console.log("🔍 Checking available models from Google API...");

const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${API_KEY}`;

https.get(url, (res) => {
    let data = '';
    res.on('data', (chunk) => data += chunk);
    res.on('end', () => {
        try {
            const json = JSON.parse(data);
            if (json.error) {
                console.error("❌ API Error:", json.error);
                return;
            }

            console.log("\n📋 Available Models List:");
            const models = json.models || [];
            const imageModels = [];
            const gemini3Models = [];

            models.forEach(m => {
                // 画像生成っぽいモデルを抽出
                if (m.name.includes("image") || m.supportedGenerationMethods?.includes("generateImage")) {
                    imageModels.push(m.name);
                    console.log(`  📸 [IMAGE] ${m.name} (${m.version})`);
                }
                // Gemini 3系を抽出
                else if (m.name.includes("gemini-3")) {
                    gemini3Models.push(m.name);
                    console.log(`  ✨ [GEM 3] ${m.name}`);
                }
                else {
                    // その他
                    // console.log(`  - ${m.name}`);
                }
            });

            console.log("\n--- Analysis Report ---");
            const targetModel = "models/gemini-3-pro-image-preview";
            const hasTarget = models.find(m => m.name === targetModel);

            if (hasTarget) {
                console.log(`✅ Target model '${targetModel}' IS in the list.`);
            } else {
                console.log(`⚠️ Target model '${targetModel}' is NOT in the list.`);
                console.log("   (これが原因で 404/500 エラーになっている可能性が高いです)");

                if (imageModels.length > 0) {
                    console.log(`   推奨される代替モデル: ${imageModels.join(", ")}`);
                } else {
                    console.log("   画像生成可能なモデルが見つかりませんでした。Imagen 3 等の利用権限がない可能性があります。");
                }
            }

        } catch (e) {
            console.error("Parse Error:", e);
        }
    });
}).on("error", (err) => {
    console.error("Network Error:", err);
});
