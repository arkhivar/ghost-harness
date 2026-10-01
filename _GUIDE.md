# Guide: the Snippet workaround and the other tricks

Ghost has no custom fields for posts. This project needs structured data per harness (plan mode level, web UI level, browser use, and so on) so the homepage can sort, filter and compare. The workaround is to keep that data inside the post itself, as one small HTML block, and let the theme read it.

This guide explains how that works, how to use it day to day, and every trick the theme relies on. Everything here was tested on Ghost 6.67.0 unless stated otherwise.

## The idea in one minute

1. A harness is a normal Ghost post, tagged with the internal tag `#harness`.
2. Somewhere in the post is a facts block: one HTML card holding a table with one row per fact.
3. The homepage asks Ghost for all `#harness` posts, receives their HTML, parses each facts block in the browser, and renders the sortable matrix.
4. On a post page, the same block drives the summary strip at the top.
5. The Snippet is only a convenience. It puts a blank facts block into any new post with one slash command, so nobody pastes HTML by hand.

Because the data lives in the post, it is covered by Ghost's normal editor, revisions, backups and export. There is no second database and no separate admin.

Why not something else:

| Option | Why it was not used |
| --- | --- |
| Tags for each property | Fine for yes or no, awkward for 0 to 4 scales, and tag lists get noisy |
| Code injection per post | Easy to break, hidden from the editor, not part of the post body |
| A separate JSON file in the theme | Needs a theme upload for every fact change |
| Content API fetched from the browser | Needs an API key in the page and still needs structured data somewhere |

## One-time setup: create the Snippet

Do this once per Ghost site. There are two routes. Both produce the same Snippet: the scripted route reports a Snippet made by hand as "already up to date", because the stored contents are identical.

Why there are two: Ghost answers requests to the Snippets endpoint with 403 when they use a custom integration key, which is what the seed script, the lint script and the GitHub deploy use. A staff access token is allowed, because it authenticates as you. That is a more powerful credential, so the manual route stays the default.

### Route A: by hand, in the editor (default)

1. Open [`snippets/harness-facts.html`](snippets/harness-facts.html) and copy the whole file.
2. In Ghost Admin, start a new post. It does not need to be saved or published.
3. On the first line of the body type `/html` and press Enter. An HTML card appears with a code editor.
4. Paste the file into the card.
5. Press Escape. The card is selected and a small toolbar appears above it with three icons: Edit, Visibility, and Save as snippet.
6. Click Save as snippet, type `Harness facts`, and press Enter. Ghost confirms with a toast: Snippet saved as "Harness facts".
7. Delete the scratch post.

### Route B: by script, with a staff access token (optional)

1. Open your own profile page in Ghost Admin and copy your staff access token. It looks like `id:secret`, the same shape as an Admin API key. Ghost's [Admin API docs](https://docs.ghost.org/admin-api) describe where it lives and what it can do.
2. Run:

```bash
export GHOST_URL=https://harness.example.com
export GHOST_STAFF_TOKEN=<id>:<secret>
npm run snippet:sync -- --dry-run   # says what it would do
npm run snippet:sync                # creates or updates the Snippet named "Harness facts"
```

The script is idempotent. It creates the Snippet if it does not exist, updates it if the stored HTML differs from `snippets/harness-facts.html`, and does nothing otherwise. Use `--name` for another Snippet name.

The token carries your full role permissions. Keep it in your shell only: do not commit it and do not put it in GitHub secrets. To revoke it, regenerate it on your profile page.

### Check it works

In any new post, type `/harness` on an empty line. A Snippets section appears with Harness facts. Press Enter and the full block, 16 rows, is inserted.

Inside the editor the card renders as a plain unstyled table. That is normal: the editor does not load the theme's CSS. The styled version appears on the site.

## Day to day: add or update a harness

Adding one:

1. New post. Title is the harness name. In the post settings, set the excerpt to a one-sentence summary. It becomes the subtitle and the row summary.
2. Write your review in the body if you like. Keep the facts block at the end.
3. On an empty line type `/harness` and press Enter.
4. Click into the card to edit the code. Change only the Value and Notes cells. Keep every `data-field`, every `data-v` and the three cells per row. The comment at the top of the block lists the scales.
5. Add the internal tag `#harness`. Type `#harness` in the Tags field. A tag whose name starts with `#` is internal.
6. Publish. Drafts do not appear on the homepage, because Ghost only returns published posts to the theme.

