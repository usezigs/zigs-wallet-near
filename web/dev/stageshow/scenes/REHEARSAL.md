# Rehearsal: Zigs journeys

Gold: copied `gold/hero-demo` before adaptation and filmed it as `shots/gold-hero.png`.
Kept Stage/Window framing, compact branching, named cursor targets and once-played beats.
Changed to the production Zigs palette, fonts, zebra, financial records and state meanings.
Compact uses the kit Phone with independently sized content. The other copied gold folders
provide the device, form, message and recovery interaction references listed in the plan.

Beats: inspect → review → payoff; payment includes exact amount entry. Each story is played
once and leaves its result. Replay is an explicit host action; financial data never rewinds
in a running scene. All displayed names/addresses/files/results are synthetic. No app handlers
or services are imported. Each scene has its own notes in the folders below.

Captured: 720px desktop design at a 1280px viewport; a separate 358px compact design at 390;
light and dark independently; opening, poster, full once playback and marked states. Host QA
also checks Pause/Resume, Replay, preference switching, reduced motion, contrast and crop clearance.

Gate: `rehearsal passed (necessary, not sufficient: references/verify.md and the fresh eye in review.md still stand)`.
Per-run logs, full coverage and findings are in ignored `shots/<scene>-<theme>-<width>-<mode>.*`.

Film fixes:

- Loose title/value stacks → reduced internal gaps while retaining external grouping.
- Short phone bleed / desktop CTA crop → deliberate bottom bleed and a tighter desktop rhythm.
- Dark CTA and success tick contrast → production on-primary foreground.
- Clipped Roll glyph / caption height movement → retained, measured States slots for status copy.
- Total before amount → entry prompts follow the field; review provides the exact total, retained through proposal.
- Premature approval state → the local row changes after its approval action; the remote contribution arrives independently; the progress line shows one approval while waiting.
- Placeholder address repetition → a varied, deliberately invalid demo address.
- Native sampling gaps while encoding screenshots → use the kit's official virtual capture clock.
  No gate checks or thresholds were disabled or relaxed. Native runs remain inconclusive.
- Digit width steps on `.ss-field__chars` are intentional typing feedback at a 75ms interval;
  only that exact text span is marked `data-typing` during entry. The field, summary and
  neighboring controls remain measured; no broad data-snap/data-crop flags mask their motion.
- A cursor covering the button label → measured presses at 15% of the button width.
- Compact input feedback → kit touch cursor, retaining the real desktop cursor.

Local kit extensions: responsive cursor style mirrors the existing responsive cursor start;
Field accepts an optional typing marker applied only to its changing character span. Defaults
remain upstream-compatible, and the copied gold sources are unchanged.

Fresh-eye review: dark contrast, crop, clipping, chronology, labels and conversation context were
reported and fixed. Refreshed approval/recovery/message desktop, dark compact success states,
and payment opening/typing/review/payoff were re-reviewed. A separate fresh-eye pass caught
amount-entry prompting, a premature local approval, and a stale progress caption. Those were
corrected and the affected scenes re-filmed; the final re-review returned **nothing**.
The final index contains **96/96 complete named captures**, all with exit code 0.

Assumptions: synthetic Testnet illustration; no claim about network/crypto completion time.
Unresolved design findings: none in the reviewed frames.
Not checked: live-chain operations, actual clipboard/file writes, physical devices, Safari/Firefox,
phone keyboard and hardware frame pacing. Deterministic geometry is not physical frame-rate evidence.
