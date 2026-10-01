// Minimal Ghost Admin API client. No dependencies: Node 22+ (fetch, FormData, crypto).
//
// Environment:
//   GHOST_URL            https://harness.example.com
//   GHOST_ADMIN_API_KEY  the Admin API Key of a Custom Integration, in "id:secret" form
//
// Auth follows https://docs.ghost.org/admin-api: a short-lived HS256 JWT signed with
// the hex-decoded secret, sent as "Authorization: Ghost <token>".

import { createHmac } from "node:crypto";

const base64url = (input) => Buffer.from(input).toString("base64url");

export function makeToken(adminKey, now = Math.floor(Date.now() / 1000)) {
    const [id, secret] = String(adminKey || "").split(":");
    if (!id || !secret || !/^[0-9a-f]+$/i.test(secret)) {
        throw new Error('GHOST_ADMIN_API_KEY must look like "<id>:<hex secret>" (Ghost Admin, Settings, Integrations).');
    }
    const header = base64url(JSON.stringify({ alg: "HS256", typ: "JWT", kid: id }));
    const payload = base64url(JSON.stringify({ iat: now, exp: now + 5 * 60, aud: "/admin/" }));
    const signature = createHmac("sha256", Buffer.from(secret, "hex")).update(`${header}.${payload}`).digest("base64url");
    return `${header}.${payload}.${signature}`;
}

export class GhostError extends Error {
    constructor(message, { status, errors } = {}) {
        super(message);
        this.name = "GhostError";
        this.status = status;
        this.errors = errors;
    }
}

export class GhostAdmin {
    constructor({ url = process.env.GHOST_URL, key = process.env.GHOST_ADMIN_API_KEY } = {}) {
        if (!url) throw new Error("GHOST_URL is not set (for example https://harness.example.com).");
        this.url = String(url).replace(/\/+$/, "");
        this.key = key;
    }

    async request(method, path, { query, body, form } = {}) {
        const url = new URL(`${this.url}/ghost/api/admin/${path.replace(/^\//, "")}`);
        for (const [name, value] of Object.entries(query ?? {})) if (value !== undefined) url.searchParams.set(name, value);
        const headers = { Authorization: `Ghost ${makeToken(this.key)}` };
        let payload;
        if (form) payload = form;
        else if (body !== undefined) {
            headers["Content-Type"] = "application/json";
            payload = JSON.stringify(body);
        }
        const response = await fetch(url, { method, headers, body: payload });
        const text = await response.text();
        let data = null;
        try { data = text ? JSON.parse(text) : null; } catch { /* non-JSON error page */ }
        if (!response.ok) {
            const detail = data?.errors?.map((error) => `${error.message}${error.context ? ` (${error.context})` : ""}`).join("; ");
            throw new GhostError(`${method} ${url.pathname} failed: ${response.status} ${detail || text.slice(0, 200)}`, { status: response.status, errors: data?.errors });
        }
        return data;
    }

    // Walks every page of a browse endpoint.
    async browseAll(resource, query = {}) {
        const items = [];
        for (let page = 1; ; page += 1) {
            const data = await this.request("GET", `${resource}/`, { query: { limit: "100", ...query, page: String(page) } });
            items.push(...data[resource]);
            if (!data.meta?.pagination?.next) return items;
        }
    }

    async postBySlug(slug, query = {}) {
        try {
            const data = await this.request("GET", `posts/slug/${encodeURIComponent(slug)}/`, { query });
            return data.posts[0];
        } catch (error) {
            if (error instanceof GhostError && error.status === 404) return null;
            throw error;
        }
    }

    createPost(post, { source = "html" } = {}) {
        return this.request("POST", "posts/", { query: { source }, body: { posts: [post] } }).then((data) => data.posts[0]);
    }

    updatePost(id, post, { source = "html" } = {}) {
        return this.request("PUT", `posts/${id}/`, { query: { source }, body: { posts: [post] } }).then((data) => data.posts[0]);
    }

    async uploadTheme(name, zipBuffer) {
        const form = new FormData();
        form.set("file", new Blob([zipBuffer], { type: "application/zip" }), `${name}.zip`);
        return this.request("POST", "themes/upload/", { form });
    }

    activateTheme(name) {
        return this.request("PUT", `themes/${encodeURIComponent(name)}/activate/`);
    }
}
