# Resting zebra portrait

The homepage uses the approved cinematic numerical zebra with its mouth closed.
Irregular 310 ms blinks, occasional ear pivots of roughly 1–1.5 degrees and small
waves through the mane tips give the portrait a quiet resting performance.
Breathing follows a roughly 6.8-second rhythm: a gentle inhale, a longer exhale
and a short resting pause, with a small variation in timing. The chest and neck
expand locally while the head lifts and settles by approximately 1–2 desktop
pixels. The bottom of the portrait stays planted.
Occasional head turns bring the muzzle about 2–2.6 degrees toward the viewer,
hold briefly, then ease back over a longer return. Most of the time the head is
in its resting orientation. The first glance starts around 6.5 seconds; later
glances have different spacing, timing and strength, independent of the blink
and ear schedules. The upper neck blends the turn into the planted body.
The mouth has no animated state. There is no sound or playback button.

The two 1254 × 1254 transparent textures were prepared with the built-in image
generator from the approved `zebra-cinematic-master.png` in the older Zigs demo.
They retain the silver/graphite markings and dark red eye. WebP encoding preserves
alpha; the resting texture is 613 kB and the optional eyelid texture is 509 kB.
Only a feathered patch around the eye uses the second texture.

This implementation is a camera-locked **3D relief surface**, with 16,641 vertices,
authored anatomical depth and local ear/mane deformation. The detailed lighting
and surface appearance are baked into its textures. It is intended for the fixed
homepage view. The earlier editable Blender sculpt remains a separate prototype;
this implementation does not claim to have upgraded that full character model.

The existing homepage controller bounds rendering to 30 draws per second and a
1024 px canvas. It stops when hidden or offscreen and disposes resources when the
homepage leaves. Reduced motion, slow updates, forced colors, data-saving mode
and WebGL failure use the resting image. The eyelid texture loads only with the
renderer; a failed eyelid download leaves the eye open.

## Local review

Build the existing presentation shell with `node web/build.mjs`, then run
`node solspike/tools/zebra_preview.mjs`. The default preview is
`http://127.0.0.1:8942/`; it serves presentation assets and the existing shim,
without a wallet server or chain endpoints.

Validation:

```sh
node --test web/test/homepage-motion.mjs
node solspike/tools/zebra_portrait_browser.mjs
```

The browser check supports `PLAYWRIGHT_MODULE`, `CHROME_EXECUTABLE` and
`ZIGS_ZEBRA_ORIGIN` overrides. Evidence is written to
`docs/ux-redesign/visuals/zebra-portrait/`: desktop/mobile stills, a blink still,
a live recording and the check report. Observations are from local Chrome;
physical-device GPU performance has not been measured.

The browser review also compares inhaled and resting frames to check visible
chest movement and an unchanged base. The report records the latest check counts
and measured draw count.

The browser review also checks a changed head pose with an unchanged base.
`viewer-glance.png` captures the first turn. `breathing.webm` is a 22-second
extract of the live recording before the interaction and fallback checks.

The head-turn update passed 14 lifecycle checks and 26 browser checks with no
page errors. Rendered comparisons confirm movement in the head and an unchanged
base. The recorded live run includes the first glance and ongoing breathing.
