// Usage: npx tsx scripts/fetch-text.ts <outDir> <url> [url...]
// Fetches pages with the same guarded fetcher the product uses and writes their text to <outDir>.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fetchPage } from "../src/lib/fetcher";

async function main() {
  const [outDir, ...urls] = process.argv.slice(2);
  if (!outDir || urls.length === 0) {
    console.error("usage: fetch-text <outDir> <url...>");
    process.exit(1);
  }
  mkdirSync(outDir, { recursive: true });
  for (const url of urls) {
    const r = await fetchPage(url);
    if (!r.ok) {
      console.log(`FAIL ${url} -> ${r.error}`);
      continue;
    }
    const name = new URL(r.page.url).pathname.replace(/[^a-z0-9]+/gi, "_").replace(/^_|_$/g, "") || "index";
    const file = join(outDir, `${new URL(r.page.url).hostname}__${name}.txt`);
    writeFileSync(file, `URL: ${r.page.url}\nFETCHED: ${r.page.fetchedAt}\n\n${r.page.text}`);
    console.log(`OK   ${r.page.url} -> ${file} (${r.page.text.length} chars)`);
  }
}
main();
