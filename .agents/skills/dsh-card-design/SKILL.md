---
name: dsh-card-design
description: Extend and preserve this card's visual language — the `--dbc-*` token layer, the one-row-per-fact layout, its type and spacing scale, the period and holiday chips, and the hover bubbles. Use when redesigning or restyling the card, adding a row or a state, editing `CARD_CSS`, reviewing a screenshot, or building a banner or README asset for it.
whenToUse: Use when a task changes what the card looks like or what a bubble says — new rows, chips, states or notices, token or theme changes, narrow-sidebar or translated-copy problems, tooltip structure or copy, or a visual review before a commit. Also when producing README screenshots or banners, which must show states the card can actually reach.
---

# Card design

The card is rendered at roughly **200–260 px wide** inside the DSH sidebar footer, in two themes and
two languages, and it is read in glances. Every decision here comes from that: one fact per row,
values from a fixed scale, and nothing that needs a screenshot to explain itself.

The *values* live in `AGENTS.md` → **Design scale** and **Hover text**. This skill is about how to
decide when you add to them: what must not move, what to reach for, and how to prove the result.

## When to use

- A row, chip, notice, icon or bubble has to be added, moved, or reworded.
- A colour, size, radius or theme value is being changed, or a new token is introduced.
- The card looks wrong at a narrow sidebar width, or in one language only.
- Someone asks for a redesign, "make it more modern", or a visual review of a diff.
- A README screenshot, banner or icon is being produced for this plugin.

Load `dsh-plugin-development` as well when the change also touches the Host half, the route payload,
or the plugin manifest — this skill only governs the visual layer.

## Preconditions

1. Read `AGENTS.md` — invariants (`AGENTS.md:11`), **Hover text** (`AGENTS.md:51`), **Layout and
   compatibility guards** (`AGENTS.md:120`), **Design scale** (`AGENTS.md:155`).
2. Read the code you are about to change: the token block on `.dbc-root` (`client.js:599-607`), the
   card rules (`client.js:608-642`), the bubble rules (`client.js:645-655`), and the spec builders
   (`showAccount`, `showApi`, `periodTip`, `modelTip`, `makeupTip`).
3. Read `docs/design-skill-audit.md` for where each rule came from and what was rejected.
4. Know which half is live: `client.js` takes effect on a page refresh, `index.js` / `parse.js` need
   an app restart. Never claim a change is visible without saying which.

Do not start from the CSS and "improve" numbers. Start from what the row has to say.

## Three tiers of rule

**Fixed — changing these is a bug, not a style choice**

- **The token layer is the only palette.** `CARD_CSS` declares `--dbc-*` on `.dbc-root` with
  `light-dark(light, dark)`; the app writes `color-scheme` on `<html>`, so both themes resolve
  without reading a host variable. Never introduce `--dsw-alias-*` into the card, never a raw hex in
  a rule, never a colour picked in the devtools.
- **One row per fact, in this order**: countdown + chips → amount → provider → model → prices.
  The amount never shares a line with the countdown; that pairing is what clipped six-digit balances
  at 196 px. The card prints no balance word — the amount names itself and the word survives as the
  row's `aria-label`.
- **The countdown never truncates** and always carries its `距高峰` / `距空闲` wording in the period's
  colour. A bare clock next to the model reads as a duration.
- **State is never colour alone.** A chip carries its word plus a dot; the countdown carries its
  label. A new state ships with its word.
- **4.5:1 for every text pair, measured on the surface it lands on**, in both themes. The measured
  numbers are in `AGENTS.md:178`. A prettier hue is not a reason to go under.
- **Never ship a state the card cannot reach.** Peak + 调休 is impossible (every make-up workday is a
  weekend, and weekends are idle all day); a holiday countdown is never two hours. Screenshots, copy
  and fixtures follow the same rule.
- **Hover text explains, it does not advertise.** One trigger per row, on the label, never on the
  price block or the holiday strip, and the model row only when the provider bills at the list price
  (`billsAtListPrice`, `client.js:51`).

