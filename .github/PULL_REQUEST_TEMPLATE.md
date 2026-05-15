<!-- Keep the title under 70 chars. Use the body for detail. -->

## Summary

## <!-- 1-3 bullets: what changed and why. -->

## Target branch

<!-- Tick one. -->

- [ ] `dev2` — feature branch landing
- [ ] `dev` — release-candidate from dev2
- [ ] `main` — production release from dev

## Test plan

<!-- How a reviewer can verify this. Include manual steps if applicable. -->

- [ ] `npm run typecheck` passes (backend)
- [ ] `npm run typecheck` passes (frontend)
- [ ] `npm run build` passes (both)
- [ ] Manually exercised the affected flow in the browser

## Risk / rollback

<!-- One line on blast radius. If this hits prod data, auth, billing, or migrations, say so. -->

## Screenshots

<!-- Optional. Required for visible UI changes. -->