Updating one: edit the card, set the `checked` row to today's date, update the post. Then run the lint (below).

A post with no block, or a broken one, still appears in the matrix, flagged "Facts not added yet" or "Facts need fixing". Nothing disappears silently.

The rules for each row, and every accepted value, are in [_SCHEMA.md](_SCHEMA.md).

## The Snippet gotchas

Snippets insert copies. Ghost stores the inserted card as a plain HTML card containing the whole block. Nothing in the saved post refers back to the Snippet (checked in the stored post: no mention of it anywhere). Consequences:

- Editing the Snippet later does not change posts that already used it.
- If you change the schema, old posts keep the old block until you edit them.
- That drift is real, so the repository ships a lint: `npm run lint:facts` reads every `#harness` post through the Admin API and reports posts that are missing the block, have a malformed one, or lack a row. Run it after any schema change and now and then.

To replace the Snippet with a new version, run `npm run snippet:sync` (route B above). In the editor, Ghost's [help page](https://ghost.org/help/snippets/) says to start typing the Snippet's name and pick it under Replace existing.

Snippets are shared by all staff users on the site. They are not part of the theme and not in Ghost's content export, so keep `snippets/harness-facts.html` in this repository as the master copy.

## The tricks, in order of importance

### 1. Internal tag as a hidden type marker

Posts are marked with `#harness`, whose slug is `hash-harness`. Internal tags are invisible to readers: there is no public tag page (`/tag/hash-harness/` returns 404), no tag links on posts, and the tag is absent from the tag sitemap and from feed categories. The theme still sees it:

- `{{#get "posts" filter="tag:hash-harness"}}` selects harness posts.
- `{{#has tag="#harness"}}` shows the back link on a post page.
- The post page `<body>` gets the class `tag-hash-harness`, which the CSS and scripts can target.

Regular blog posts, without the tag, stay out of the matrix and appear under Latest notes.

### 2. Reading every post's HTML in one server-side query

`home.hbs` runs one `{{#get}}` and prints each post's `{{content}}` into an inert `<template>` element. The browser never renders or executes what is inside a template, so images do not load and scripts do not run, yet `matrix.js` can read the HTML and parse the facts block from it.

Two caveats worth knowing:

