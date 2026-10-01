// On a harness post, read the facts block from the article and show a summary strip
// above it. Progressive enhancement: without JavaScript the strip stays hidden and the
// full table is still in the article.

import { FIELD_BY_KEY, parseFactsRoot } from "harness-facts";
import { el, valueNode } from "harness-ui";

const strip = document.querySelector("[data-facts-strip]");
const body = document.querySelector(".article-body");

if (strip && body) {
    const result = parseFactsRoot(body, location.href);
    if (result.status === "ready") {
        for (const key of ["harness", "plan", "web", "browser", "server"]) {
            const field = FIELD_BY_KEY[key];
            const item = el("div", "facts-strip-item");
            item.append(el("span", "facts-strip-label", field.short ?? field.label));
            const value = el("span", "facts-strip-value");
            value.append(valueNode(field, result.fields[key]));
            item.append(value);
            strip.append(item);
        }
        strip.hidden = false;
    }
}
