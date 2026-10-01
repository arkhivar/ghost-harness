// Small DOM helpers shared by the matrix and the per-post summary strip.
// Everything is built with createElement and textContent. Post content is never
// inserted as HTML.

import { scaleLabel } from "harness-facts";

export function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
}

export function link(href, text, className) {
    const node = el("a", className, text);
    node.href = href;
    return node;
}

export function dots(value, max, label, extraClass = "") {
    const node = el("span", `dots ${extraClass}`.trim());
    node.setAttribute("role", "img");
    node.setAttribute("aria-label", `${label}: ${value} of ${max}`);
    for (let index = 1; index <= max; index += 1) node.append(el("i", index <= value ? "on" : ""));
    return node;
}

export function meter(value, max) {
    const node = el("span", "meter");
    const bar = el("span", "meter-bar");
    const fill = document.createElement("b");
    fill.style.width = `${Math.max(0, Math.min(100, (value / max) * 100))}%`;
    bar.append(fill);
    bar.setAttribute("role", "img");
    bar.setAttribute("aria-label", `${value} out of ${max}`);
    node.append(bar, document.createTextNode(Number.isInteger(value) ? `${value}.0` : String(value)));
    return node;
}

export function yesNo(value) {
    if (value === true) return el("span", "yn yes", "Yes");
    if (value === false) return el("span", "yn no", "No");
    return el("span", "yn unknown", "Unknown");
}

// One value, rendered by kind. `fact` is a normalised field result from facts.js.
export function valueNode(field, fact) {
    if (!fact || fact.v === null || fact.v === undefined) return el("span", "yn unknown", "Unknown");
    switch (field.kind) {
        case "tri":
            return yesNo(fact.v);
        case "score":
            return meter(fact.v, field.max);
        case "level": {
            const wrap = el("span", "cell-level");
            wrap.append(dots(fact.v, field.max, field.label, field.key === "web" ? "blue" : ""));
            wrap.append(el("span", "label", fact.text && fact.text !== "Unknown" ? fact.text : scaleLabel(field.scale, fact.v) ?? String(fact.v)));
            return wrap;
        }
        case "list":
            return el("span", "value", fact.v.join(", "));
        default:
            return el("span", "value", fact.text);
    }
}

export function sourceList(sources) {
    if (!sources?.length) return null;
    const list = el("ul");
    for (const source of sources) {
        const item = el("li");
        const anchor = link(source.href, `${source.label} ↗`);
        anchor.target = "_blank";
        anchor.rel = "noopener";
        item.append(anchor);
        list.append(item);
    }
    return list;
}
