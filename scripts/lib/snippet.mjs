// Builds the request body Ghost's editor sends when you click "Save as snippet" on an HTML card.
// Captured from the Ghost 6.67 editor, so the Snippet created by script is identical to one made by hand.

export const SNIPPET_NAME = "Harness facts";

// Visible to everyone on the web and in email, same default the editor applies to a new card.
const DEFAULT_VISIBILITY = {
    web: { nonMember: true, memberSegment: "status:free,status:-free" },
    email: { memberSegment: "status:free,status:-free" },
};

export function snippetLexical(html) {
    return JSON.stringify({
        namespace: "KoenigEditor",
        nodes: [{ type: "html", version: 1, html, visibility: DEFAULT_VISIBILITY }],
    });
}

// `mobiledoc: "{}"` is what the editor sends alongside lexical. Ghost still wants the field.
export function snippetBody(name, html) {
    return { snippets: [{ name, mobiledoc: "{}", lexical: snippetLexical(html) }] };
}

// Reads the html back out of a snippet's lexical string, or null if it is not a single HTML card.
export function snippetHtml(lexical) {
    try {
        const nodes = JSON.parse(lexical)?.nodes;
        return Array.isArray(nodes) && nodes.length === 1 && nodes[0].type === "html" ? nodes[0].html : null;
    } catch {
        return null;
    }
}
