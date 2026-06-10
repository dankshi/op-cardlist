# Slab holders

Photoreal grading-holder ("slab") frames used to display graded collection
cards. Each file is one real holder design; the app composites the card into the
holder's window and overlays the frame on top (see
`src/components/collection/Slab.tsx`).

## Naming convention

One PNG per holder, named:

```
<grader>-<grade>.png        all lowercase, in this folder
```

- **grader** — `bgs` · `psa` · `cgc` · `tag`
- **grade** — the grade as it reads on the slab, lowercased, spaces → hyphens.
  Named top tiers spell out; numeric grades stay numeric:
  - `bgs-black-label.png`
  - `bgs-pristine.png` · `bgs-10.png` · `bgs-9.5.png` · `bgs-9.png`
  - `psa-10.png` · `psa-9.png`
  - `cgc-10.png` · `cgc-9.5.png`
  - `tag-10.png`

This filename is also the key the code uses (`slabKey(company, grade)` in
`Slab.tsx` derives the exact same string from a holding's company + grade).

## Asset requirements

- **Transparent PNG.** The card window must be fully transparent (alpha 0) so
  the card shows through; the plastic edges can be semi-transparent.
- **Just the empty holder** — frame + the baked-on label/grade. No card.
- Any resolution; portrait. The app uses the PNG's own aspect ratio.

## Registering a new holder

After dropping the PNG here, add one line to `SLAB_HOLDERS` in
`src/components/collection/Slab.tsx` with the window rectangle (as % of the
image) and the PNG's aspect ratio. Measure the window from the alpha channel —
e.g. with `sharp`, find the bounding box of fully-transparent pixels.

Example (the `bgs-black-label` holder, a 2004×3116 PNG):

```ts
'bgs-black-label': { aspect: '2004 / 3116', win: { left: 13.67, top: 24.23, width: 73.4, height: 65.76 } },
```
