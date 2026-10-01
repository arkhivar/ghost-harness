// The homepage comparison matrix.
//
// Data flow: home.hbs prints every harness post's HTML inside an inert <template>.
// This module reads each post's facts block (see facts.js and _SCHEMA.md), then renders
// a sortable, filterable table plus a side-by-side compare view.
// View state (search, sort, filters, compare selection) lives in the address bar,
// so a filtered view can be shared as a link.

import { FIELDS, FIELD_BY_KEY, SCALES, compareFacts, parseFactsRoot, sameFact } from "harness-facts";
import { dots, el, link, sourceList, valueNode, yesNo } from "harness-ui";

const rootEl = document.querySelector("[data-matrix-root]");
const listEl = document.querySelector("[data-harness-list]");

const COLUMNS = FIELDS.filter((field) => field.matrix);
const MAX_PICKS = 4;
const PICKS_KEY = "harness-compare";
const DEFAULT_SORT = { key: "harness", dir: -1 };

// "Must have" filters. Unknown values never pass a filter: unverified is not a yes.
const FILTERS = [
    { id: "web", label: "Self-hosted web UI", test: (f) => f.web.v >= 2 },
    { id: "plan", label: "Native plan mode", test: (f) => f.plan.v >= 3 },
    { id: "browser", label: "Browser use", test: (f) => f.browser.v >= 1 },
    { id: "browser-host", label: "Browser on a server", test: (f) => f.browser.v >= 3 },
    { id: "server", label: "Server or API", test: (f) => f.server.v === true },
    { id: "acp", label: "ACP", test: (f) => f.acp.v === true },
    { id: "selfhost", label: "Self-hostable", test: (f) => f.selfhost.v === true },
];
const FILTER_BY_ID = Object.fromEntries(FILTERS.map((filter) => [filter.id, filter]));

const defaultDir = (key) => (key === "name" ? 1 : -1);
const labelFor = (key) => (key === "name" ? "Harness" : FIELD_BY_KEY[key].short ?? FIELD_BY_KEY[key].label);

function emptyFields() {
    return Object.fromEntries(FIELDS.map((field) => [field.key, { key: field.key, v: null, text: "Unknown", note: "", sources: [], missing: true }]));
}

function readItems() {
    return [...listEl.querySelectorAll("[data-harness-source]")].map((node) => {
        const url = new URL(node.dataset.url, location.href).href;
        const template = node.querySelector("template[data-facts-source]");
        const parsed = template ? parseFactsRoot(template.content, url) : { status: "missing", message: "This post has no harness facts block.", warnings: [] };
        const fields = parsed.status === "ready" ? parsed.fields : emptyFields();
        const excerpt = node.querySelector(".harness-source-excerpt")?.textContent.trim() ?? "";
        const text = (key) => fields[key].v === null ? "" : [].concat(fields[key].v).join(" ");
        if (parsed.status !== "ready") console.warn(`[harness] ${node.dataset.title}: ${parsed.message}`);
        else if (parsed.warnings.length) console.warn(`[harness] ${node.dataset.title}:`, parsed.warnings);
        return {
            slug: node.dataset.slug,
            url: node.dataset.url,
            title: node.dataset.title,
            excerpt,
            parsed,
            fields,
            haystack: [node.dataset.title, excerpt, text("org"), text("type"), text("license"), text("byo"), text("interfaces")].join(" ").toLowerCase(),
        };
    });
}

