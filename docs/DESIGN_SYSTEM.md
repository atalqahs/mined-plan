# ORBITAL MIND — Design System

## Direction

A private instrument, not a SaaS dashboard. The interface reads like engraved
plates bolted around a piece of dark machinery: the sculpted metal brain is the
single bold element; everything else is quiet, precise and subordinate to it.

### Plan, then the review against generic defaults

| Axis | First instinct (rejected) | Final decision and why |
|---|---|---|
| Panels | Rounded glass cards with soft shadow | **Bevel-cut plates** — 45° chamfered corners (via `clip-path`), 1px gunmetal edge, no blur, no drop shadow. Echoes machined steel and gothic window tracery. |
| Accent | Gold for "luxury" | **No gold anywhere.** Emphasis is a cool pale steel (`#BFC4C9`) and, for the selected idea, muted ivory. The palette is monochrome: obsidian, charcoal, graphite, gunmetal, slate, steel; ivory is reserved for text. No navy, no neon. |
| Type | One neutral sans everywhere | **Reem Kufi** (geometric Kufic — carved, architectural) for the brand and panel headings; **IBM Plex Sans Arabic** (engineered, highly legible) for all UI and notes. Two clearly distinct families. |
| Labels | Small monospace caps "eyebrows" | None. Arabic has no caps; section headings are plain sentence-case Kufi at a modest size. |
| Motion | Fade-up on every panel, floating nodes | One orchestrated moment: camera glide on focus. Panels slide 180ms; nodes never float. Ambient neural pulse in the brain only, optional, off under reduced motion. |
| Background | Flat near-black | Deep obsidian with a cold radial falloff and sparse static dust — atmosphere without motion. |

## Tokens

Source of truth: `src/design-system/tokens/tokens.css` (CSS custom properties) and
`src/design-system/tokens/palette.ts` (the same values for the WebGL scene).
Tokens contain no business logic.

### Colour

| Token | Hex | Role |
|---|---|---|
| `--c-obsidian` | `#070809` | App background |
| `--c-charcoal` | `#0D0F11` | Deep fills |
| `--c-graphite` | `#131518` | Plates / panels |
| `--c-graphite-2` | `#1A1D21` | Raised controls, inputs |
| `--c-gunmetal` | `#2C3036` | Edges, dividers, idle borders |
| `--c-steel` | `#6E757D` | Slate grey: hierarchy lines, icons |
| `--c-steel-text` | `#9EA4AA` | Secondary text (≈ 7:1 on graphite) |
| `--c-accent` | `#BFC4C9` | Cool steel emphasis: focus ring, selected borders, cross-links |
| `--c-accent-text` | `#E6E3DD` | Emphasised text (selected label, primary button) |
| `--c-ivory` | `#DCD8D0` | Primary text only (≈ 13:1 on graphite) |
| `--c-oxblood` | `#8E3A35` | Destructive / overdue |
| `--c-verdigris` | `#74867B` | Completed |

Gold was removed entirely (tokens, components, scene lights, shaders, labels, wordmark, favicon).
An e2e test (`no gold anywhere in the rendered interface`) scans computed styles for the gold/brass hue band.

### 3D materials

* **Brain:** semi-matte graphite (`metalness 0.38`, `roughness 0.56`), darkened sulci, a faint
  colourless neural trace; lit by a neutral studio rig (no warm or blue fills). No base: only a
  soft radial shadow pool (`brain/Grounding.tsx`) gives it weight.
* **Ideas:** neutral steel orbs with a restrained rim and low specular; selected = muted ivory with a hexagonal halo.
* **Lines:** hierarchy = slate grey, solid; cross-links = pale steel, dashed.

### Type scale (desktop, 1rem = 16px)

| Token | Size | Use |
|---|---|---|
| `--fs-xs` | 12px | Counts, timestamps |
| `--fs-sm` | 13px | Secondary UI |
| `--fs-md` | 15px | Default UI |
| `--fs-lg` | 17px | Notes body, inputs in panel |
| `--fs-xl` | 22px | Panel title (Kufi) |
| `--fs-2xl` | 30px | Empty-state headline (Kufi) |

Line-height 1.6 for Arabic body (Arabic needs more vertical room than Latin), 1.25 for Kufi headings.

### Space and shape

4px base grid: `--s-1` 4 … `--s-8` 48. Bevel sizes: `--bevel-sm` 6px (buttons), `--bevel-md` 12px (panels).
Radius is not used; the chamfer *is* the shape language.

### Motion

`--ease-out: cubic-bezier(.2,.8,.2,1)`; `--t-fast` 120ms (hover), `--t-med` 180ms (panels), camera glide ≈ 0.6s damping.
All non-essential motion is disabled by `prefers-reduced-motion` or the in-app "reduce motion" setting.

## Components (`src/design-system/components`)

`Button` (primary = pale-steel edge on charcoal / quiet / danger, bevelled), `IconButton` (always has an Arabic `aria-label` + tooltip),
`Field` (visible label + optional hint + error placed under the field), `TextArea`, `Select`, `Plate`
(bevelled surface), `Badge`, `Kbd`, `Icon` (inline SVG stroke icons, `aria-hidden`).

## Accessibility checklist (applied)

- Contrast ≥ 4.5:1 for all text tokens on their surfaces.
- Every icon-only control has an Arabic `aria-label` and visible tooltip.
- Visible pale-steel focus ring (`:focus-visible`) on every interactive element.
- Keyboard: shortcuts use `KeyboardEvent.code`, so they work with an Arabic keyboard layout.
- HTML equivalents for 3D actions: search results, sub-idea and related lists in the panel navigate the graph.
- `dir="rtl"` + `lang="ar"` on the document; logical CSS properties (`inset-inline-*`, `margin-inline-*`).
