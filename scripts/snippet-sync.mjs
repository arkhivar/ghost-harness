#!/usr/bin/env node
// Creates or updates the "Harness facts" Snippet from snippets/harness-facts.html.
// Optional: the manual route in _GUIDE.md works without it.
//
//   GHOST_URL=https://harness.example.com GHOST_STAFF_TOKEN=id:secret node scripts/snippet-sync.mjs [options]
//
//   --dry-run       say what would happen, change nothing
//   --name "..."    use another Snippet name (default: Harness facts)
//
// Why a staff token and not the Admin API key from the custom integration: Ghost answers
// 403 to integration tokens on the Snippets endpoint. A staff access token (your profile page
// in Ghost Admin) authenticates as you and is allowed. It carries your full role permissions,
// so keep it out of the repository and out of GitHub secrets unless you mean to.

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { GhostAdmin } from "./lib/ghost-api.mjs";
import { SNIPPET_NAME, snippetBody, snippetHtml } from "./lib/snippet.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const nameIndex = args.indexOf("--name");
const name = nameIndex >= 0 && args[nameIndex + 1] ? args[nameIndex + 1] : SNIPPET_NAME;

const token = process.env.GHOST_STAFF_TOKEN;
if (!token || !token.includes(":")) {
    console.error("Set GHOST_STAFF_TOKEN to your staff access token (id:secret). Find it on your profile page in Ghost Admin.");
    process.exit(1);
}

const html = readFileSync(resolve(root, "snippets", "harness-facts.html"), "utf8");
const ghost = new GhostAdmin({ key: token });
const query = { formats: "mobiledoc,lexical", limit: "all" };

try {
    const { snippets } = await ghost.request("GET", "snippets/", { query });
    const existing = snippets.find((snippet) => snippet.name === name);

    if (existing && snippetHtml(existing.lexical) === html) {
        console.log(`Snippet "${name}" is already up to date.`);
    } else if (dryRun) {
        console.log(`Would ${existing ? "update" : "create"} the Snippet "${name}" (${html.length} bytes of HTML).`);
    } else if (existing) {
        await ghost.request("PUT", `snippets/${existing.id}/`, { query: { formats: query.formats }, body: snippetBody(name, html) });
        console.log(`Updated the Snippet "${name}". Posts that already used the old version keep it; run npm run lint:facts.`);
    } else {
        await ghost.request("POST", "snippets/", { query: { formats: query.formats }, body: snippetBody(name, html) });
        console.log(`Created the Snippet "${name}". In the editor, type /harness on an empty line.`);
    }
} catch (error) {
    if (error.status === 403) {
        console.error("Ghost answered 403. That is what an integration (custom integration) key gets. Use the staff access token from your profile page instead.");
    } else if (error.status === 401) {
        console.error("Ghost rejected the token (401). Copy the full id:secret again, and check GHOST_URL is the site's public URL.");
    } else {
        console.error(error.message);
    }
    process.exit(1);
}