function start() {
    const items = readItems();
    if (!items.length) return;
    const bySlug = new Map(items.map((item) => [item.slug, item]));
    const state = readState(bySlug);

    const ui = buildSkeleton();
    rootEl.replaceChildren(ui.controls, ui.tableWrap, ui.tray, ui.compare, ui.legend);
    listEl.setAttribute("data-enhanced", "");
    renderMeta(items);

    // Events ---------------------------------------------------------------------
    rootEl.addEventListener("click", (event) => {
        const target = event.target.closest("[data-act], [data-sort], [data-need]");
        if (!target) return;
        if (target.dataset.sort) {
            const key = target.dataset.sort;
            state.dir = state.sortKey === key ? -state.dir : defaultDir(key);
            state.sortKey = key;
        } else if (target.dataset.need) {
            toggle(state.need, target.dataset.need);
        } else {
            const act = target.dataset.act;
            if (act === "expand") toggle(state.open, target.dataset.slug);
            else if (act === "expand-all") {
                const visible = visibleItems(items, state);
                const allOpen = visible.every((item) => state.open.has(item.slug));
                for (const item of visible) allOpen ? state.open.delete(item.slug) : state.open.add(item.slug);
            } else if (act === "reset") {
                state.q = "";
                state.need.clear();
                state.sortKey = DEFAULT_SORT.key;
                state.dir = DEFAULT_SORT.dir;
            } else if (act === "unpick") state.picks = state.picks.filter((slug) => slug !== target.dataset.slug);
            else if (act === "clear-picks") { state.picks = []; state.compareOpen = false; }
            else if (act === "compare-open" && state.picks.length >= 2) state.compareOpen = true;
            else if (act === "compare-close") state.compareOpen = false;
        }
        render(true, target.dataset.act === "compare-open");
    });

    rootEl.addEventListener("change", (event) => {
        const target = event.target;
        if (target.matches("input[data-pick]")) {
            const slug = target.dataset.pick;
            if (target.checked && state.picks.length < MAX_PICKS && !state.picks.includes(slug)) state.picks.push(slug);
            if (!target.checked) state.picks = state.picks.filter((entry) => entry !== slug);
            if (state.picks.length < 2) state.compareOpen = false;
            render(true);
        } else if (target.matches("input[data-diff-only]")) {
            state.diffOnly = target.checked;
            render(true);
        }
    });

    ui.search.addEventListener("input", () => {
        state.q = ui.search.value;
        render(true);
    });

    // Rendering -------------------------------------------------------------------
    function render(persist = false, focusCompare = false) {
        const focusId = document.activeElement?.closest?.("[data-focus-id]")?.dataset.focusId;
        const visible = visibleItems(items, state);

        renderControls(ui, state, items.length, visible.length);
        renderSortHeaders(ui, state);
        renderRows(ui, visible, state);
        renderTray(ui, state, bySlug);
        renderCompare(ui, state, bySlug);
        if (persist) persistState(state);

        if (focusCompare && !ui.compare.hidden) {
            ui.compare.querySelector("h3").focus({ preventScroll: true });
            ui.compare.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
        } else if (focusId) {
            [...rootEl.querySelectorAll("[data-focus-id]")].find((node) => node.dataset.focusId === focusId)?.focus({ preventScroll: true });
        }
    }

    ui.search.value = state.q;
    render();
}

function toggle(set, value) {
    if (set.has(value)) set.delete(value);
    else set.add(value);
}

// State and URL -------------------------------------------------------------------

function readState(bySlug) {
    const params = new URLSearchParams(location.search);
    const state = { q: params.get("q") ?? "", sortKey: DEFAULT_SORT.key, dir: DEFAULT_SORT.dir, need: new Set(), open: new Set(), picks: [], compareOpen: false, diffOnly: false };

    const [sortKey, sortDir] = (params.get("sort") ?? "").split(":");
    if (sortKey === "name" || COLUMNS.some((field) => field.key === sortKey)) {
        state.sortKey = sortKey;
        state.dir = sortDir === "asc" ? 1 : sortDir === "desc" ? -1 : defaultDir(sortKey);
    }
    for (const id of (params.get("need") ?? "").split(",")) if (FILTER_BY_ID[id]) state.need.add(id);

    const fromUrl = (params.get("compare") ?? "").split(",").filter((slug) => bySlug.has(slug));
    if (fromUrl.length) {
        state.picks = [...new Set(fromUrl)].slice(0, MAX_PICKS);
        state.compareOpen = state.picks.length >= 2;
    } else {
        try { state.picks = JSON.parse(localStorage.getItem(PICKS_KEY) ?? "[]").filter((slug) => bySlug.has(slug)).slice(0, MAX_PICKS); } catch { /* ignore */ }
    }
    state.diffOnly = params.get("diff") === "1";
    return state;
}