**Preferred — reach for these first**

- Move **one step on the scale**, never a half step. The closed sets are `11 / 13 / 17 / 20` for
  type (`AGENTS.md:163`), `4 / 5 / 6 / 8 / 10 / 12` for spacing and `6 / 8 / 10 / 14 / 999` for
  radius (`AGENTS.md:168-170`). If no step fits, the row is wrong, not the scale — a new value is a
  decision that has to be argued for and recorded, not a convenience.
- **Weight and colour carry hierarchy, size does not.** Money is `650`+, the model name and chips
  `500`, everything else `400`. De-emphasise with `--dbc-ink-3`, never with a smaller size.
- **Hairlines are 12 % ink** (`color-mix(in srgb,var(--dbc-ink-1) 12%,transparent)`). `--dbc-line`
  is for the card's own border; at 4 % it is invisible inside the card.
- **Tint the ground, darken the word.** A tinted chip or strip uses `color-mix(state, ink)` for its
  text rather than the raw state colour: raw green on its own tint measures 2.05:1 in light mode.
- **Truncate in this order**: the amount drops one size step past `AMOUNT_SMALL_AT`
  (`client.js:690`), the holiday name ellipsizes while its `M/D · 空闲全天` meta stays, the model
  ellipsizes last.
- **Test the longest translation, not the shortest.** `Cache read` had to become `Cached` to survive
  196 px; the same pressure applies to any new label. Prefer a shorter English word over a smaller
  font.
- **Notices replace the amount, they do not sit beside it**: `未配置 API Key` / `读取失败` occupy the
  amount row at 13 px in `--dbc-ink-3`. A notice is never dressed as a number.

**Open — decide case by case, then record the decision**

- Where a new fact goes: a new row, a second line inside an existing row, or a bubble. Default to a
  bubble — the card is five rows tall, and a sixth row costs a scroll in every other plugin's footer.
- Whether a state deserves a chip, a strip, or a word inside the bubble.
- Exact copy, as long as it fits at 196 px in both languages and names a fact rather than a feeling.

## Steps

### Before you change

1. **Reproduce the current state.** Render 232 px and 196 px, light and dark, zh and en (harness
   below). You cannot judge a change against memory.
2. **Classify the defect**, because the fix level differs: a missing token, a one-off value that
   should come from the scale, a conceptual mismatch (the row order is wrong), or a local defect (a
   rule that never painted). Fix at the narrowest level that removes the cause — do not add a token
   for one exception, and do not restructure a row to fix a colour.
3. **Decide the direction with the user before implementing** when the change is a redesign: render
   two or three concrete structures at real width in both languages, state what each costs, and take
   the answer. A redesign that lands without a chosen structure gets reverted.

### While you change

- Edit `CARD_CSS` and the render tree together, then look again. A rule that reads right in isolation
  can still wrap, clip or float once it is a row.
- Keep the hook count identical in every render path — `wide` is a prop, not a mount gate
  (`client.js:729`). A guard above a hook tears the subtree down and the card never comes back.
- When a value or rule moves, update `AGENTS.md` in the same change. The docs are the contract the
  next agent reads; a stale number there is a bug that outlives the fix.

## Verification

- [ ] `node --check client.js && npm test` — the suite asserts the `.dbc-*` names, the bubble child
      order, the tooltip text, and that every `var(--dbc-*)` the stylesheet reads is declared. Never
      lower the assertion count.
- [ ] Rendered and looked at: 232 px and 196 px, light and dark, zh and en, plus every state touched.
- [ ] Nothing wrapped, clipped, floated to its own line, or lost its hairline; the countdown is
      complete in every case; the longest English label still fits.
- [ ] Contrast unchanged, or re-measured for any colour touched, in both themes.
- [ ] `docs/screenshots/*` and `docs/banners/*` still show reachable states and live prices
      (`curl http://127.0.0.1:<port>/deepseek-billing-card/data`).
- [ ] `AGENTS.md` matches the code.
- [ ] The commit message says which half needs a refresh and which needs a restart.

