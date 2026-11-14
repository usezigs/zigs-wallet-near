# Zigs design rehearsal

Six authored product illustrations, built with the installed [Stageshow skill](https://github.com/benjitaylor/skills/tree/main/stageshow).
This development lab uses React; the wallet application keeps its existing DOM architecture.
The lab imports only Zigs CSS, fonts and artwork. It does not import wallet modules or call services.
All names, addresses, amounts, device contributions and file results are synthetic. The address
is deliberately invalid. Buttons inside the illustrations are authored cursor targets, not live controls.

## Preview

From this directory, run `npm ci`, then `npm run dev`. Open
[the viewer](http://127.0.0.1:4196/). Choose a journey and appearance, pause/resume,
replay, or show its result poster. On a phone-width host each scene uses a separate 358px composition.
Reduced motion shows the completed poster. The illustration is hidden from the accessibility tree;
the surrounding journey description and native viewer controls remain available.

Direct capture: `/?capture&scene=payment&theme=dark&still`.
Scene IDs: `payment`, `approvals`, `setup`, `receive`, `messages`, `recovery`.
`&opening` selects the opening still. `?gold=hero-demo` shows the unchanged reference.

## Verification

- `npm run build` — TypeScript and a standalone development build.
- `npm run check:css` — scene namespace check.
- `npm run check:viewer` — keyboard playback, both themes, responsive host, contrast, reduced motion.
- `npm run rehearse -- still` — 24 posters with the film gate.
- `npm run rehearse -- opening` — 24 opening stills.
- `npm run rehearse -- loop` — complete once-played journeys, both widths and themes.
- `npm run rehearse -- states` — opening, authored marks, settled states and ending.

Chrome must be installed. Set `CHROME_PATH` to choose its executable. Reports, logs and PNGs go
to ignored `shots/`; the coverage register in `docs/ux-redesign/` records the final results.

Recordings use the kit's `installVirtualClock` through `&clock=film`: every logical animation
frame is sampled even when PNG encoding stalls Chrome. This verifies geometry and causality,
not physical-device frame rate. Direct capture without that query uses native time; the viewer's
shared clock advances from elapsed native animation frames and supports Pause/Resume. Earlier
native recordings were inconclusive because screenshot encoding created sampling gaps; those
runs are not presented as complete motion evidence.

The copied gold folders preserve the upstream reference sources; the Zigs composition begins
with hero-demo's Stage/Window/compact structure and measured cursor targets, replacing its
content, material, state changes and mobile framing. Other gold stories informed the individual
journeys. See `scenes/REHEARSAL.md`, `LICENSE`, `NOTICE.md`, and `kit/brands/SOURCES.md`.
`web/.assetsignore` excludes this entire lab from the deployed wallet assets.