function persistState(state) {
    try { localStorage.setItem(PICKS_KEY, JSON.stringify(state.picks)); } catch { /* storage can be blocked */ }
    const parts = [];
    if (state.q.trim()) parts.push(`q=${encodeURIComponent(state.q.trim())}`);
    if (state.need.size) parts.push(`need=${[...state.need].join(",")}`);
    if (state.sortKey !== DEFAULT_SORT.key || state.dir !== DEFAULT_SORT.dir) {
        parts.push(`sort=${state.sortKey}${state.dir === defaultDir(state.sortKey) ? "" : state.dir === 1 ? ":asc" : ":desc"}`);
    }
    if (state.compareOpen && state.picks.length >= 2) {
        parts.push(`compare=${state.picks.join(",")}`);
        if (state.diffOnly) parts.push("diff=1");
    }
    try { history.replaceState(null, "", `${location.pathname}${parts.length ? `?${parts.join("&")}` : ""}${location.hash}`); } catch { /* sandboxed frames */ }
}

function visibleItems(items, state) {
    const query = state.q.trim().toLowerCase();
    const dir = state.dir;
    const field = state.sortKey === "name" ? null : FIELD_BY_KEY[state.sortKey];
    return items
        .filter((item) => (!query || item.haystack.includes(query)) && [...state.need].every((id) => FILTER_BY_ID[id].test(item.fields)))
        .sort((a, b) => {
            if (!field) return a.title.localeCompare(b.title) * dir;
            return (
                compareFacts(field, a.fields[field.key], b.fields[field.key], dir) ||
                compareFacts(FIELD_BY_KEY.harness, a.fields.harness, b.fields.harness, -1) ||
                a.title.localeCompare(b.title)
            );
        });
}

// Skeleton ---------------------------------------------------------------------------

function buildSkeleton() {
    const controls = el("div", "controls");

    const findRow = el("div", "controls-row");
    const search = el("input", "search");
    search.type = "search";
    search.placeholder = "Filter by name or maker…";
    search.setAttribute("aria-label", "Filter harnesses");
    search.setAttribute("data-focus-id", "search");
    findRow.append(search);

    const needRow = el("div", "controls-row");
    needRow.setAttribute("role", "group");
    needRow.setAttribute("aria-label", "Must have");
    needRow.append(el("span", "controls-label", "Must have"));
    for (const filter of FILTERS) {
        const chip = el("button", "chip", filter.label);
        chip.type = "button";
        chip.dataset.need = filter.id;
        chip.setAttribute("aria-pressed", "false");
        chip.setAttribute("data-focus-id", `need:${filter.id}`);
        needRow.append(chip);
    }
    const expandAll = el("button", "chip chip-quiet", "Expand all");
    expandAll.type = "button";
    expandAll.dataset.act = "expand-all";
    expandAll.setAttribute("data-focus-id", "expand-all");
    const reset = el("button", "chip chip-quiet", "Reset");
    reset.type = "button";
    reset.dataset.act = "reset";
    reset.setAttribute("data-focus-id", "reset");
    needRow.append(expandAll, reset);

    const status = el("p", "status");
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");
    findRow.append(status);
    const hint = el("p", "hint", "Tick up to four harnesses to compare them side by side.");
    controls.append(findRow, needRow, hint);

    // Table
    const tableWrap = el("div", "table-scroll");
    const table = el("table", "matrix-table");
    table.append(el("caption", "sr-only", "Harness comparison. Sort with the column headers."));
    const head = el("thead");
    const headRow = el("tr");
    const nameHead = el("th", "col-name");
    nameHead.scope = "col";
    headRow.append(nameHead);
    for (const field of COLUMNS) headRow.append(el("th"));
    head.append(headRow);
    const body = el("tbody");
    table.append(head, body);
    tableWrap.append(table);

    // Header buttons are created once so focus survives re-sorting.
    const sortables = [{ key: "name", label: "Harness", th: nameHead }, ...COLUMNS.map((field, index) => ({ key: field.key, label: labelFor(field.key), th: headRow.children[index + 1] }))];
    for (const { key, label, th } of sortables) {
        th.scope = "col";
        const button = el("button", "sort-btn");
        button.type = "button";
        button.dataset.sort = key;
        button.setAttribute("data-focus-id", `sort:${key}`);
        button.append(document.createTextNode(label), el("span", "arrow"));
        th.append(button);
        th.dataset.key = key;
    }

    const tray = el("div", "tray");
    tray.hidden = true;
    const compare = el("section", "compare");
    compare.hidden = true;

    return { controls, search, status, tableWrap, body, head, tray, compare, legend: buildLegend() };
}

