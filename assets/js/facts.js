// The facts contract: one HTML block per harness post, read by the theme.
//
// This module is the single source of truth for the schema. It has no imports
// and no top-level DOM access, so it runs in the browser (via an import map),
// in Node (tests, seed and lint scripts), and it generates the editor Snippet.
//
// Contract documentation: _SCHEMA.md

export const SCHEMA_VERSION = "1";

// Ordinal scales. Index = value stored in `data-v`.
export const SCALES = Object.freeze({
    plan: [
        "None",
        "Inherited from a wrapped agent, prompt-only, or a workaround",
        "One-shot command or chat mode",
        "Native Plan/Build toggle",
        "Native toggle with an approve-or-revise gate",
    ],
    web: [
        "None",
        "Experimental, or a vendor-cloud web UI only",
        "Native web UI you can self-host",
        "Web-first, or built-in remote access",
    ],
    browser: [
        "None (fetching or scraping a page does not count)",
        "Add-on you wire up yourself (MCP server, community plugin)",
        "First-party, but tied to a desktop app or desktop browser",
        "First-party and documented for headless or remote hosts",
    ],
});

// kind: score (decimal, min..max) | level (integer 0..max) | tri (yes/no/unknown)
//       | text | list | date
// `short` is the matrix column title. `matrix` marks fields with a column.
export const FIELDS = Object.freeze([
    { key: "type", label: "Type", kind: "text", hint: "Agent harness, Meta-harness, Platform, App builder…" },
    { key: "org", label: "Maker", kind: "text", hint: "Company or project that makes it." },
    { key: "harness", label: "Harness-y score (0–10)", short: "Harness-y", kind: "score", min: 0, max: 10, matrix: true, hint: "Editorial score: how much it is orchestration around swappable models or agents." },
    { key: "plan", label: "Plan mode", short: "Plan mode", kind: "level", max: 4, scale: "plan", matrix: true },
    { key: "web", label: "Self-hosted web UI", short: "Web UI", kind: "level", max: 3, scale: "web", matrix: true },
    { key: "browser", label: "Browser use", short: "Browser", kind: "level", max: 3, scale: "browser", matrix: true },
    { key: "server", label: "Server or API mode", short: "Server", kind: "tri", matrix: true },
    { key: "headless", label: "Headless or scripted use", short: "Headless", kind: "tri" },
    { key: "acp", label: "Agent Client Protocol (ACP)", short: "ACP", kind: "tri", matrix: true },
    { key: "mcp", label: "Model Context Protocol (MCP)", short: "MCP", kind: "tri", matrix: true },
    { key: "selfhost", label: "Self-hostable", short: "Self-host", kind: "tri", matrix: true },
    { key: "license", label: "License", kind: "text" },
    { key: "byo", label: "Models and providers", kind: "text" },
    { key: "interfaces", label: "Interfaces", kind: "list", hint: "Comma-separated: TUI, Web, Desktop, ACP…" },
    { key: "approvals", label: "Approvals and autonomy", kind: "text" },
    { key: "checked", label: "Last verified", kind: "date", hint: "YYYY-MM-DD. List sources in the Notes cell." },
]);

// Null prototype on purpose: a row keyed "__proto__" or "constructor" must not resolve to a field.
export const FIELD_BY_KEY = Object.freeze(Object.assign(Object.create(null), Object.fromEntries(FIELDS.map((field) => [field.key, field]))));

const UNKNOWN_TEXT = "Unknown";
const TRI_YES = /^(yes|true|y|supported)$/i;
const TRI_NO = /^(no|false|n|none|—|-|not supported)$/i;
const TRI_UNKNOWN = /^(unknown|\?|n\/a|na|unclear|not stated)?$/i;

export function clean(value) {
    return String(value ?? "").replace(/\s+/g, " ").trim();
}

export function safeHref(value, baseUrl) {
    const href = clean(value);
    if (!href) return null;
    try {
        const url = new URL(href, baseUrl);
        return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password ? url.href : null;
    } catch {
        return null;
    }
}

