// Usage: npx tsx scripts/list-models.ts
// Lists Gemini models available to the key in .env.local (key is never printed).
import { GoogleGenAI } from "@google/genai";

async function main() {
  process.loadEnvFile(".env.local");
  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    console.error("GEMINI_API_KEY is empty in .env.local");
    process.exit(1);
  }
  const ai = new GoogleGenAI({ apiKey: key });
  const rows: string[] = [];
  for await (const m of await ai.models.list({ config: { pageSize: 100 } })) {
    const actions = m.supportedActions ?? [];
    if (!/gemini|gemma/i.test(m.name ?? "") || !actions.includes("generateContent")) continue;
    rows.push(`${(m.name ?? "").replace("models/", "").padEnd(42)} ${m.displayName ?? ""}`);
  }
  console.log(rows.sort().join("\n"));
  console.log(`\n${rows.length} generateContent models`);
}
main().catch((e) => {
  console.error("list failed:", e instanceof Error ? e.message.slice(0, 300) : e);
  process.exit(1);
});
