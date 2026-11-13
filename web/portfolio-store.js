// @ts-check
import { appendObservation, validObservations } from "./portfolio-model.js";
/** @typedef {import('./portfolio-types').PortfolioObservation} Observation */
/** No plaintext balances are written. The caller supplies the wallet's existing authenticated
 * secretSeal/secretOpen, with a separate context for this wallet AND network. Read before write
 * merges another tab's observations. An unreadable record is preserved until the user clears it.
 * @param {{storage: Pick<Storage, 'getItem'|'setItem'>, key: string,
 * seal:(text:string)=>string, open:(text:string)=>string, now?:()=>number}} options */
export function createPortfolioStore({ storage, key, seal, open, now = () => Date.now() }) {
  /** @type {Observation[]} */
  let records = [];
  let note = "", unreadable = false;
  function read() {
    try {
      const box = storage.getItem(key);
      if (!box) return [];
      const data = JSON.parse(open(box));
      if (data.version !== 1 || !Array.isArray(data.observations)) throw new Error("Bad history");
      return validObservations(data.observations, now());
    } catch {
      unreadable = true;
      note = "Saved history could not be read. Its encrypted copy has been kept.";
      return [];
    }
  }
  records = read();
  return {
    /** @param {Observation|null} observation */
    record(observation) {
      if (!observation) return;
      const merged = validObservations([...read(), ...records], now());
      const next = appendObservation(merged, observation);
      records = next;
      if (unreadable || next === merged) return;
      try {
        storage.setItem(key, seal(JSON.stringify({ version: 1, observations: records })));
        note = "";
      } catch { note = "History is available this session. This browser could not save it."; }
    },
    read() { return { observations: records, note }; },
    clearMemory() { records = []; },
  };
}