export function scaleLabel(key, value) {
    const scale = SCALES[key];
    return scale && Number.isInteger(value) ? scale[value] ?? null : null;
}

// Turn a raw value cell into a typed value. `dataV` wins over the visible text.
// Returns { v, warning? } where v is null for "unknown".
export function coerceValue(field, dataV, text) {
    const raw = clean(dataV) || clean(text);
    const usedAttribute = Boolean(clean(dataV));
    const fallback = (message) => ({ v: null, warning: usedAttribute ? message : `${message} Add data-v to make it explicit.` });

    switch (field.kind) {
        case "tri": {
            if (TRI_YES.test(raw)) return { v: true };
            if (TRI_NO.test(raw)) return { v: false };
            if (TRI_UNKNOWN.test(raw)) return { v: null };
            return fallback(`“${field.key}” must be yes, no or unknown (got “${raw}”).`);
        }
        case "level":
        case "score": {
            if (TRI_UNKNOWN.test(raw)) return { v: null };
            const numeric = usedAttribute ? raw : (raw.match(/-?\d+(?:\.\d+)?/) || [])[0];
            const number = numeric === undefined ? Number.NaN : Number(numeric);
            if (!Number.isFinite(number)) return fallback(`“${field.key}” needs a number (got “${raw}”).`);
            const min = field.min ?? 0;
            if (number < min || number > field.max) return { v: null, warning: `“${field.key}” must be between ${min} and ${field.max} (got ${number}).` };
            if (field.kind === "level" && !Number.isInteger(number)) return { v: null, warning: `“${field.key}” must be a whole number (got ${number}).` };
            return { v: number };
        }
        case "date": {
            if (TRI_UNKNOWN.test(raw)) return { v: null };
            if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return { v: raw, warning: `“${field.key}” should be YYYY-MM-DD (got “${raw}”).` };
            return { v: raw };
        }
        case "list": {
            if (TRI_UNKNOWN.test(raw)) return { v: null };
            return { v: raw.split(/\s*[,;·]\s*/).map(clean).filter(Boolean) };
        }
        default:
            return /^unknown$/i.test(raw) || !raw ? { v: null } : { v: raw };
    }
}

// Pure validation shared by the browser parser, the lint script and the tests.
// rows: [{ key, validCells, dataV, valueText, noteText, links: [{ href, label }] }]
export function normalizeFactRows(rows, baseUrl) {
    const warnings = [];
    const fields = {};

    for (const row of rows) {
        const key = clean(row.key);
        const field = Object.hasOwn(FIELD_BY_KEY, key) ? FIELD_BY_KEY[key] : undefined;
        if (!field) {
            warnings.push(`Unknown field “${key || "(no data-field)"}” is ignored.`);
            continue;
        }
        if (Object.hasOwn(fields, key)) {
            return { status: "malformed", message: `The field “${key}” appears more than once.`, warnings };
        }
        if (!row.validCells) {
            return { status: "malformed", message: `The “${key}” row needs exactly three cells (label, value, notes) without colspan or rowspan.`, warnings };
        }
        const { v, warning } = coerceValue(field, row.dataV, row.valueText);
        if (warning) warnings.push(warning);

        const sources = [];
        for (const link of row.links || []) {
            const href = safeHref(link.href, baseUrl);
            if (href && !sources.some((item) => item.href === href)) {
                let label = clean(link.label);
                if (!label) {
                    try { label = new URL(href).hostname; } catch { label = href; }
                }
                sources.push({ href, label });
            }
        }
        fields[key] = {
            key,
            v,
            text: clean(row.valueText) || UNKNOWN_TEXT,
            note: clean(row.noteText),
            sources,
            missing: false,
        };
    }

    if (!Object.keys(fields).length) {
        return { status: "malformed", message: "The facts table has no recognised fields.", warnings };
    }

    for (const field of FIELDS) {
        if (!Object.hasOwn(fields, field.key)) {
            warnings.push(`Missing field “${field.key}”.`);
            fields[field.key] = { key: field.key, v: null, text: UNKNOWN_TEXT, note: "", sources: [], missing: true };
        }
    }
    return { status: "ready", fields, warnings };
}

