// Mainnet share concentration stays visible independently of the local setup acknowledgement.
import { state, ui } from "./app-state.js";
import { el } from "./app-dom.js";
import { sec } from "./app-keystore.js";
import { localSeats } from "./app-seats.js";
import { seatCheck } from "./app-dkg.js";
import { canWriteAs, signedMode } from "./app-filter.js";
import { focusAfter, render } from "./app-loop.js";
import {
  allowMainnetLocalDevices, localDeviceRisk, mainnetLocalDevicesAllowed,
} from "./local-devices.js";

export function localDevicesWarning(g = state.g) {
  if (!g || g.id !== state.gid) return null;
  const ready = !!state.wallet && state.seatsLoaded
    && (!signedMode(g.id) || state.seatsSettled) && !state.pending && !g.shapeMoved;
  const risk = localDeviceRisk(g, localSeats().map((id) => ({ id,
    has: !!sec(g.id, id)?.keyPackage,
    verified: ready && seatCheck(id) === true && canWriteAs(id),
  })));
  if (!risk) return null;
  return el("div", { class: "local-devices-warning", role: "note",
    "data-local-devices-warning": risk.canApproveZcash ? "threshold" : "shared" },
  el("strong", {}, risk.canApproveZcash ? "This browser can approve Zcash payments by itself."
    : risk.held + " Zcash signing shares are held in this browser."),
  el("p", {}, risk.held + " distinct shares are stored together; " + risk.required
    + " are required. They do not provide separate-device protection."
    + " Keep each share’s recovery file and its separate passphrase safe."));
}

const cancelLocalDevices = () => {
  ui.localDevicesReview = null; ui.localDevicesError = "";
  focusAfter("review-mainnet-local-devices", true); render();
};

export function mainnetLocalDevicesChoice(g, disabled, nextSeat) {
  if (mainnetLocalDevicesAllowed(g)) return null;
  if (ui.localDevicesReview !== g.id) return el("button", {
    class: "btn", type: "button", disabled, "data-key": "review-mainnet-local-devices",
    onclick: () => {
      ui.localDevicesReview = g.id; ui.localDevicesError = "";
      focusAfter("cancel-mainnet-local-devices", true); render();
    },
  }, "Review single-browser mainnet setup");
  const enable = () => {
    if (disabled || state.gid !== g.id || state.g?.network !== "mainnet") return;
    try {
      allowMainnetLocalDevices(state.g); ui.localDevicesReview = null;
      focusAfter("play-device-" + nextSeat, true); render();
    } catch (e) {
      ui.localDevicesError = e.message; render();
    }
  };
  return el("section", { class: "local-devices-choice", "aria-labelledby": "local-devices-title" },
    el("h3", { id: "local-devices-title" }, "Keep mainnet shares in one browser?"),
    el("p", {}, "Each played device adds a separate signing share here. With enough shares,"
      + " this browser can approve real mainnet payments by itself. A passkey protects storage;"
      + " it does not make these shares independent devices."),
    el("p", {}, "This choice applies only to this wallet in this browser."
      + " Keep a recovery file and separate passphrase for every share."),
    ui.localDevicesError ? el("p", { role: "alert", class: "small bad" },
      ui.localDevicesError) : null,
    el("div", { class: "row-actions" },
      el("button", { class: "btn", type: "button", "data-key": "cancel-mainnet-local-devices",
        onclick: cancelLocalDevices }, "Keep devices separate"),
      el("button", { class: "btn primary", type: "button", disabled,
        onclick: enable }, "Enable for this wallet")));
}
