---
name: "Zigs"
description: "Discreet, precise, a little wild: the existing desktop and mobile web system."
colors:
  dark-page: "#141617"
  dark-rail: "#101213"
  dark-surface: "#1c1f20"
  dark-raised: "#292c2d"
  dark-well: "#181b1c"
  dark-ink: "#f2f3ee"
  dark-muted: "#b2b8b6"
  dark-quiet: "#989f9c"
  dark-line: "#303536"
  dark-control-line: "#7d8586"
  dark-action: "#eeefea"
  dark-action-hover: "#ffffff"
  dark-on-action: "#202523"
  dark-focus: "#a8c7ea"
  dark-success: "#8bd5b5"
  dark-danger: "#f5a1a9"
  dark-warning: "#eac17d"
  light-page: "#f6f5f1"
  light-rail: "#efeee9"
  light-surface: "#ffffff"
  light-raised: "#eeede8"
  light-well: "#f4f3ef"
  light-ink: "#222523"
  light-muted: "#5c635d"
  light-quiet: "#626a62"
  light-line: "#ddded8"
  light-control-line: "#797f77"
  light-action: "#252a26"
  light-action-hover: "#383e39"
  light-on-action: "#ffffff"
  light-focus: "#2e5985"
  light-success: "#176549"
  light-danger: "#a52d37"
  light-warning: "#795012"
  icy-blue: "#a8c7ea"
typography:
  display:
    fontFamily: "Manrope, -apple-system, BlinkMacSystemFont, \"Segoe UI\", sans-serif"
    fontSize: "clamp(44px, 4.3vw, 64px)"
    fontWeight: 400
    lineHeight: "1.1"
    letterSpacing: "-0.045em"
  headline:
    fontFamily: "Manrope, -apple-system, BlinkMacSystemFont, \"Segoe UI\", sans-serif"
    fontSize: "1.75rem"
    fontWeight: 500
    lineHeight: "2.25rem"
    letterSpacing: "-0.035em"
  title:
    fontFamily: "Manrope, -apple-system, BlinkMacSystemFont, \"Segoe UI\", sans-serif"
    fontSize: "1.125rem"
    fontWeight: 500
    lineHeight: "1.75rem"
  body:
    fontFamily: "Manrope, -apple-system, BlinkMacSystemFont, \"Segoe UI\", sans-serif"
    fontSize: ".9375rem"
    fontWeight: 400
    lineHeight: "1.5rem"
  label:
    fontFamily: "Manrope, -apple-system, BlinkMacSystemFont, \"Segoe UI\", sans-serif"
    fontSize: ".875rem"
    fontWeight: 500
    lineHeight: "1.25rem"
  caption:
    fontFamily: "Manrope, -apple-system, BlinkMacSystemFont, \"Segoe UI\", sans-serif"
    fontSize: ".8125rem"
    fontWeight: 400
    lineHeight: "1.25rem"
  mono:
    fontFamily: "\"Geist Mono\", ui-monospace, \"SF Mono\", Menlo, monospace"
    fontSize: ".8125rem"
    fontWeight: 400
    lineHeight: "1.25rem"
  input:
    fontFamily: "Manrope, -apple-system, BlinkMacSystemFont, \"Segoe UI\", sans-serif"
    fontSize: "16px"
    fontWeight: 400
    lineHeight: "24px"
rounded:
  sm: "6px"
  control: "8px"
  panel: "16px"
  sheet: "20px"
spacing:
  space-1: "4px"
  space-2: "8px"
  space-3: "12px"
  space-4: "16px"
  space-5: "20px"
  space-6: "24px"
  space-8: "32px"
  space-10: "40px"
  space-12: "48px"
  space-16: "64px"
  space-20: "80px"
