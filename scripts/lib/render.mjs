// Renders the facts block and seed posts from the schema in assets/js/facts.js.
// The editor Snippet and the seeded posts come from the same function, so they
// cannot drift apart.

import { FIELDS, SCALES, SCHEMA_VERSION } from "../../assets/js/facts.js";

export function esc(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

const TRI_TEXT = { true: "Yes", false: "No", null: "Unknown" };

// Accept a plain value or { v, text, note }.
function toEntry(field, input) {
    const entry = input !== null && typeof input === "object" && !Array.isArray(input) ? { ...input } : { v: input };
    if (entry.v === undefined) entry.v = null;
    if (entry.text === undefined) {
        if (entry.v === null) entry.text = "Unknown";
        else if (field.kind === "tri") entry.text = TRI_TEXT[entry.v];
        else if (field.kind === "list") entry.text = entry.v.join(", ");
        else entry.text = String(entry.v);
    }
    entry.note ??= "";
    entry.sources ??= [];
    return entry;
}

function dataV(field, entry) {
    if (!["score", "level", "tri"].includes(field.kind)) return "";
    const value = entry.v === null ? "unknown" : field.kind === "tri" ? (entry.v ? "yes" : "no") : String(entry.v);
    return ` data-v="${esc(value)}"`;
}

function renderNote(entry) {
    const links = entry.sources.map((source) => `<a href="${esc(source.href)}">${esc(source.label)}</a>`).join(" · ");
    const parts = [entry.note ? esc(entry.note) : "", links].filter(Boolean);
    return parts.join(" ");
}

function scaleComment() {
    const lines = ["Scales (put the number in data-v, put a short human label in the cell text):"];
    for (const field of FIELDS.filter((item) => item.scale)) {
        lines.push(`  ${field.key}: ${SCALES[field.scale].map((label, index) => `${index} = ${label}`).join(" | ")}`);
    }
    lines.push("  harness: 0 to 10, one decimal allowed (editorial score).");
    lines.push("  server, headless, acp, mcp, selfhost: data-v is yes, no or unknown.");
    lines.push("Hints:");
    for (const field of FIELDS.filter((item) => item.hint)) lines.push(`  ${field.key}: ${field.hint}`);
    return lines.join("\n");
}

// values: { [fieldKey]: plain value | { v, text, note, sources } }
export function renderFactsBlock(values = {}, { template = false } = {}) {
    const rows = FIELDS.map((field) => {
        const entry = toEntry(field, values[field.key]);
        const note = template ? "" : renderNote(entry);
        return `      <tr data-field="${field.key}"><th scope="row">${esc(field.label)}</th><td${dataV(field, entry)}>${esc(entry.text)}</td><td>${note}</td></tr>`;
    });

    const header = template
        ? `<!--\n  Harness facts, schema v${SCHEMA_VERSION}. Paste this whole block into ONE Ghost HTML card.\n  Edit only the Value and Notes cells. Keep every data-field, every data-v and the three cells per row.\n  ${scaleComment().replace(/\n/g, "\n  ")}\n  Unknown is a valid answer. Put source links in the Notes cells.\n-->\n`
        : "";

    return `${header}<section data-harness-facts="${SCHEMA_VERSION}" aria-label="Harness facts">
  <h2>Facts at a glance</h2>
  <p>These values feed the comparison matrix. Unknown means the answer has not been verified yet.</p>
  <table>
    <caption>Facts read by the comparison matrix</caption>
    <thead><tr><th scope="col">Property</th><th scope="col">Value</th><th scope="col">Notes and sources</th></tr></thead>
    <tbody>
${rows.join("\n")}
    </tbody>
  </table>
</section>`;
}

// Turn the human-friendly seed facts into renderer values and attach sources to the "checked" row.
export function seedToValues(harness) {
    const values = { ...harness.facts };
    const checked = toEntry(FIELDS.find((field) => field.key === "checked"), values.checked);
    checked.note = checked.note || "Initial dataset. Sources:";
    checked.sources = harness.sources ?? [];
    values.checked = checked;
    return values;
}

export function renderPostHtml(harness) {
    // The summary is the post excerpt (shown in the header) and the per-field notes live in the facts
    // block, so the prose here stays short. Replace or extend it with your own write-up, and keep the
    // facts card at the end.
    const take = harness.take ? `<h2>Take</h2>\n<p>${esc(harness.take)}</p>\n` : "";
    const block = renderFactsBlock(seedToValues(harness));
    return `${take}<!--kg-card-begin: html-->\n${block}\n<!--kg-card-end: html-->`;
}
