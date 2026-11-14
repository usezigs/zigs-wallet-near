# Impeccable setup

Installed with `npx --yes impeccable install` for Codex, at project scope, on `deslopify`.
Skill package: 4.9.0. Installed darwin-arm64 engine: 0.1.23. Project hook manifests are in
`.codex/hooks.json`; the CLI reports the Codex wiring enabled. Codex must load the installed
skill/settings, and may require the first hook approval through `/hooks` before hooks execute.
The skill is available on the next turn.

The `/impeccable init` workflow is complete:

- `PRODUCT.md` records the web product and the user-confirmed primary audience: individuals
  spreading control across their own devices. Multi-person capabilities remain supported.
- `.impeccable/config.json` records the user's chosen `buildPath: "comp"`: image mockups first
  for future landing pages and showcases. App screens and documents remain code-first under
  Impeccable's workflow.
- Existing Zigs identity and approved direction remain binding. Init does not create a new
  visual world or replace the current design. Existing implementation evidence remains in
  `docs/ux-redesign/` and the production styles.

No application UI, protocol, production security policy or deployment was changed by init.
Live browser-picker setup was not started; it is separate from product initialization. A future
live session must check the actual served page and its development CSP before injection.

## Version control

Keep the shared product/design context under version control when those files exist:
`PRODUCT.md`, `DESIGN.md`, `.impeccable/config.json`, `.impeccable/surfaces/`,
`.impeccable/design.json`, `.impeccable/live/config.json`, and `.impeccable/critique/ignore.md`.
The installed project skill in `.agents/skills/impeccable/` and `.codex/hooks.json` are shared
project tooling. Do not blanket-ignore `.impeccable/`; that would hide shared decisions.

The downloaded platform engine in `.agents/skills/impeccable/scripts/bin/` and the local hook
consent/settings in `.impeccable/config.local.json` are ignored. The launcher can download and
verify the proper engine on another machine. Runtime directories ignore themselves as created.

No files were committed, merged or pushed during this setup. `main` remains untouched.