- Ghost's documentation does not describe `{{content}}` inside `{{#get}}` loops. It works on 6.67.0, which is why it was tested rather than assumed. If a future Ghost version changes that, `npm test` will not catch it, but the homepage will show the empty-state message. Check the homepage after every Ghost major upgrade.
- `{{#get}}` returns at most 100 posts per query (Ghost's [get helper docs](https://docs.ghost.org/themes/helpers/functional/get) state the limit). It does support a `page` attribute, so past 100 harnesses you can add a second `{{#get ... page="2"}}` block, or split the directory into categories by tag.

### 3. Import map so cached modules never go stale

Ghost serves theme files under `/assets/` with a one-year cache lifetime in production. Normally `{{asset}}` appends `?v=<hash>` so a changed file gets a new URL. That does not help modules that import other modules: `import "./facts.js"` inside a cached `matrix.js` resolves to `/assets/js/facts.js` with no hash, and the browser keeps serving the year-old copy.

The fix is in `default.hbs`: an import map maps bare names to hashed URLs.

```html
<script type="importmap">
{"imports":{"harness-facts":"{{asset "js/facts.js"}}","harness-ui":"{{asset "js/ui.js"}}"}}
</script>
```

`matrix.js` and `post-facts.js` write `import ... from "harness-facts"`. When `facts.js` changes, its hash changes, the map changes, and unchanged files stay cached. Tested with Ghost's production cache lifetime of one year: after changing only `facts.js` and redeploying, the import map pointed at a new hashed URL, and a normal reload loaded the new code through an unchanged, still-cached `matrix.js`.

Rule for contributors: never import a theme module by relative path. Use the bare names.

### 4. One schema module used everywhere

`assets/js/facts.js` defines fields, scales and parsing. It has no imports and no top-level DOM access, so the same file runs:

- in the browser, through the import map;
- in Node, for the tests, the seed script, the lint script and the pack script;
- as the generator for the Snippet, via `npm run snippet`.

CI runs `npm run snippet:check` and fails if the committed Snippet file is out of date. That keeps the schema, the Snippet and the parser from drifting apart.

### 5. Creating posts through the Admin API with HTML

`npm run seed` creates posts from `seed/harnesses.json`. It posts HTML to the Admin API with `?source=html`, and wraps the facts block in `<!--kg-card-begin: html-->` and `<!--kg-card-end: html-->`. Ghost converts that into a real HTML card, so seeded posts look exactly like posts made with the Snippet. The lint confirms this: posts created either way pass the same checks.

The script signs its own short-lived Admin API token (HS256) with Node's built-in crypto module, so it needs no dependencies. Seeding is safe to re-run: existing slugs are skipped unless you pass `--update`.

```bash
export GHOST_URL=https://harness.example.com
export GHOST_ADMIN_API_KEY=<id>:<secret>
npm run seed -- --dry-run     # see what would happen
npm run seed                  # create posts
npm run seed -- --status draft
npm run seed -- --update      # overwrite posts with the seed content
```

The seed data is a starting point. Facts carry a `checked` date and sources, but re-verify anything you depend on.

### 6. Filters and picks live in the URL

The search text, sort order, "must have" filters and compare selection are stored in the address bar, for example `/?need=web,plan&sort=browser&compare=kimi-code-cli,opencode`, so a filtered view is a shareable link. Compare picks are also remembered in the browser's local storage. Unknown values never pass a filter.

### 7. Readable without JavaScript

The server-rendered list inside `home.hbs` is a plain ordered list of harnesses with links and excerpts. With JavaScript off, visitors see that list and a short note instead of the matrix. Search engines and other bots get real content too.

### 8. Optional pretty URLs

[`config/routes.yaml`](config/routes.yaml) moves harness posts to `/harness/<slug>/` and leaves other posts at `/<slug>/`. Upload it in Ghost Admin under Settings, then Advanced, then Labs. Ghost's routing docs name Labs as the place to upload and download it. Tested: the matrix links switch to the new URLs, and old `/<slug>/` URLs answer with a 301 redirect to the new ones, so links already out in the world keep working. The theme works fine without the file.

### 9. Comments are Ghost's own

The post template calls `{{comments}}`. Ghost's native comments need members and working outgoing email, because commenters must be signed-in members. Enable them under Settings, Membership, Access, then Edit, and choose All members or Paid-members only. Without SMTP configured, sign-in emails never arrive and comments are unusable. See [_DEPLOYMENT.md](_DEPLOYMENT.md).

### 10. Strict, auditable scales

Every level scale has a written definition (see [_SCHEMA.md](_SCHEMA.md)), and the visible label in the cell is a short human version of it. For example, browser use level 3 means first-party and documented for headless or remote hosts, which is the level that matters if you want an agent driving a browser on a server you reach remotely. Desktop-only browser extensions score 2. Just fetching a page scores 0.

## Known limits

- Maximum 100 harness posts without extra work (see trick 2).
- The Snippet is created once per site, by hand or with `npm run snippet:sync`, and does not travel with the theme.
- Posts must be published to count.
- The Harness-y score is an editorial opinion. Keep the reasoning in the Notes cell.
- Editing raw HTML in a card is not pretty. If your editors dislike it, a future improvement is a small script that builds the block from a form and posts it through the Admin API.

## Troubleshooting

| Symptom | Likely cause and fix |
| --- | --- |
| Homepage says the matrix is empty | No published post carries the `#harness` tag. Drafts do not count |
| A row shows "Facts not added yet" | The post has no facts block. Insert the Snippet |
| A row shows "Facts need fixing" | The block is malformed. Run `npm run lint:facts` for the reason |
| `/harness` finds nothing in the editor | The Snippet was not saved on this site, or its name does not contain what you typed |
| `npm run snippet:sync` says 403 | You used the custom integration key. Use your staff access token in `GHOST_STAFF_TOKEN` |
| Seed or lint cannot authenticate | `GHOST_URL` must be the site's public URL (https, no path) and the key must be the full `id:secret` pair from the custom integration |
| The browser keeps old behaviour after a theme upload | A module was imported by relative path and is cached for a year. Use the bare names (trick 3), then reload once |
| Matrix is blank, console shows a module error | A theme module was imported by relative path. Use the bare names (trick 3) |
