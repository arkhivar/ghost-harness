#!/usr/bin/env node
// Creates the initial harness posts in a Ghost site from seed/harnesses.json.
//
//   GHOST_URL=https://harness.example.com GHOST_ADMIN_API_KEY=id:secret node scripts/seed.mjs [options]
//
//   --dry-run       print what would be created, without touching Ghost
//   --update        overwrite posts that already exist (same slug) with the seed content
//   --status draft  create drafts instead of published posts
//
// Posts get the internal tag #harness, which is how the homepage finds them.
// Existing posts are skipped unless --update is given, so the script is safe to re-run.
//
// Not handled here: the editor Snippet. Ghost refuses Snippet access to integration
// tokens (403), so create it once by hand. See _GUIDE.md.

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { GhostAdmin } from "./lib/ghost-api.mjs";
import { renderPostHtml } from "./lib/render.mjs";

export const HARNESS_TAG = "#harness";
export const SEED_PATH = fileURLToPath(new URL("../seed/harnesses.json", import.meta.url));

export async function loadSeed(path = SEED_PATH) {
    return JSON.parse(await readFile(path, "utf8")).harnesses;
}

export function toPost(harness, status = "published") {
    return {
        title: harness.title,
        slug: harness.slug,
        status,
        custom_excerpt: harness.summary,
        tags: [{ name: HARNESS_TAG }],
        html: renderPostHtml(harness),
    };
}

function parseArgs(argv) {
    const options = { dryRun: false, update: false, status: "published" };
    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];
        if (arg === "--dry-run") options.dryRun = true;
        else if (arg === "--update") options.update = true;
        else if (arg === "--status") options.status = argv[++index];
        else throw new Error(`Unknown option: ${arg}`);
    }
    if (!["published", "draft"].includes(options.status)) throw new Error("--status must be published or draft.");
    return options;
}

async function main() {
    const options = parseArgs(process.argv.slice(2));
    const harnesses = await loadSeed();

    if (options.dryRun) {
        for (const harness of harnesses) console.log(`would create  ${harness.slug.padEnd(16)} ${toPost(harness, options.status).html.length} bytes of HTML`);
        console.log(`\n${harnesses.length} posts (dry run, nothing was sent).`);
        return;
    }

    const ghost = new GhostAdmin();
    const counts = { created: 0, updated: 0, skipped: 0 };
    for (const harness of harnesses) {
        const post = toPost(harness, options.status);
        const existing = await ghost.postBySlug(harness.slug);
        if (existing && !options.update) {
            counts.skipped += 1;
            console.log(`skipped  ${harness.slug} (already exists; use --update to overwrite)`);
        } else if (existing) {
            await ghost.updatePost(existing.id, { ...post, updated_at: existing.updated_at });
            counts.updated += 1;
            console.log(`updated  ${harness.slug}`);
        } else {
            await ghost.createPost(post);
            counts.created += 1;
            console.log(`created  ${harness.slug}`);
        }
    }
    console.log(`\nDone: ${counts.created} created, ${counts.updated} updated, ${counts.skipped} skipped.`);
    console.log("Next: create the 'Harness facts' Snippet by hand (see _GUIDE.md), then run: npm run lint:facts");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    main().catch((error) => {
        console.error(error.message);
        process.exit(1);
    });
}
