---
name: dsh-card-design
description: Extend and preserve this card's visual language — the `--dbc-*` token layer, the one-row-per-fact layout, the type and spacing scale, the period and holiday chips, the hover bubble, and the screenshots that document them.
whenToUse: A row, chip, notice, icon or bubble is added, moved or reworded; a colour, size, radius or token changes; the card breaks at a narrow width or in one language; a redesign or visual review is asked for; a README screenshot, banner or icon is produced.
---

# Card design

The card is ~200–260 px wide inside the DSH sidebar footer, in two themes and two languages, and it is read in
glances. Every decision here follows from that: one fact per row, values from a fixed scale, nothing that needs a
screenshot to explain itself.

This skill is the single authority for the card's visual values and bubble behaviour; `AGENTS.md` only requires that
the card keep its own palette and stay inside its subtree. Load `dsh-plugin-development` as well when a change also
touches the Host half, the route payload or the manifest.

## Before you start

1. Read **Invariants** and **Layout and compatibility guards** in `AGENTS.md` — they bound what the card may show and
   where it may read from.
2. Read the code you are about to change: `CARD_CSS` (the token block on `.dbc-root`, the card rules, the `.dbc-tip*`
   rules) and the spec builders (`showAccount`, `showApi`, `periodTip`, `modelTip`, `makeupTip`).

Do not start from the CSS and "improve" numbers. Start from what the row has to say. For where a rule came from and
what was rejected, read `docs/design-skill-audit.md` — it is a record, not a rule; its `client.js:NNN` line numbers
are historical, so follow the identifiers it names.

## Values

Normative. Changing any of these is a decision to argue for, not a tweak.

### Token layer

One palette declared on `.dbc-root` in `CARD_CSS`, each entry a `light-dark(light, dark)` pair: `--dbc-surface`,
`--dbc-surface-2`, `--dbc-surface-3`, `--dbc-line`, `--dbc-ink-1/2/3`, `--dbc-green`, `--dbc-green-bg`,
`--dbc-amber`, `--dbc-amber-bg`, `--dbc-blue`, `--dbc-r-card`, `--dbc-r-inner`, `--dbc-r-tag`, `--dbc-font`. The app
writes `color-scheme` on `<html>`, so both themes resolve without reading a host variable. Every rule reads a token; a
raw hex outside this block is a bug.

### Scale

- **Type** `11 / 13 / 17 / 20 px` on `14 / 16 / 22 / 25`. 11 is labels, meta, provider, model and the countdown; 13 a
  price value or a notice; 17 the amount when it would otherwise overflow; 20 the amount. No `10.5px`, and no
  `em`/`rem` — the card is a fixed-pixel component and `em` would inherit the host's font size.
- **Weight** `400` body, `500` for what a glance must catch (the countdown, the chips, the model name), `650`+ for
  numbers that carry money (the amount is `660`).
- **Spacing** `12px` card padding, `8px 10px` for the price panel, `6px` flex gap, `5px` inside the holiday strip,
  `4px` between chips. Closed set `4 / 5 / 6 / 8 / 10 / 12`, and space around a group exceeds space within it.
- **Radius** `14px` card, `10px` price panel, `8px` holiday strip, `6px` make-up tag, `999px` chips. Closed set
  `6 / 8 / 10 / 14 / 999`.

### Contrast

4.5:1 for every text colour on the surface it lands on, in both themes. Measured: `--dbc-ink-1` 17.8 / 15.0,
`-ink-2` 7.3 / 10.4, `-ink-3` 5.1 / 7.0 (and 4.7 / 6.2 on `-surface-2`), chip text 4.7 green / 4.6 amber on its own
tint (7.5 / 7.7 dark), blue 6.7 / 8.0. Recompute before changing a hex; a prettier hue is not a reason to drop below
4.5.

### Layout: one row per fact

Order: countdown + chips → amount → provider → model → prices.

- The amount prints no balance label — it is the loudest thing on the card and names itself. The word survives as the
  amount row's `aria-label` (`card.title` / `card.title.api`), with `role="group"` to make that name legal on a `span`,
  so a screen reader still hears what the number is.
- The amount never shares a line with the countdown — that pair is what clipped six-digit balances at 196 px. The
  countdown sits top-left, opposite the chips, because it is the one value that moves every second.
- The countdown takes the current period's colour (`--dbc-green` idle, `--dbc-amber` peak) and always carries its
  `距高峰` / `距空闲` wording: a bare clock next to the model reads as a duration.
- State is never colour alone: the period chip carries a `.dbc-dot` beside its word, every chip carries its word, and
  the countdown carries its label.

### Truncation

The amount drops one step (`dbc-amount-small`) past `AMOUNT_SMALL_AT` characters, the holiday name ellipsizes while
its `M/D · 空闲全天` meta stays, and the model ellipsizes last. The countdown never truncates.

### Hover bubble

