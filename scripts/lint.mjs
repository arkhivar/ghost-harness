#!/usr/bin/env node
// Checks harness facts blocks against the schema in assets/js/facts.js.
//
//   node scripts/lint.mjs                  lint every post tagged #harness on your Ghost site
//   node scripts/lint.mjs --file a.html    lint local HTML files (no network)
//   node scripts/lint.mjs --strict         treat warnings as failures too
//
// Remote mode needs GHOST_URL and GHOST_ADMIN_API_KEY. Run it after editing posts and
// whenever the schema changes: Snippets insert copies, so older posts can drift.
//
// Exit code 1 means at least one post is missing its block or has a malformed one
// (or has any warning, with --strict).

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { parseFactsHtml } from "../assets/js/facts.js";
import { GhostAdmin } from "./lib/ghost-api.mjs";

async function ensureDomParser() {
    if (globalThis.DOMParser) return;
    try {
        const { JSDOM } = await import("jsdom");
        globalThis.DOMParser = new JSDOM("").window.DOMParser;
    } catch {
        throw new Error("jsdom is needed to parse HTML. Run: npm install");
    }
}

export function lintHtml(html, baseUrl = "https://example.invalid/") {
    const result = parseFactsHtml(html, baseUrl);
    return {
        status: result.status,
        message: result.message,
        warnings: result.warnings ?? [],
    };
}

function parseArgs(argv) {
    const options = { strict: false, files: [] };
    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];
        if (arg === "--strict") options.strict = true;
        else if (arg === "--file") options.files.push(argv[++index]);
        else throw new Error(`Unknown option: ${arg}`);
    }
    return options;
}

async function collect(options) {
    if (options.files.length) {
        return Promise.all(options.files.map(async (file) => ({ label: file, html: await readFile(file, "utf8"), meta: "local file" })));
    }
    const ghost = new GhostAdmin();
    const posts = await ghost.browseAll("posts", { filter: "tag:hash-harness", formats: "html", fields: "slug,title,status,html,url" });
    return posts.map((post) => ({ label: post.slug, html: post.html ?? "", meta: post.status, url: post.url }));
}

async function main() {
    const options = parseArgs(process.argv.slice(2));
    await ensureDomParser();
    const entries = await collect(options);
    if (!entries.length) {
        console.log("No harness posts found. Tag posts with #harness first.");
        return;
    }

    let errors = 0;
    let warnings = 0;
    for (const entry of entries) {
        const result = lintHtml(entry.html, entry.url);
        const failed = result.status !== "ready";
        errors += failed ? 1 : 0;
        warnings += result.warnings.length;
        const mark = failed ? "FAIL" : result.warnings.length ? "warn" : " ok ";
        console.log(`[${mark}] ${entry.label.padEnd(20)} ${entry.meta}`);
        if (failed) console.log(`         ${result.message}`);
        for (const warning of result.warnings) console.log(`         - ${warning}`);
    }
    console.log(`\n${entries.length} posts checked: ${errors} failing, ${warnings} warnings.`);
    if (errors || (options.strict && warnings)) process.exit(1);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    main().catch((error) => {
        console.error(error.message);
        process.exit(1);
    });
}
