// Usage: npx tsx scripts/probe-models.ts
// One-call capability probes against the key in .env.local. Costs a few requests of free-tier quota.
import { GoogleGenAI } from "@google/genai";

type Out = { ok: boolean; note: string };
async function attempt(label: string, fn: () => Promise<string>) {
  const t = Date.now();
  let r: Out;
  try {
    r = { ok: true, note: await fn() };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    r = { ok: false, note: msg.replace(/\s+/g, " ").slice(0, 220) };
  }
  console.log(`${r.ok ? "PASS" : "FAIL"}  ${label}  (${Date.now() - t}ms)\n      ${r.note}`);
}

async function main() {
  process.loadEnvFile(".env.local");
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
  const ask = "Find the official developer docs page for creating a Slack OAuth app. List the URLs.";

  const models = process.argv.slice(2).length ? process.argv.slice(2) : ["gemini-3.1-flash-lite", "gemini-2.5-flash"];
  for (const model of models) {
    await attempt(`search grounding on ${model}`, async () => {
      const res = await ai.models.generateContent({ model, contents: ask, config: { tools: [{ googleSearch: {} }], temperature: 0 } });
      const chunks = res.candidates?.[0]?.groundingMetadata?.groundingChunks ?? [];
      return `${chunks.length} grounding chunks; first: ${chunks[0]?.web?.uri?.slice(0, 90) ?? "none"}; text urls: ${(res.text ?? "").match(/https:\/\/\S+/g)?.length ?? 0}`;
    });
  }

  if (process.argv.slice(2).length) return; // custom model list: grounding probes only
  await attempt("structured JSON output on gemini-3.1-flash-lite", async () => {
    const res = await ai.models.generateContent({
      model: "gemini-3.1-flash-lite",
      contents: 'Which of these are provider-owned pages? Return only URLs given.\n- https://docs.slack.dev/authentication\n- https://stackoverflow.com/q/1',
      config: {
        responseMimeType: "application/json",
        responseJsonSchema: { type: "object", properties: { official: { type: "array", items: { type: "string" } } }, required: ["official"] },
        temperature: 0,
      },
    });
    return `parsed: ${JSON.stringify(JSON.parse(res.text ?? "{}"))}`;
  });
}
main();