The card draws its own bubble: `.dbc-tip*` is a normal node in its tree. The host primitive was borrowed until 1.3
and stays out — its surface is a fixed dark plate in both themes, which pins one element of a card that owns its
light/dark palette to somebody else's chrome. Never reintroduce `@deepseek-ai/dsh-client-ui-primitives`, and never
hand the bubble back to a native `title`, which is unstyleable and cannot hold a definition list.

#### Trigger

One trigger per visual row, and the trigger is the thing the row is about.

- The amount explains the balance: `dbc-tip-plain` — cursor help and a focus ring, deliberately **no** dashed
  underline, because the number is already the loudest element and a second affordance reads as a link. The trigger is
  the inline box around the money, never the row: `.dbc-amount-row` lays out and `.dbc-amount` answers, so a pointer
  100 px right of `¥32.50` is not over the balance, and a row-wide anchor hangs the bubble off the card edge.
- The model name explains the unit and the snapshot; each chip explains itself. A chip is its own affordance and takes
  the handlers without a class; text triggers that need advertising take `dbc-tip-trigger` (cursor + dashed underline).
- Never attach one label to two nested nodes, and never put a bubble on the price block or the holiday banner — their
  text already says what they are.
- A bubble states a fact about *this* card, so it must not outlive its truth: the model bubble belongs to an official
  provider only. Another provider bills its own account, which makes these numbers a list-price reference rather than
  its rates, so the row gets neither the class nor the handlers when `billsAtListPrice(provider)` is false.

#### Body

A spec `{rows, note?}` rendered as a definition list, because a bubble here always answers "what is this made of": one
`label → value` row per fact (label 11 px in `--dbc-ink-3`, value right-aligned on a shared edge, both tabular), then a
hairline plus an 11 px footnote in `--dbc-ink-3` for provenance.

- The hairline is `color-mix(in srgb, var(--dbc-ink-1) 12%, transparent)`, not `--dbc-line`: that token is a border
  colour tuned for the bubble's own 1 px edge, and between two rows of text it reads as nothing. A token typo paints
  nothing at all — that is how the rule once stayed invisible (`--dbc-line-2` was never declared), and why the suite
  now fails when the stylesheet reads a `--dbc-*` it does not declare.
- A note without rows (the make-up chip) draws no rule: it has nothing to separate it from. No head, no title, no total
  row — the card already shows the number and the bubble only decomposes it.
- `.dbc-tip-amount` is `white-space:pre-line`, so a value may carry `\n` (the peak window is two lines) and wrap
  right-aligned instead of pushing the label off the edge.

#### Mechanics

- `position:fixed` inside the card and no portal, so the sidebar cannot clip it; placed before paint above the trigger,
  flipped below when there is no room, clamped 8 px from the viewport edge. `z-index:2147483000` keeps it above the
  shell's own layers.
- The arrow is an 8 px diamond on the edge **facing** the trigger: bottom edge and apex down while the bubble sits above
  the word, top edge and apex up once it has flipped below. An arrow on the far side points away from what it explains.
  It sits at `centre - left - 4 px` because the apex is 4 px into its own box, and it is hidden rather than clamped when
  the trigger's centre ends up outside the bubble: a pointer beside its word is worse than none. Hidden rather than
  unmounted, because the bubble's child order is fixed and the suite checks it.
- A second pass re-measures the painted bubble and shifts it by whatever the browser did: any ancestor with a
  `transform`, `filter` or `will-change` turns `fixed` into a local coordinate system.
- `pointer-events:none` means the pointer can never enter the bubble, which is what makes leaving the trigger the only
  way it closes.
- Timing: `TIP_DELAY_MS = 240` on hover, `TIP_FOCUS_DELAY_MS = 90` on keyboard focus, cancelled by leave, blur or
  `Escape` (listened for on the window, so the card does not need focus).
- The arrow stays quiet: the bubble's own fill and a 10 % ink hairline on its two outer edges, with no shadow of its
  own — the bubble's shadow already separates it from the sidebar, and a second one turns a hint into a badge.

#### Rows and content

- A row may carry a tone **dot** (5 px, not a pill): `ok` green = recharge money, `warn` yellow = bonus money. A row
  without a dot is a plain fact. Pills were tried and dropped — at 11 px they read as cramped labels and their widths
  made the amounts miss the shared right edge.
- The bubble uses the card's own tokens, so it follows the theme like everything else. Never colour bubble text with
  `--dsw-alias-*`.
- The card and the bubble are not selectable (`user-select:none`): the numbers are read, not copied.
- A balance bubble describes only the balance on the headline — its composition and refresh cadence. The account and
  API bubbles never mention each other, and a notice is never followed by a bubble.
- Provenance lives in one place: the calendar source belongs to the period chip, the price snapshot belongs to the
  model row.

## Three tiers of rule

### Fixed — changing these is a bug, not a style choice

- Everything under **Values**: one palette, closed scales, the measured 4.5:1 floor, the row and truncation order.
- **Nothing ships in a state the card cannot reach.** Peak + 调休 is impossible (every make-up workday is a weekend,
  and weekends are idle all day); a holiday countdown is never two hours. Screenshots, copy and fixtures follow the
  same rule.