components:
  button-primary-light:
    backgroundColor: "{colors.light-action}"
    textColor: "{colors.light-on-action}"
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    padding: "12px 16px"
    height: "48px"
  button-primary-light-hover:
    backgroundColor: "{colors.light-action-hover}"
    textColor: "{colors.light-on-action}"
  button-primary-dark:
    backgroundColor: "{colors.dark-action}"
    textColor: "{colors.dark-on-action}"
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    padding: "12px 16px"
    height: "48px"
  button-primary-dark-hover:
    backgroundColor: "{colors.dark-action-hover}"
    textColor: "{colors.dark-on-action}"
  button-secondary-dark:
    backgroundColor: "{colors.dark-raised}"
    textColor: "{colors.dark-ink}"
    rounded: "{rounded.control}"
    padding: "12px 16px"
    height: "48px"
  input-dark:
    backgroundColor: "{colors.dark-well}"
    textColor: "{colors.dark-ink}"
    rounded: "{rounded.control}"
    typography: "{typography.input}"
    padding: "12px 14px"
  card-dark:
    backgroundColor: "{colors.dark-surface}"
    textColor: "{colors.dark-ink}"
    rounded: "{rounded.panel}"
    padding: "24px"
  badge-dark:
    backgroundColor: "{colors.dark-well}"
    textColor: "{colors.dark-muted}"
    rounded: "{rounded.sm}"
    padding: "4px 8px"
    height: "24px"
---

# Design System: Zigs

## Overview

**Creative North Star: "Discreet, precise, a little wild"**

Zigs pairs the original zebra fingerprint and artwork with a quiet working interface. The approved
character comes from the product itself: recognizable identity, exact financial records, restrained
controls and a clear distinction between navigation, a document and a temporary surface.

This documents the implemented system, rather than proposing a replacement. The source of truth
for runtime values remains `web/design-system.css`, followed by the component and refinement
styles loaded by `web/index.html`. Both themes are first-class. The isolated Stageshow illustrations
are examples of the product, not a source of miniature geometry for the live application.

The integrated `Near` build uses an OpenGlass React presentation shell around the existing native
wallet modules. Its material rules live in `web/openglass/theme.css`; native dialog forms keep their
ownership, validation and handlers. Financial cards, balances, dialogs and receipts retain opaque
grounds. `web/journey-refinement.css` loads last for the reviewed journey and navigation details.

**Key Characteristics:**
- Original zebra identity and wallet identity artwork.
- Warm chalk or charcoal, with icy blue used for focus and selected detail.
- Precise, restrained typography and complete financial identifiers.
- Subtle elevation, with glass reserved for orientation and utility chrome.

## Colors

The frontmatter captures the actual reusable colors in both themes; matching names map to the
same role. Theme-specific values are not interchangeable.

### Primary

The `light-action` and `dark-action` families define filled primary controls and their foregrounds.
The lighter action in dark mode is intentional. `icy-blue` supplies the existing accent; each
theme's `focus` token supplies a readable accent ink. Blue does not replace every primary action.

### Neutral

The page, rail, surface, raised and well families establish location and depth. Ink, muted and quiet
remain readable text roles. Line is a decorative separator; control-line is the stronger functional
boundary for fields. Light balance and review surfaces follow the light theme, including their controls.

Success, danger and warning tokens describe actual state. A shielded asset's privacy state, a
joined device and an approved payment are separate meanings and retain their own labels.

**The Theme Pair Rule.** Every surface takes its foreground and controls from the same theme.
**The State Evidence Rule.** Color reinforces an established state; it never establishes success itself.

## Typography

The system uses local Manrope for interface text and local Geist Mono for identifiers and selected
numeric metadata. Financial values use stable tabular figures. Prominent balances may use Manrope;
monospace is not required for every number or label.

The frontmatter contains the actual role scale. Home has its observed fluid display treatment;
working page titles use the headline role, sections the title role, and ordinary text the body,
label and caption roles. The wallet-context title is deliberately smaller than a page title.
Mobile page titles and balances step down through the existing responsive tokens. Existing
component-specific sizes remain legitimate; this file does not normalize every heading into one size.

**The Complete Value Rule.** Preserve exact native amounts, units, full addresses and full comparison
values. Wrap or disclose long records deliberately; do not silently replace a decision-relevant value
with an illustration placeholder or truncation.

## Layout

The desktop shell uses the existing 248px rail and a content width capped at 1440px. The page gutter
is 32px, reduced to 20px below the 760px breakpoint and 16px at the narrowest layouts. The spacing
scale is recorded in frontmatter; related fields use the smaller steps, while panels and distinct
sections use the larger steps. Panel padding is normally 24px and 20px on mobile.

Live action/form controls retain a 48px minimum height. Desktop navigation may be denser at 36px;
mobile navigation returns to 48px. Mobile rearranges the composition and permits document scrolling.
Short viewports release sticky form chrome where it would consume the reading area.

