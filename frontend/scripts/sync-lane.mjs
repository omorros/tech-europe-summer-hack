/**
 * Copy the warmed property cache and listing photos into frontend/public
 * so `next build` ships them with the Worker assets.
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const frontend = join(here, "..");
const repo = join(frontend, "..");

function copyDir(src, dest) {
  mkdirSync(dest, { recursive: true });
  for (const entry of readdirSync(src, { withFileTypes: true })) {
    const from = join(src, entry.name);
    const to = join(dest, entry.name);
    if (entry.isDirectory()) copyDir(from, to);
    else copyFileSync(from, to);
  }
}

const cacheSrc = join(repo, "backend/cache");
const cacheDest = join(frontend, "public/cache");
copyDir(cacheSrc, cacheDest);

const slugs = readdirSync(cacheSrc, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name);
writeFileSync(join(cacheDest, "index.json"), JSON.stringify({ slugs }, null, 2));

const artifacts = join(repo, "backend/static/artifacts");
if (existsSync(artifacts)) {
  copyDir(artifacts, join(frontend, "public/static/artifacts"));
}

console.log(`lane cache: ${slugs.length} properties → public/cache`);