function renderMeta(items) {
    const meta = document.querySelector("[data-matrix-meta]");
    if (!meta) return;
    const dates = items.map((item) => item.fields.checked.v).filter((value) => /^\d{4}-\d{2}-\d{2}$/.test(value ?? ""));
    const latest = dates.sort().at(-1);
    meta.textContent = `${items.length} harness${items.length === 1 ? "" : "es"}${latest ? ` · last verified ${latest}` : ""}`;
}

function buildLegend() {
    const legend = el("section", "legend");
    legend.setAttribute("aria-label", "How to read the matrix");
    for (const key of ["plan", "web", "browser"]) {
        const field = FIELD_BY_KEY[key];
        const card = el("div", "legend-card");
        card.append(el("h3", "", field.label));
        const list = el("ol");
        SCALES[field.scale].forEach((label, value) => {
            const item = el("li");
            item.append(dots(value, field.max, field.label, key === "web" ? "blue" : ""), el("span", "", label));
            list.append(item);
        });
        card.append(list);
        legend.append(card);
    }
    const score = el("div", "legend-card");
    score.append(el("h3", "", "Harness-y score"));
    score.append(el("p", "", "An editorial score from 0 to 10: how much of the product is orchestration around swappable models or agents (tools, memory, routing, permissions, interface) rather than a closed end-user product. Meta-harnesses that drive other agents score highest."));
    score.append(el("p", "share-note", "Unknown means not verified, and it never counts as a yes. Search, sort, filters and the compare selection are kept in the address bar, so you can share a view."));
    legend.append(score);
    return legend;
}

// Renderers ------------------------------------------------------------------------------

function renderControls(ui, state, total, shown) {
    for (const chip of ui.controls.querySelectorAll("[data-need]")) chip.setAttribute("aria-pressed", String(state.need.has(chip.dataset.need)));
    const arrow = state.dir === -1 ? "↓" : "↑";
    ui.status.textContent = `Showing ${shown} of ${total} · sorted by ${labelFor(state.sortKey)} ${arrow}`;
}

function renderSortHeaders(ui, state) {
    for (const th of ui.head.querySelectorAll("th[data-key]")) {
        const active = th.dataset.key === state.sortKey;
        th.setAttribute("aria-sort", active ? (state.dir === -1 ? "descending" : "ascending") : "none");
        th.querySelector(".arrow").textContent = active ? (state.dir === -1 ? "↓" : "↑") : "";
    }
}

const CHEVRON = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg>';

