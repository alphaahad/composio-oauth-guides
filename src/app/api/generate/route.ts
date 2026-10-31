import { geminiLlm } from "@/lib/llm";
import { defaultDeps, resolveInput, runPipeline, slugify } from "@/lib/pipeline";
import { checkRate } from "@/lib/ratelimit";
import { getLive, getSeed, saveLive } from "@/lib/store";

export const maxDuration = 120; // live generation reads several pages and calls the model twice

const sse = (obj: unknown) => `data: ${JSON.stringify(obj)}\n\n`;

export function GET() {
  return Response.json({ error: "Use POST with a JSON body: { \"query\": \"app name or website\" }." }, { status: 405, headers: { Allow: "POST" } });
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { query?: unknown; fresh?: unknown } | null;
  const query = typeof body?.query === "string" ? body.query : "";

  let resolved;
  try {
    resolved = resolveInput(query);
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "Invalid input" }, { status: 400 });
  }
  const slug = slugify(resolved.name);

  const headers = { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache, no-transform", connection: "keep-alive", "x-accel-buffering": "no" }; // last one stops proxies from buffering the stream
  const quick = (obj: unknown) => new Response(sse(obj), { headers });

  // Curated seed or a recent live guide: no model call, instant.
  if (await getSeed(slug)) return quick({ type: "ready", slug, source: "seed" });
  if (body?.fresh !== true && (await getLive(slug))) return quick({ type: "ready", slug, source: "cache" });

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return Response.json({ error: "Live generation is not configured on this server (GEMINI_API_KEY is missing)." }, { status: 503 });
  }

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() || "local";
  const rate = checkRate(ip);
  if (!rate.ok) {
    return Response.json(
      { error: `Rate limit reached. Try again in ${Math.ceil(rate.retryAfterSec / 60)} minute(s).` },
      { status: 429, headers: { "retry-after": String(rate.retryAfterSec) } },
    );
  }

  const deps = defaultDeps(geminiLlm(apiKey, { models: (process.env.GEMINI_MODEL ?? "").split(",").map((m) => m.trim()).filter(Boolean), groundingModel: process.env.GEMINI_GROUNDING_MODEL || undefined }));
  const stream = new ReadableStream({
    async start(controller) {
      const enc = new TextEncoder();
      const send = (o: unknown) => {
        try {
          controller.enqueue(enc.encode(sse(o)));
        } catch {
          /* the client has gone away */
        }
      };
      try {
        for await (const ev of runPipeline(query, deps)) {
          if (req.signal.aborted) break; // the visitor cancelled or left: stop spending model quota on the next stage
          if (ev.type === "result") {
            await saveLive(ev.guide);
            send({ type: "ready", slug: ev.guide.slug, source: "live" });
          } else {
            send(ev);
          }
        }
      } catch (e) {
        // Don't leak internals (keys, stack traces) to the browser.
        console.error("generate failed", e);
        send({ type: "error", message: "Something went wrong while generating this guide. Please try again." });
      } finally {
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      }
    },
  });
  return new Response(stream, { headers });
}
