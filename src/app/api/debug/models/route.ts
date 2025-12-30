import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
    try {
        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) {
            return NextResponse.json({ error: "No API Key found" }, { status: 500 });
        }

        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
        const data = await response.json();

        // Filter for image models or Gemini 3 models
        const models = data.models || [];
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const relevant = models.filter((m: any) =>
            m.name.includes("image") ||
            m.name.includes("gemini-3") ||
            m.supportedGenerationMethods?.includes("generateImage")
        );

        return NextResponse.json({
            count: models.length,
            relevantModels: relevant.map((m: any) => m.name),
            allModels: models.map((m: any) => m.name)
        });

    } catch (e) {
        return NextResponse.json({ error: String(e) }, { status: 500 });
    }
}
