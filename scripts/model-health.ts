// Usage: npx tsx scripts/model-health.ts [model...]
// Sends one tiny request to each model so you can see which are up, rate limited, or overloaded right now.
import { GoogleGenAI } from "@google/genai";

async function main() {
  process.loadEnvFile(".env.local");
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
  const models = process.argv.slice(2).length ? process.argv.slice(2) : ["gemini-3.1-flash-lite", "gemini-3.5-flash-lite", "gemini-3.8-flash", "gemini-flash-lite-latest"];
  for (const model of models) {
    const t = Date.now();
    try {
      const r = await ai.models.generateContent({ model, contents: "Reply with the single word: ok", config: { temperature: 0 } });
      console.log("PASS", model.padEnd(28), `${Date.now() - t}ms`, JSON.stringify((r.text ?? "").slice(0, 20)));
    } catch (e) {
      console.log("FAIL", model.padEnd(28), `${Date.now() - t}ms`, (e instanceof Error ? e.message : String(e)).replace(/\s+/g, " ").slice(0, 150));
    }
  }
}
main();
