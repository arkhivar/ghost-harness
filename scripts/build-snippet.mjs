#!/usr/bin/env node
// Generates snippets/harness-facts.html (the blank facts block for Ghost's editor)
// from the schema in assets/js/facts.js.
//
//   node scripts/build-snippet.mjs          write the file
//   node scripts/build-snippet.mjs --check  fail if the file is out of date

import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { renderFactsBlock } from "./lib/render.mjs";

export const SNIPPET_PATH = fileURLToPath(new URL("../snippets/harness-facts.html", import.meta.url));

export function buildSnippet() {
    return `${renderFactsBlock({}, { template: true })}\n`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    const expected = buildSnippet();
    if (process.argv.includes("--check")) {
        const current = await readFile(SNIPPET_PATH, "utf8").catch(() => "");
        if (current !== expected) {
            console.error("snippets/harness-facts.html is out of date. Run: npm run snippet");
            process.exit(1);
        }
        console.log("snippets/harness-facts.html is up to date.");
    } else {
        await writeFile(SNIPPET_PATH, expected);
        console.log("Wrote snippets/harness-facts.html");
    }
}