function visibleText(element) {
    const copy = element.cloneNode(true);
    copy.querySelectorAll("script, style, template, noscript").forEach((node) => node.remove());
    return copy.textContent;
}

// Note text without the link labels: links are returned separately as `sources`, and listing them
// twice is noise. Tidies the punctuation that links leave behind, such as "()" or "· ·".
export function proseWithoutLinks(element) {
    const copy = element.cloneNode(true);
    copy.querySelectorAll("script, style, template, noscript").forEach((node) => node.remove());
    copy.querySelectorAll("a").forEach((node) => node.replaceWith(" "));
    return clean(copy.textContent)
        .replace(/\(\s*\)|\[\s*\]/g, "")
        .replace(/(?:\s*·\s*){2,}/g, " · ")
        .replace(/^\s*·\s*|\s*·\s*$/g, "")
        .replace(/\s+([.,;:])/g, "$1")
        .replace(/\s{2,}/g, " ")
        .trim();
}

// root: a Document, DocumentFragment or Element (for example a <template>'s content).
export function parseFactsRoot(root, baseUrl) {
    const blocks = root.querySelectorAll("[data-harness-facts]");
    if (!blocks.length) return { status: "missing", message: "This post has no harness facts block.", warnings: [] };
    if (blocks.length !== 1) return { status: "malformed", message: "A post must contain exactly one harness facts block.", warnings: [] };

    const block = blocks[0];
    if (block.tagName !== "SECTION" || block.dataset.harnessFacts !== SCHEMA_VERSION) {
        return { status: "malformed", message: `Unsupported facts format (expected <section data-harness-facts="${SCHEMA_VERSION}">).`, warnings: [] };
    }
    if (block.querySelectorAll("table").length !== 1) {
        return { status: "malformed", message: "The facts block must contain exactly one table.", warnings: [] };
    }

    const rows = [...block.querySelectorAll("tbody > tr")].map((row) => {
        const cells = [...row.children];
        const [, valueCell, noteCell] = cells;
        return {
            key: row.dataset.field,
            validCells:
                cells.length === 3 &&
                cells[0].tagName === "TH" &&
                valueCell.tagName === "TD" &&
                noteCell.tagName === "TD" &&
                !cells.some((cell) => cell.hasAttribute("rowspan") || cell.hasAttribute("colspan")),
            dataV: valueCell?.getAttribute("data-v") ?? "",
            valueText: valueCell ? visibleText(valueCell) : "",
            noteText: noteCell ? proseWithoutLinks(noteCell) : "",
            links: cells.slice(1).flatMap((cell) =>
                [...cell.querySelectorAll("a[href]")].map((link) => ({ href: link.getAttribute("href"), label: visibleText(link) })),
            ),
        };
    });
    return normalizeFactRows(rows, baseUrl);
}

export function parseFactsHtml(html, baseUrl) {
    const document = new DOMParser().parseFromString(html, "text/html");
    return parseFactsRoot(document, baseUrl);
}

// Sorting and filtering helpers ------------------------------------------------

// Numeric/string key used for sorting; null means "unknown" and always sorts last.
export function sortKey(field, fact) {
    if (!fact || fact.v === null || fact.v === undefined) return null;
    if (field.kind === "tri") return fact.v ? 1 : 0;
    if (field.kind === "list") return fact.v.join(", ").toLowerCase();
    if (typeof fact.v === "string") return fact.v.toLowerCase();
    return fact.v;
}

export function compareFacts(field, a, b, direction = -1) {
    const x = sortKey(field, a);
    const y = sortKey(field, b);
    if (x === null && y === null) return 0;
    if (x === null) return 1;
    if (y === null) return -1;
    const result = typeof x === "string" ? x.localeCompare(y) : x - y;
    return result * direction;
}

// Values are equal for "differences only" in the compare view.
export function sameFact(field, a, b) {
    return JSON.stringify(a?.v ?? null) === JSON.stringify(b?.v ?? null);
}
