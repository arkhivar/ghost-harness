# Facts schema (version 1)

Every harness post carries one HTML block, the facts block. The homepage matrix, the summary strip on each post and the lint script all read this block and nothing else. This page is the contract.

The code is the source of truth: [`assets/js/facts.js`](assets/js/facts.js) defines the fields and scales, and the snippet in [`snippets/harness-facts.html`](snippets/harness-facts.html) is generated from it. If this page and the code ever disagree, the code wins and this page has a bug.

## Block structure

```html
<section data-harness-facts="1" aria-label="Harness facts">
  <h2>Facts at a glance</h2>
  <table>
    <thead>...</thead>
    <tbody>
      <tr data-field="plan">
        <th scope="row">Plan mode</th>
        <td data-v="3">Native toggle</td>
        <td>Shift+Tab switches Plan and Build. <a href="https://example.com/docs">Docs</a></td>
      </tr>
      <!-- one row per field -->
    </tbody>
  </table>
</section>
```

Rules the parser enforces:

| Rule | If you break it |
| --- | --- |
| Exactly one `<section data-harness-facts="1">` per post | The post shows "Facts need fixing" in the matrix |
| Exactly one `<table>` inside it | Same |
| Every `tbody` row has `data-field` set to a known key | Unknown keys are ignored with a warning |
| Every row has exactly three cells: a `th` label, a `td` value, a `td` notes cell | Same "need fixing" flag. `colspan` and `rowspan` are not allowed |
| A key appears at most once | Same "need fixing" flag |
| No block at all | The post shows "Facts not added yet" in the matrix |

Everything else is forgiving. A row you delete is treated as unknown and produces a warning in the lint output. Text outside the block is yours to write as you like.

Only `https:` and `http:` links in the cells are collected as sources. Links with other protocols, or with embedded credentials, are dropped.

## Values

The visible text of the value cell is for humans. The machine value lives in the `data-v` attribute. `data-v` always wins when both are present.

Unknown is a valid answer. Write `Unknown` in the cell, or set `data-v="unknown"`. Unknown values sort last and never match a filter.

| Kind | `data-v` accepts | Notes |
| --- | --- | --- |
| text | Not used. The cell text is the value | `Unknown` or an empty cell means unknown |
| score | A number from the field's min to max, decimals allowed | `9.5` |
| level | A whole number from 0 to the field's max | See the scales below |
| tri | `yes`, `no` or `unknown` | Also accepts `true`, `false`, `y`, `n`, `supported`, `not supported` |
| list | Not used. Comma-separated cell text | `TUI, Web, Desktop` becomes three items |
| date | Not used. Cell text in `YYYY-MM-DD` | Any other format produces a warning |

## Fields

| Key | Label | Kind | In the matrix |
| --- | --- | --- | --- |
| `type` | Type | text | no |
| `org` | Maker | text | no |
| `harness` | Harness-y score | score, 0 to 10 | yes |
| `plan` | Plan mode | level, 0 to 4 | yes |
| `web` | Self-hosted web UI | level, 0 to 3 | yes |
| `browser` | Browser use | level, 0 to 3 | yes |
| `server` | Server or API mode | tri | yes |
| `headless` | Headless or scripted use | tri | no |
| `acp` | Agent Client Protocol | tri | yes |
| `mcp` | Model Context Protocol | tri | yes |
| `selfhost` | Self-hostable | tri | yes |
| `license` | License | text | no |
| `byo` | Models and providers | text | no |
| `interfaces` | Interfaces | list | no |
| `approvals` | Approvals and autonomy | text | no |
| `checked` | Last verified | date | no |

## Scales

These definitions are deliberately strict so that a score means the same thing on every post. They live in `SCALES` in `facts.js`.

### Plan mode (`plan`)

| Value | Meaning |
| --- | --- |
| 0 | None |
| 1 | Inherited from a wrapped agent, prompt-only, or a workaround |
| 2 | One-shot command or chat mode |
| 3 | Native Plan/Build toggle |
| 4 | Native toggle with an approve-or-revise gate |

### Self-hosted web UI (`web`)

A web UI is what you get when you type the server's address into a browser and a full interface loads. A terminal UI does not count.

| Value | Meaning |
| --- | --- |
| 0 | None |
| 1 | Experimental, or a vendor-cloud web UI only |
| 2 | Native web UI you can self-host |
| 3 | Web-first, or built-in remote access |

### Browser use (`browser`)

| Value | Meaning |
| --- | --- |
| 0 | None. Just fetching a page does not count |
| 1 | Add-on you wire up yourself, such as an MCP server or a community plugin |
| 2 | First-party, but tied to a desktop app or desktop browser |
| 3 | First-party and documented for headless or remote hosts |

### Harness-y score (`harness`)

An editorial 0 to 10 score for how much the product is orchestration and tooling around swappable models or agents, rather than a model or a chat app. It is a judgment, not a measurement. Say why in the Notes cell.

## Matrix filters

The homepage "Must have" chips are defined by thresholds on these values. Unknown never passes a filter, because unverified is not a yes.

| Chip | Passes when |
| --- | --- |
| Self-hosted web UI | `web` is 2 or more |
| Native plan mode | `plan` is 3 or more |
| Browser use | `browser` is 1 or more |
| Browser on a server | `browser` is 3 |
| Server or API | `server` is yes |
| ACP | `acp` is yes |
| Self-hostable | `selfhost` is yes |

The filters, sort order and the compare selection (up to four harnesses) are stored in the page URL, so a filtered view can be shared as a link.

## Notes and sources

The third cell of each row holds the evidence: one or two sentences and links to the primary source (docs, changelog, release notes). Links are pulled out automatically and shown as source chips, so do not repeat the link text in the sentence.

Set the `checked` row to the date you last verified the facts. The matrix shows the newest date as "last verified".

## Changing the schema

Adding a field or changing a scale touches several places. In order:

1. Edit `FIELDS` or `SCALES` in `assets/js/facts.js`. If the change is not backwards compatible, bump `SCHEMA_VERSION` too.
2. Run `npm run snippet` to regenerate `snippets/harness-facts.html`.
3. Update the seed data in `seed/harnesses.json` if it should carry the new field.
4. Run `npm test` and `npm run snippet:check`.
5. Replace the Snippet in the Ghost editor. Snippets insert copies, so existing posts keep their old block until you edit them. See [_GUIDE.md](_GUIDE.md).
6. Run `npm run lint:facts` to list the posts that still need the new row.
