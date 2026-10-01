import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import {
    FIELDS,
    FIELD_BY_KEY,
    SCALES,
    coerceValue,
    compareFacts,
    normalizeFactRows,
    parseFactsHtml,
    proseWithoutLinks,
    safeHref,
    sameFact,
} from "../assets/js/facts.js";
import { renderFactsBlock } from "../scripts/lib/render.mjs";

globalThis.DOMParser = new JSDOM("").window.DOMParser;

const base = "https://harness.example/post/";
const row = (key, valueText, extra = {}) => ({ key, validCells: true, dataV: "", valueText, noteText: "", links: [], ...extra });

test("schema: every scaled field has a label for each level", () => {
    for (const field of FIELDS.filter((item) => item.scale)) {
        assert.equal(SCALES[field.scale].length, field.max + 1, field.key);
    }
    assert.equal(new Set(FIELDS.map((field) => field.key)).size, FIELDS.length, "keys are unique");
});

test("data-v wins over the visible text", () => {
    assert.deepEqual(coerceValue(FIELD_BY_KEY.plan, "3", "Native toggle"), { v: 3 });
    assert.deepEqual(coerceValue(FIELD_BY_KEY.server, "yes", "Probably"), { v: true });
    assert.deepEqual(coerceValue(FIELD_BY_KEY.harness, "8.5", "high"), { v: 8.5 });
});

test("unknown is a value of its own and never becomes zero or no", () => {
    for (const key of ["plan", "harness", "server", "checked", "license", "interfaces"]) {
        assert.equal(coerceValue(FIELD_BY_KEY[key], "unknown", "Unknown").v, null, key);
        assert.equal(coerceValue(FIELD_BY_KEY[key], "", "").v, null, key);
    }
    assert.equal(coerceValue(FIELD_BY_KEY.server, "no", "No").v, false);
    assert.equal(coerceValue(FIELD_BY_KEY.plan, "0", "None").v, 0);
});

test("without data-v, numbers are read from the text but plain words are rejected", () => {
    assert.equal(coerceValue(FIELD_BY_KEY.plan, "", "3 – Native toggle").v, 3);
    const result = coerceValue(FIELD_BY_KEY.plan, "", "Native toggle");
    assert.equal(result.v, null);
    assert.match(result.warning, /needs a number/);
});

test("out-of-range and fractional levels are warnings, not silent values", () => {
    assert.match(coerceValue(FIELD_BY_KEY.plan, "7", "").warning, /between 0 and 4/);
    assert.match(coerceValue(FIELD_BY_KEY.web, "1.5", "").warning, /whole number/);
    assert.match(coerceValue(FIELD_BY_KEY.harness, "11", "").warning, /between 0 and 10/);
    assert.match(coerceValue(FIELD_BY_KEY.checked, "", "yesterday").warning, /YYYY-MM-DD/);
});

test("list values split on commas, semicolons and middle dots", () => {
    assert.deepEqual(coerceValue(FIELD_BY_KEY.interfaces, "", "TUI, Web ; Desktop · ACP (stdio)").v, ["TUI", "Web", "Desktop", "ACP (stdio)"]);
});

test("normalizeFactRows fills missing fields and keeps them distinguishable from unknown", () => {
    const result = normalizeFactRows([row("plan", "Native", { dataV: "3" }), row("server", "Unknown", { dataV: "unknown" })], base);
    assert.equal(result.status, "ready");
    assert.equal(result.fields.plan.v, 3);
    assert.equal(result.fields.server.v, null);
    assert.equal(result.fields.server.missing, false);
    assert.equal(result.fields.web.missing, true);
    assert.ok(result.warnings.some((warning) => warning.includes("Missing field “web”")));
    assert.equal(Object.keys(result.fields).length, FIELDS.length);
});

test("duplicates, damaged rows and empty tables are visible format errors", () => {
    assert.equal(normalizeFactRows([row("plan", "1"), row("plan", "2")], base).status, "malformed");
    assert.equal(normalizeFactRows([row("plan", "1", { validCells: false })], base).status, "malformed");
    assert.equal(normalizeFactRows([], base).status, "malformed");
});

test("unknown keys never become properties", () => {
    const result = normalizeFactRows([row("__proto__", "x"), row("plan", "", { dataV: "2" }), row("cuisine", "yes")], base);
    assert.equal(result.status, "ready");
    assert.equal(Object.hasOwn(result.fields, "__proto__"), false);
    assert.equal(Object.hasOwn(result.fields, "cuisine"), false);
    assert.equal(result.warnings.filter((warning) => warning.startsWith("Unknown field")).length, 2);
});