## Failure handling

| Symptom | Cause | What to do |
| --- | --- | --- |
| A rule exists in the DOM but nothing paints | `var(--dbc-line-2)` — a token nobody declared | the suite now fails on an undeclared `--dbc-*`; keep that check |
| A hairline is "there" but invisible | `--dbc-line` is 4 % ink | 12 % ink mix for dividers |
| Chip text unreadable in light mode | raw state colour on its own tint (2.05:1) | `color-mix(state 50%, ink)` |
| The card disappears after collapsing the sidebar | `if (!wide) return null` placed above the hooks | the guard sits after every hook; hook count equal in both states |
| The bubble looks pasted on | the host Tooltip primitive's fixed dark plate | the card draws its own bubble; never reintroduce the primitive |
| A tooltip pointer points away from its word | arrow drawn on the far edge | the arrow sits on the edge facing the trigger, apex on its centre |
| A chip list wraps at 232 px | countdown + two chips exceed ~208 px | keep the countdown untruncated and let the row wrap; do not shrink the type |
| Screenshot prices are impossible | fixture typed by hand | take them from the live route; check tier, currency and model |

## Render harness

Recreate it under `/tmp`; never commit it.

```js
// 1. pull the real stylesheet out of client.js — never retype it
const src = fs.readFileSync('client.js', 'utf8');
const at = src.indexOf('const CARD_CSS = [');
const css = new Function(`return ${src.slice(at + 'const CARD_CSS = '.length, src.indexOf("].join('');", at) + 1)}.join('');`)();
// 2. wrap the markup in <span class="dbc-root"> so the --dbc-* tokens resolve, and set
//    `html{color-scheme:light|dark}` the way the app sets it on <html>
// 3. .dbc-tip is position:fixed and hidden until hovered — override it:
//    .dbc-tip{position:relative !important;left:auto !important;top:auto !important;
//             visibility:visible !important}
```

```bash
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --disable-gpu \
  --no-sandbox --disable-dev-shm-usage --hide-scrollbars --user-data-dir=/tmp/chrome-dbc \
  --no-first-run --force-device-scale-factor=2 --window-size=520,700 --screenshot=/tmp/x.png file:///tmp/x.html
```

Without `--no-sandbox` Chrome dies with SIGTRAP on this machine; without `--user-data-dir` it cannot
create a profile. Render at 2× and downsample with LANCZOS for anything that ships, so 1 px lines and
11 px text stay honest.

## Worked examples

**"Add a token-usage row."** Do not add a sixth row by default. Put it in the model bubble as one
`label → value` line, reuse 11 px + tabular numerals, and promote it to a row only if the user says it
is glance-critical. Verify at 196 px in English, where the label is longest.

**"The English UI truncates the price label."** Do not lower the font or widen the card. Shorten the
English word first (`Cached`), then check the other column widths; if it still truncates, the row is
carrying too much and one fact moves into the bubble.

**"Make the card look more modern."** That is a request for a direction, not a colour. Offer two or
three concrete structures as real renders at 232 px in both languages, say what each costs, let the
user choose, then implement only that one.

**"Add a dark-mode screenshot to the README."** Re-render from the shipped stylesheet with the live
prices, pick a reachable state, and keep one screenshot per language. Banners and screenshots are
design surfaces too — same rules, same check.

## Provenance

The method here comes from three third-party skills used during the 2026-10 redesign —
`refactoring-ui` (scales, hierarchy, contrast tiers), `ui-taste` (drift classification, verification
on rendered pixels), `banner-design` (asset workflow) — plus what this card learned the hard way.
`docs/design-skill-audit.md` records what was adopted, adapted, rejected, and what is still
unverified.

They are installed on demand and are **not** vendored here; install one before relying on its
wording:

```bash
npx skills add https://github.com/s0xdk/refactoring-ui-skill --skill refactoring-ui
npx skills add https://github.com/nextlevelbuilder/ui-ux-pro-max-skill --skill banner-design
npx skills add https://uizze.sh/
```