function renderRows(ui, visible, state) {
    if (!visible.length) {
        const row = el("tr");
        const cell = el("td");
        cell.colSpan = COLUMNS.length + 1;
        const empty = el("div", "no-results");
        empty.append(el("strong", "", "No harness matches every filter"));
        empty.append(el("span", "", "Try removing a must-have or clearing the search."));
        const reset = el("button", "chip", "Reset filters");
        reset.type = "button";
        reset.dataset.act = "reset";
        reset.setAttribute("data-focus-id", "reset-empty");
        empty.append(el("br"), reset);
        cell.append(empty);
        row.append(cell);
        ui.body.replaceChildren(row);
        return;
    }

    const rows = [];
    for (const item of visible) {
        const open = state.open.has(item.slug);
        const row = el("tr", `row-main${open ? " is-open" : ""}`);
        row.dataset.slug = item.slug;

        const nameCell = el("td", "col-name");
        const wrap = el("div", "name-cell");

        const expand = el("button", "expand-btn");
        expand.type = "button";
        expand.innerHTML = CHEVRON;
        expand.dataset.act = "expand";
        expand.dataset.slug = item.slug;
        expand.setAttribute("aria-expanded", String(open));
        expand.setAttribute("aria-controls", `detail-${item.slug}`);
        expand.setAttribute("aria-label", `${open ? "Hide" : "Show"} details for ${item.title}`);
        expand.setAttribute("data-focus-id", `expand:${item.slug}`);

        const pick = el("input", "pick");
        pick.type = "checkbox";
        pick.dataset.pick = item.slug;
        pick.checked = state.picks.includes(item.slug);
        pick.disabled = !pick.checked && state.picks.length >= MAX_PICKS;
        pick.setAttribute("aria-label", `Select ${item.title} for comparison`);
        pick.setAttribute("data-focus-id", `pick:${item.slug}`);

        const text = el("div", "name-text");
        text.append(link(item.url, item.title, "name-link"));
        const meta = [item.fields.org.v, item.fields.type.v].filter(Boolean).join(" · ");
        if (meta) text.append(el("div", "name-meta", meta));
        if (item.excerpt) text.append(el("p", "name-excerpt", item.excerpt));
        if (item.parsed.status !== "ready") text.append(el("span", "cell-flag", item.parsed.status === "missing" ? "Facts not added yet" : "Facts need fixing"));

        wrap.append(expand, pick, text);
        nameCell.append(wrap);
        row.append(nameCell);

        for (const field of COLUMNS) {
            const cell = el("td");
            cell.append(valueNode(field, item.fields[field.key]));
            row.append(cell);
        }
        rows.push(row);
        if (open) rows.push(buildDetail(item));
    }
    ui.body.replaceChildren(...rows);
}

function card(title, headline, note, sources) {
    const node = el("div", "detail-card");
    node.append(el("h4", "", title));
    if (headline) {
        const line = el("div", "headline");
        line.append(headline);
        node.append(line);
    }
    if (note) node.append(el("p", "", note));
    else if (!headline) node.append(el("p", "none", "No notes yet."));
    const list = sourceList(sources);
    if (list) node.append(list);
    return node;
}

function buildDetail(item) {
    const row = el("tr", "row-detail");
    row.id = `detail-${item.slug}`;
    const cell = el("td");
    cell.colSpan = COLUMNS.length + 1;
    const grid = el("div", "detail-grid");
    const f = item.fields;

    if (item.parsed.status !== "ready") {
        grid.append(el("p", "detail-warn", item.parsed.message));
    } else {
        for (const key of ["plan", "web", "browser"]) {
            grid.append(card(FIELD_BY_KEY[key].label, valueNode(FIELD_BY_KEY[key], f[key]), f[key].note, f[key].sources));
        }
        const server = el("span", "pair");
        server.append(el("span", "label", "Server"), yesNo(f.server.v), el("span", "label", "Headless"), yesNo(f.headless.v));
        grid.append(card("Server and headless", server, f.server.note, f.server.sources));
        grid.append(card("Approvals and autonomy", f.approvals.v ? el("span", "", f.approvals.text) : null, f.approvals.note, f.approvals.sources));

        const models = el("div", "detail-card");
        models.append(el("h4", "", "Models and license"));
        models.append(el("p", "", f.byo.v ? `Models: ${f.byo.text}` : "Models: unknown"));
        models.append(el("p", "", f.license.v ? `License: ${f.license.text}` : "License: unknown"));
        if (f.interfaces.v) {
            const tags = el("ul", "tags");
            for (const name of f.interfaces.v) tags.append(el("li", "", name));
            models.append(tags);
        }
        grid.append(models);

        const verified = card("Last verified", f.checked.v ? el("span", "", f.checked.text) : null, f.checked.note, f.checked.sources);
        grid.append(verified);
    }

    const actions = el("div", "detail-actions");
    actions.append(link(item.url, "Read the full write-up and discussion →", "text-link"));
    cell.append(grid, actions);
    row.append(cell);
    return row;
}