test("sources are resolved against the post URL, de-duplicated, and limited to http(s)", () => {
    const result = normalizeFactRows(
        [
            row("plan", "", {
                dataV: "2",
                links: [
                    { href: "/docs/", label: "Docs" },
                    { href: "https://harness.example/docs/", label: "Again" },
                    { href: "javascript:alert(1)", label: "Bad" },
                    { href: "https://vendor.example/", label: "" },
                ],
            }),
        ],
        base,
    );
    assert.deepEqual(result.fields.plan.sources, [
        { href: "https://harness.example/docs/", label: "Docs" },
        { href: "https://vendor.example/", label: "vendor.example" },
    ]);
    for (const href of ["", "javascript:alert(1)", "data:text/html,x", "file:///etc/passwd", "mailto:a@b.c", "https://user:pw@x.example/"]) {
        assert.equal(safeHref(href, base), null, href);
    }
});

test("sorting puts unknown last in both directions and booleans rank yes above no", () => {
    const plan = FIELD_BY_KEY.plan;
    const facts = [{ v: 1 }, { v: null }, { v: 4 }];
    assert.deepEqual([...facts].sort((a, b) => compareFacts(plan, a, b, -1)).map((fact) => fact.v), [4, 1, null]);
    assert.deepEqual([...facts].sort((a, b) => compareFacts(plan, a, b, 1)).map((fact) => fact.v), [1, 4, null]);
    const server = FIELD_BY_KEY.server;
    assert.ok(compareFacts(server, { v: true }, { v: false }, -1) < 0);
    assert.ok(sameFact(server, { v: true }, { v: true }));
    assert.ok(!sameFact(server, { v: true }, { v: null }));
});

test("parseFactsHtml: the generated blank snippet parses cleanly as all-unknown", () => {
    const html = renderFactsBlock({}, { template: true });
    const result = parseFactsHtml(html, base);
    assert.equal(result.status, "ready");
    assert.deepEqual(result.warnings, []);
    for (const field of FIELDS) assert.equal(result.fields[field.key].v, null, field.key);
});

test("parseFactsHtml: structural problems are reported with distinct states", () => {
    assert.equal(parseFactsHtml("<p>No block here</p>", base).status, "missing");
    const block = renderFactsBlock({});
    assert.equal(parseFactsHtml(block + block, base).status, "malformed", "two blocks");
    assert.equal(parseFactsHtml(block.replace('data-harness-facts="1"', 'data-harness-facts="2"'), base).status, "malformed", "future version");
    assert.equal(parseFactsHtml(block.replace("<tbody>", "<tbody><tr data-field=\"plan\"><th>x</th><td>1</td></tr>"), base).status, "malformed", "short row");
});

test("parseFactsHtml ignores script and template content inside value cells", () => {
    const html = renderFactsBlock({ license: "MIT" }).replace(
        "<td>MIT</td>",
        "<td>MIT<script>alert(1)</script><template>hidden</template></td>",
    );
    assert.equal(parseFactsHtml(html, base).fields.license.text, "MIT");
});

test("note text drops link labels and the punctuation they leave behind", () => {
    const cell = (html) => new JSDOM(`<table><tr><td>${html}</td></tr></table>`).window.document.querySelector("td");
    assert.equal(proseWithoutLinks(cell('Initial dataset. Sources: <a href="https://a.example/">A</a> · <a href="https://b.example/">B</a>')), "Initial dataset. Sources:");
    assert.equal(proseWithoutLinks(cell('Documented in the guide (<a href="https://a.example/">guide</a>).')), "Documented in the guide.");
    assert.equal(proseWithoutLinks(cell('Plain   note <script>alert(1)</script>with spaces')), "Plain note with spaces");
});

test("parseFactsHtml returns sources separately from the note prose", () => {
    const html = renderFactsBlock({ plan: { v: 3, text: "Native", note: "Shift+Tab toggles it.", sources: [{ label: "Docs", href: "https://docs.example/plan" }] } });
    const plan = parseFactsHtml(html, base).fields.plan;
    assert.equal(plan.note, "Shift+Tab toggles it.");
    assert.deepEqual(plan.sources, [{ href: "https://docs.example/plan", label: "Docs" }]);
});
