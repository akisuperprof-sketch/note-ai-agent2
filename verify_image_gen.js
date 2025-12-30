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

const MODEL_NAME = "gemini-3-pro-image-preview";
const PROMPT = "A cute cat sitting on a laptop, anime style, highly detailed";
const OUTPUT_FILE = "verification_result.png";

console.log(`🚀 Starting verification for model: ${MODEL_NAME}`);
console.log(`📝 Prompt: "${PROMPT}"`);

const postData = JSON.stringify({
    contents: [{ parts: [{ text: PROMPT }] }]
});

const options = {
    hostname: 'generativelanguage.googleapis.com',
    path: `/v1beta/models/${MODEL_NAME}:generateContent?key=${API_KEY}`,
    method: 'POST',
    headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
    }
};

const req = https.request(options, (res) => {
    let data = '';
    res.on('data', (chunk) => data += chunk);
    res.on('end', () => {
        try {
            const json = JSON.parse(data);

            if (res.statusCode !== 200) {
                console.error(`❌ HTTP Error: ${res.statusCode}`);
                console.error("Response:", data);
                return;
            }

            if (json.error) {
                console.error("❌ API Error:", json.error);
                return;
            }

            // Check for image data
            if (json.candidates && json.candidates[0]?.content?.parts?.[0]) {
                const part = json.candidates[0].content.parts[0];

                if (part.inline_data) {
                    // Base64 Image
                    console.log("📸 Image data received (Base64).");
                    const buffer = Buffer.from(part.inline_data.data, 'base64');
                    fs.writeFileSync(OUTPUT_FILE, buffer);
                    console.log(`✅ Image saved to: ${path.resolve(OUTPUT_FILE)}`);
                } else if (part.text && part.text.startsWith('http')) {
                    // Image URL
                    console.log(`🔗 Image URL received: ${part.text}`);
                    console.log("   (Skipping download for URL verification, but generation was successful)");
                } else {
                    console.error("⚠️ Unexpected response format. No inline_data or image URL found.");
                    console.log("Full Response:", JSON.stringify(json, null, 2));
                }
            } else {
                console.error("⚠️ No candidates returned.");
                console.log("Full Response:", JSON.stringify(json, null, 2));
            }

        } catch (e) {
            console.error("❌ Parse Error:", e);
            console.log("Raw Response:", data);
        }
    });
});

req.on('error', (e) => {
    console.error(`❌ Network Error: ${e.message}`);
});

req.write(postData);
req.end();
