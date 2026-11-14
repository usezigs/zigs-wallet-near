// Adapted from Paul Bakaus' Radiant Dither Gradient (MIT).
// https://radiant-shaders.com/dither-gradient.html
// The Bayer matrix and quantizer are upstream; the restrained monochrome field is Zigs-specific.
// Copyright (c) 2025 Paul Bakaus. Full notice: ./vendor/radiant-LICENSE.txt
export const radiantDither = `
float bayer8(vec2 p) {
  vec2 fp = floor(mod(p, 8.0));
  float val = 0.0;
  float bx = step(4.0, fp.x);
  float by = step(4.0, fp.y);
  float b = bx * 2.0 * (1.0 - by) + (1.0 - bx) * 3.0 * by + bx * by;
  val += b * 16.0;
  float mx = mod(fp.x, 4.0);
  float my = mod(fp.y, 4.0);
  bx = step(2.0, mx);
  by = step(2.0, my);
  b = bx * 2.0 * (1.0 - by) + (1.0 - bx) * 3.0 * by + bx * by;
  val += b * 4.0;
  float lx = mod(fp.x, 2.0);
  float ly = mod(fp.y, 2.0);
  bx = step(1.0, lx);
  by = step(1.0, ly);
  b = bx * 2.0 * (1.0 - by) + (1.0 - bx) * 3.0 * by + bx * by;
  val += b;
  return val / 64.0;
}
float ditherQuantize(float val, float levels, float threshold) {
  float stepped = floor(val * levels) / levels;
  float next = stepped + 1.0 / levels;
  float frac = fract(val * levels);
  return frac > threshold ? next : stepped;
}
vec4 radiantAtmosphere(vec2 uv, float time) {
  float t = max(0.0, time - 1.5) * 6.28318530718 / 14.0;
  vec2 center = vec2(.63 + .08 * sin(t), .38 + .06 * cos(t));
  vec2 p = (uv - center) * vec2(1.0, .82);
  float field = exp(-dot(p, p) * 6.0);
  field *= .62 + .18 * sin(uv.x * 5.0 + uv.y * 3.0 + t);
  float grain = ditherQuantize(field, 5.0, bayer8(gl_FragCoord.xy / 2.0));
  vec2 edge = smoothstep(vec2(0.0), vec2(.16), uv)
    * (1.0 - smoothstep(vec2(.8), vec2(1.0), uv));
  float alpha = clamp(grain, 0.0, 1.0) * edge.x * edge.y * .18;
  return vec4(vec3(.82, .85, .88) * alpha, alpha);
}`;
