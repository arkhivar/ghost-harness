import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { SNIPPET_NAME, snippetBody, snippetHtml, snippetLexical } from "../scripts/lib/snippet.mjs";

const html = readFileSync(new URL("../snippets/harness-facts.html", import.meta.url), "utf8");

test("snippet body has the shape Ghost's editor sends", () => {
    const body = snippetBody(SNIPPET_NAME, html);
    assert.equal(body.snippets.length, 1);
    const [snippet] = body.snippets;
    assert.equal(snippet.name, "Harness facts");
    assert.equal(snippet.mobiledoc, "{}");
    assert.equal(typeof snippet.lexical, "string");
});

test("lexical wraps the html in a single Koenig html card", () => {
    const parsed = JSON.parse(snippetLexical("<p>x</p>"));
    assert.equal(parsed.namespace, "KoenigEditor");
    assert.equal(parsed.nodes.length, 1);
    assert.equal(parsed.nodes[0].type, "html");
    assert.equal(parsed.nodes[0].version, 1);
    assert.equal(parsed.nodes[0].html, "<p>x</p>");
    assert.equal(parsed.nodes[0].visibility.web.nonMember, true);
});

test("the html survives a round trip byte for byte", () => {
    assert.equal(snippetHtml(snippetLexical(html)), html);
});

test("snippetHtml returns null for anything that is not one html card", () => {
    assert.equal(snippetHtml("not json"), null);
    assert.equal(snippetHtml("{}"), null);
    assert.equal(snippetHtml(JSON.stringify({ nodes: [{ type: "paragraph" }] })), null);
    assert.equal(snippetHtml(JSON.stringify({ nodes: [{ type: "html", html: "a" }, { type: "html", html: "b" }] })), null);
});