- **A bubble explains, it does not advertise.** The trigger placement and the provider gate above are fixed, not
  preferences.

### Preferred — reach for these first

- Move **one step on the scale**, never a half step. If no step fits, the row is wrong, not the scale; a new value has
  to be argued for and recorded.
- **Weight and colour carry hierarchy, size does not.** De-emphasise with `--dbc-ink-3`, never with a smaller size.
- **Tint the ground, darken the word.** A tinted chip or strip pairs a state colour with its own `-bg` token — the dark
  green on the pale green, `--dbc-blue` on its 9 % wash — which is what makes 4.7 green / 4.6 amber / 6.7 blue possible
  in light mode. Never put a state colour on a tint it was not measured against.
- **Test the longest translation, not the shortest.** `Cache read` had to become `Cached` to survive 196 px; prefer a
  shorter English word over a smaller font.
- **Notices replace the amount, they do not sit beside it**: `未配置 API Key` / `读取失败` occupy the amount row at
  13 px in `--dbc-ink-3`.

### Open — decide case by case, then record the decision

- Where a new fact goes: a new row, a second line inside an existing row, or a bubble. Default to a bubble — the card
  is five rows tall, and a sixth row costs a scroll in every other plugin's footer.
- Whether a state deserves a chip, a strip, or a word inside the bubble.
- Exact copy, as long as it fits at 196 px in both languages and names a fact rather than a feeling.

## Steps

### Before you change

1. **Reproduce the current state.** Render 232 px and 196 px, light and dark, zh and en (harness below). You cannot
   judge a change against memory.
2. **Classify the defect**, because the fix level differs: a missing token, a one-off value that should come from the
   scale, a conceptual mismatch (the row order is wrong), or a local defect (a rule that never painted). Fix at the
   narrowest level that removes the cause — do not add a token for one exception, and do not restructure a row to fix a
   colour.
3. **Decide the direction with the user before implementing** a redesign: render two or three concrete structures at
   real width in both languages, state what each costs, take the answer. A redesign that lands without a chosen
   structure gets reverted.

### While you change

- Edit `CARD_CSS` and the render tree together, then look again. A rule that reads right in isolation can still wrap,
  clip or float once it is a row.
- Keep the hook count identical in every render path — `wide` is a prop, not a mount gate. A guard above a hook tears
  the subtree down and the card never comes back.
- When a value or rule moves, update this file in the same change: a stale number here is a bug that outlives the fix.

## Verification

- [ ] Gate green (`AGENTS.md` → **Working rules**). Beyond `node --check`, the suite asserts the `.dbc-*` names, the
      bubble's child order and text, and that every `var(--dbc-*)` the stylesheet reads is declared. Never lower the
      assertion count.
- [ ] Rendered and looked at: 232 px and 196 px, light and dark, zh and en, plus every state touched.
- [ ] Nothing wrapped, clipped, floated to its own line, or lost its hairline; the countdown is complete in every case;
      the longest English label still fits.
- [ ] Contrast unchanged, or re-measured for any colour touched, in both themes.
- [ ] `docs/screenshots/*` and `docs/banners/*` still show reachable states and live prices
      (`curl http://127.0.0.1:<port>/deepseek-billing-card/data`).
- [ ] This file matches the code, and the commit message says which half needs a refresh and which needs a restart.

## Failure handling

| Symptom | Cause | What to do |
| --- | --- | --- |
| A rule exists in the DOM but nothing paints | `var(--dbc-line-2)` — a token nobody declared | the suite fails on an undeclared `--dbc-*`; keep that check |
| A hairline is "there" but invisible | a border token (`--dbc-line`) used as a divider | 12 % ink mix for dividers |
| Chip text unreadable in light mode | a state colour on a tint it was not measured against | pair it with its own `-bg` token (4.7 green / 4.6 amber) |
| The card disappears after collapsing the sidebar | `if (!wide) return null` placed above the hooks | the guard sits after every hook; hook count equal in both states |
| The bubble looks pasted on | the host primitive's fixed dark plate | the card draws its own bubble; never reintroduce the primitive |
| The arrow points away from its word, or floats beside it | drawn on the far edge, or the trigger's centre fell outside the bubble | arrow on the facing edge; hide it rather than clamp it |
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

The path above is this machine's Chrome; substitute the binary otherwise. Without `--no-sandbox` Chrome dies with
SIGTRAP here, and without `--user-data-dir` it cannot create a profile. Render at 2× and downsample with LANCZOS for
anything that ships, so 1 px lines and 11 px text stay honest.

## Provenance

The method comes from three third-party skills used during the 2026-10 redesign — `refactoring-ui` (scales, hierarchy,
contrast tiers), `ui-taste` (drift classification, verification on rendered pixels), `banner-design` (asset workflow) —
plus what this card learned the hard way. They are installed on demand, never vendored; `docs/design-skill-audit.md`
records what was adopted, rejected, and the exact install command for each.