Payment composer and review sheets use their existing wider document measure; Receive uses a narrower
sheet. Full financial records wrap within the document. Group validation with its field, keep the
reading and keyboard order consistent, and leave costs, rule and consequences with the next action.

**The Working Document Rule.** Let financial information read as a coherent document, with one
primary task and exact values; do not turn every supporting fact into an equally prominent card.

## Elevation & Depth

Depth combines opaque tonal surfaces with broad, low-opacity shadows. Panel, raised, floating and
sheet shadows have different jobs; their actual theme values are recorded in the sidecar. Nested
rows remain quiet. The original wallet identity art is static by default, with explicit playback.

The rail, sticky wallet context, menus and selected drawer chrome can use the existing frosted
material. Balances, recipient records and payment terms keep an opaque ground. The source already
provides opaque reduced-transparency fallbacks and forced-color treatments.

Motion uses the existing short interaction timings and one common easing curve. Values remain
stable; no continual balance animation is introduced. Reduced motion removes presentation motion.

**The Utility Glass Rule.** Use glass to maintain location around a task, while the task's financial
content keeps a stable, readable surface.

## Shapes

The shape scale separates small badges, controls, panels and sheets. Controls use the control radius,
large panels use the panel radius, and floating sheets use the sheet radius, with the existing mobile
adjustment. Stronger edges identify actionable boundaries; decorative separators stay quieter.
Preserve the real zebra mark and official asset marks in their original proportions.

## Components

### Buttons

Primary actions use the current theme's action/foreground pair. Secondary controls use a raised
neutral surface; ghost controls carry less emphasis. Hover changes the same color family, focus has
a visible outline, and disabled controls retain a visible explanation when one exists. Destructive
actions keep their established consequence and confirmation behavior.

### Chips

Badges communicate a specific state, asset/network fact or capability. Preserve explicit Demo,
Testnet, Quotes only and unavailable disclosures. Do not turn these into decorative reassurance.

### Cards / Containers

Panels use the opaque surface, theme line and panel radius with the appropriate shadow. Nested rows
and records use rules or quiet wells. The balance is the main financial focal point, while device
progress and activity remain supporting information.

### Inputs / Fields

Fields use a stronger functional border, quiet well, control radius and visible focus. Validation
stays with the input that caused it and is associated semantically. Typed values and focused controls
survive redraws. Amount, address and memo are distinct fields with their own guidance.

### Navigation

The selected section has one restrained fill and an accent icon. Wallet selection remains distinct
from section selection. The mobile menu retains the current wallet, a clear close path and focus
return. Money, Contacts and Wallet care group the eight direct destinations. The narrow menu uses
two columns with whole destination words and separate secondary badges. Disclosure chevrons receive
one appropriate rotation.

**The Navigation Group Rule.** Group money, contacts and wallet-care tasks while keeping their
destinations directly available.

### Financial review and recovery

Review foregrounds the decoded transaction, complete recipient records, costs and signing rule before
its real next action. Recovery sheets distinguish saving, checking and restoring material. Approval
progress retains device-level meaning; joined, approved, signed and included remain different states.
Keep a concise privacy summary visible and put supporting disclosure detail behind a native
expander. Recovery leads with files checked in this browser; other devices' reported checks stay
separate and qualified. Replacement-wallet consequences appear before configuration, with full
access and fund-movement limitations grouped before the action.
Security exposes Restore near its overview heading, opening the existing recovery guidance with
keyboard focus. Form dialogs preserve native form submission inside a semantic dialog container.

**The Scope Rule.** Name the browser, device and chain covered by a recovery state or action.
Local file checks and reports from other devices remain separate kinds of evidence.

## Do's and Don'ts

### Do:
- Do preserve the original zebra identity and the approved restrained material character.
- Do use matching semantic surface, text and control tokens in each theme.
- Do keep the complete financial record and the actual next action understandable together.
- Do compose mobile for touch, scrolling, visible focus and enlarged text.
- Do keep reduced-motion, reduced-transparency and forced-color fallbacks working.

### Don't:
- Don't introduce a new visual world during a refinement pass.
- Don't use decorative success styling to imply a payment or recovery step completed.
- Don't put transparent glass behind decision-relevant financial values.
- Don't scale miniature illustration controls into the live app.
- Don't replace real marks with invented monograms or omit capability disclosures.
