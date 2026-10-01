#!/usr/bin/env node
// Builds dist/ghost-harness.zip containing only what Ghost needs, ready for
// Ghost Admin, Settings, Design, Change theme, Upload theme.
//
// Uses the system `zip` command (macOS, Linux and WSL have it). The GitHub Actions
// deploy workflow does not need this script: the deploy action zips the theme itself.

import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const out = resolve(root, "dist", "ghost-harness.zip");
const include = ["package.json", "LICENSE", "assets", "partials", "default.hbs", "home.hbs", "index.hbs", "post.hbs", "page.hbs", "tag.hbs", "author.hbs", "error.hbs"];

mkdirSync(dirname(out), { recursive: true });
rmSync(out, { force: true });
try {
    execFileSync("zip", ["-r", "-q", out, ...include, "-x", "*.DS_Store"], { cwd: root, stdio: "inherit" });
} catch (error) {
    console.error(error.code === "ENOENT" ? "The `zip` command is not installed. Install it, or let the GitHub Action deploy the theme." : error.message);
    process.exit(1);
}
console.log(`Wrote ${out}`);
