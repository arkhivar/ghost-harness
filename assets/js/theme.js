// Color scheme toggle. The initial scheme is resolved by an inline script in default.hbs.

const root = document.documentElement;
const toggle = document.querySelector("[data-theme-toggle]");

function describe() {
    if (!toggle) return;
    const next = root.getAttribute("data-theme") === "dark" ? "light" : "dark";
    toggle.setAttribute("aria-label", `Switch to the ${next} color scheme`);
}

toggle?.addEventListener("click", () => {
    const next = root.getAttribute("data-theme") === "dark" ? "light" : "dark";
    root.setAttribute("data-theme", next);
    try { localStorage.setItem("harness-scheme", next); } catch { /* storage can be blocked */ }
    describe();
});

describe();
