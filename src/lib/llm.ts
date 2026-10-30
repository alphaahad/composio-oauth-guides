import { GoogleGenAI } from "@google/genai";
import { z } from "zod";
import { ExtractedGuide } from "./schema";

export type DiscoveredUrl = { url: string; title?: string };

export interface Llm {
  /** Web-grounded search: returns candidate documentation URLs for the app. */
  discover(app: string, website?: string): Promise<DiscoveredUrl[]>;
  /** Which of these URLs are the provider's own pages vs third-party? Returns the official ones. */
  classify(app: string, urls: DiscoveredUrl[]): Promise<Set<string>>;
  /** Structured extraction. Must return JSON matching ExtractedGuide. */
  extract(prompt: string): Promise<unknown>;
}

export const DEFAULT_MODEL = "gemini-2.5-flash";

function jsonSchema(schema: z.ZodType): unknown {
  const s = z.toJSONSchema(schema) as Record<string, unknown>;
  delete s.$schema;
  return s;
}

export function geminiLlm(apiKey: string, model = DEFAULT_MODEL): Llm {
  const ai = new GoogleGenAI({ apiKey });

  return {
    async discover(app, website) {
      const res = await ai.models.generateContent({
        model,
        contents:
          `Find the official developer documentation pages that explain how to create/register an OAuth app for "${app}"` +
          (website ? ` (website: ${website})` : "") +
          `, including any app review, verification, or partner-approval requirements and scope/permission rules. ` +
          `Also include up to 2 third-party community pages (forum, Stack Overflow, blog) that report real approval wait times, if any exist. ` +
          `List the page URLs.`,
        config: { tools: [{ googleSearch: {} }], temperature: 0 },
      });
      const found = new Map<string, DiscoveredUrl>();
      const chunks = res.candidates?.[0]?.groundingMetadata?.groundingChunks ?? [];
      for (const c of chunks) {
        const uri = c.web?.uri;
        if (uri) found.set(uri, { url: uri, title: c.web?.title });
      }
      for (const m of (res.text ?? "").matchAll(/https:\/\/[^\s)\]>"'`]+/g)) {
        const u = m[0].replace(/[.,;]+$/, "");
        if (!found.has(u)) found.set(u, { url: u });
      }
      return [...found.values()];
    },

    async classify(app, urls) {
      if (urls.length === 0) return new Set();
      const Out = z.object({ official: z.array(z.string()) });
      const res = await ai.models.generateContent({
        model,
        contents:
          `For the app "${app}", which of these pages are published by the provider itself (its developer docs, help center, ` +
          `or its parent company's docs)? Exclude forums, blogs, Stack Overflow, Medium, and third-party tutorials. ` +
          `Return only URLs from this list, exactly as given.\n` +
          urls.map((u) => `- ${u.url}${u.title ? ` (${u.title})` : ""}`).join("\n"),
        config: { responseMimeType: "application/json", responseJsonSchema: jsonSchema(Out), temperature: 0 },
      });
      const parsed = Out.safeParse(JSON.parse(res.text ?? "{}"));
      const allowed = new Set(urls.map((u) => u.url));
      return new Set(parsed.success ? parsed.data.official.filter((u) => allowed.has(u)) : []);
    },

    async extract(prompt) {
      let lastErr: unknown;
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const res = await ai.models.generateContent({
            model,
            contents: prompt,
            config: {
              responseMimeType: "application/json",
              responseJsonSchema: jsonSchema(ExtractedGuide),
              temperature: 0,
            },
          });
          return JSON.parse(res.text ?? "");
        } catch (e) {
          lastErr = e;
        }
      }
      throw lastErr instanceof Error ? lastErr : new Error("extraction failed");
    },
  };
}
