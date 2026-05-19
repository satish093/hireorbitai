---
name: frontend-responsive
description: Mobile, iOS-Safari, and accessibility rules for the React frontend.
applies_to:
  - frontend/src/**
---

# Frontend responsive + a11y rules

## Viewport units

Use `min-h-dvh` / `h-dvh`, **never** `min-h-screen` / `h-screen`. On iOS Safari the URL bar collapses on scroll and `100vh` includes the bar, so layouts jump. `dvh` (dynamic viewport height) tracks correctly. The codebase has already swept all `100vh` usage; don't reintroduce it.

## Inputs on iOS

If you add a new `<input>`, `<select>`, or `<textarea>`, do **not** explicitly set `font-size` below 16px. iOS Safari auto-zooms inputs <16px. The global override in `frontend/src/index.css` clamps to 16px below the `sm` breakpoint — don't override that locally.

## Safe-area-inset

The viewport is `viewport-fit=cover`. Content extending to the edge of an iPhone with a notch must use the `.safe-pt` / `.safe-pb` / `.safe-pl` / `.safe-pr` utilities (defined in `index.css`). The mobile Sidebar drawer already opts in; mirror that if you add another full-bleed surface.

## Shared primitives — adopt them

Don't reinvent these — the codebase already standardizes:

- **`<Pill tone={...}>`** — every status/priority/due/tag badge in the app. Tones live as objects (`{ bg, text, dot?, border? }`). Add a new tone, don't restyle one off.
- **`<EmptyState>`** — empty list / panel state. Pass `title`, `description`, optional `action`. Use `compact` when nested inside an already-bordered card.
- **`<Skeleton>` / `<SkeletonCard>` / `<SkeletonMetricGrid>`** — loading state. Replace any "Loading…" text with one of these.
- **`<Modal>`** — has focus trap + body scroll + Escape close already. Don't roll your own.

## Form control alignment

`Button` (md), `FormInput`, and `SelectInput` are all `h-9 rounded-lg`. A toolbar row of `[input] [select] [button]` should be pixel-aligned. If a new control type joins the family, match the height + radius + `focus-visible:` ring color.

## Routes are lazy

Every page route except auth + dashboards uses `React.lazy()` in `App.tsx`. New pages must be added the same way — keep the main chunk small. Wrap with `<Suspense fallback={<RouteFallback />}>` is already handled at the top of `App.tsx`.

## Cross-page invalidation

After a mutation, call `invalidate('tasks')` (or `'messages'`, etc.) from `hooks/useInvalidate.ts`. Other pages listening via `useInvalidationListener` will refetch. Use this instead of `window.location.reload()`.

## Touch targets

Interactive elements on mobile should be at least 44×44px. The kebab icon buttons currently below that are flagged as residual UI debt — don't add more below the threshold.