function renderTray(ui, state, bySlug) {
    const picks = state.picks.map((slug) => bySlug.get(slug)).filter(Boolean);
    ui.tray.hidden = !picks.length;
    if (!picks.length) return;

    const title = el("span", "tray-title", `Compare ${picks.length} / ${MAX_PICKS}`);
    const chips = el("div", "tray-chips");
    for (const item of picks) {
        const chip = el("span", "tray-chip", item.title);
        const remove = el("button", "", "×");
        remove.type = "button";
        remove.dataset.act = "unpick";
        remove.dataset.slug = item.slug;
        remove.setAttribute("aria-label", `Remove ${item.title} from the comparison`);
        remove.setAttribute("data-focus-id", `unpick:${item.slug}`);
        chip.append(remove);
        chips.append(chip);
    }
    const open = el("button", "btn-primary", picks.length < 2 ? "Pick one more" : "Compare →");
    open.type = "button";
    open.disabled = picks.length < 2;
    open.dataset.act = "compare-open";
    open.setAttribute("data-focus-id", "compare-open");
    const clear = el("button", "chip chip-quiet", "Clear");
    clear.type = "button";
    clear.dataset.act = "clear-picks";
    clear.setAttribute("data-focus-id", "clear-picks");
    ui.tray.replaceChildren(title, chips, clear, open);
}

function renderCompare(ui, state, bySlug) {
    const chosen = state.picks.map((slug) => bySlug.get(slug)).filter(Boolean);
    const show = state.compareOpen && chosen.length >= 2;
    ui.compare.hidden = !show;
    if (!show) return;

    const head = el("div", "compare-head");
    const heading = el("h3", "", `Comparing ${chosen.length} harnesses`);
    heading.tabIndex = -1;
    const diffLabel = el("label", "small muted");
    const diff = el("input");
    diff.type = "checkbox";
    diff.checked = state.diffOnly;
    diff.dataset.diffOnly = "";
    diff.setAttribute("data-focus-id", "diff-only");
    diffLabel.append(diff, document.createTextNode(" Differences only"));
    const close = el("button", "chip", "Close");
    close.type = "button";
    close.dataset.act = "compare-close";
    close.setAttribute("data-focus-id", "compare-close");
    head.append(heading, diffLabel, close);

    const table = el("table", "compare-table");
    table.append(el("caption", "sr-only", "Side-by-side comparison of the selected harnesses"));
    const thead = el("thead");
    const headRow = el("tr");
    const corner = el("th");
    corner.scope = "col";
    corner.append(el("span", "sr-only", "Property"));
    headRow.append(corner);
    for (const item of chosen) {
        const th = el("th");
        th.scope = "col";
        th.append(link(item.url, item.title, "name-link"));
        const remove = el("button", "remove", "Remove");
        remove.type = "button";
        remove.dataset.act = "unpick";
        remove.dataset.slug = item.slug;
        remove.setAttribute("aria-label", `Remove ${item.title} from the comparison`);
        remove.setAttribute("data-focus-id", `compare-unpick:${item.slug}`);
        th.append(remove);
        headRow.append(th);
    }
    thead.append(headRow);

    const tbody = el("tbody");
    let shown = 0;
    for (const field of FIELDS) {
        const differs = chosen.some((item) => !sameFact(field, chosen[0].fields[field.key], item.fields[field.key]));
        if (state.diffOnly && !differs) continue;
        shown += 1;
        const row = el("tr", differs ? "differs" : "");
        const label = el("th", "", field.label);
        label.scope = "row";
        row.append(label);
        for (const item of chosen) {
            const fact = item.fields[field.key];
            const cell = el("td");
            cell.append(valueNode(field, fact));
            if (fact.note || fact.sources.length) {
                const details = el("details");
                details.append(el("summary", "", "Notes and sources"));
                if (fact.note) details.append(el("p", "", fact.note));
                const list = sourceList(fact.sources);
                if (list) details.append(list);
                cell.append(details);
            }
            row.append(cell);
        }
        tbody.append(row);
    }
    table.append(thead, tbody);

    const scroll = el("div", "compare-scroll");
    scroll.append(table);
    ui.compare.replaceChildren(head, shown ? scroll : el("p", "compare-message", "These harnesses have identical values for every fact."));
}

// Start last: everything above is const/function and must be initialised first.
if (rootEl && listEl) start();
