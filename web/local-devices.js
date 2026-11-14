// Local presentation consent and share counts, never payment authorization or backup data.
const PREFIX = "zf-mainnet-local-devices:";
const validRule = (g) => Number.isInteger(g.n) && g.n >= 2 && g.n <= 7
  && Number.isInteger(g.t) && g.t >= 2 && g.t <= g.n;
const valid = (g) => g?.network === "mainnet" && /^[0-9a-f]{20}$/.test(g.id)
  && validRule(g);
const choice = (g) => JSON.stringify({ v: 1, network: g.network, n: g.n, t: g.t });

export function mainnetLocalDevicesAllowed(g) {
  if (!valid(g)) return false;
  try { return localStorage.getItem(PREFIX + g.id) === choice(g); }
  catch { return false; }
}

export function allowMainnetLocalDevices(g) {
  if (!valid(g)) throw new Error("Open the mainnet wallet before enabling local devices.");
  try {
    localStorage.setItem(PREFIX + g.id, choice(g));
    if (mainnetLocalDevicesAllowed(g)) return;
  } catch { /* a choice that cannot be saved is not acknowledged */ }
  throw new Error("This browser could not save the choice. Keep the devices separate and retry.");
}

/** A seat appears once, even if the same share is supplied more than once. */
export function localDeviceRisk(g, shares) {
  if (!valid(g)) return null;
  const held = new Set(shares.filter((s) => Number.isInteger(s.id) && s.id >= 1
    && s.id <= g.n && s.has).map((s) => s.id));
  if (held.size < 2) return null;
  const checked = new Set(shares.filter((s) => held.has(s.id) && s.verified).map((s) => s.id));
  return { held: held.size, required: g.t, canApproveZcash: checked.size >= g.t };
}
