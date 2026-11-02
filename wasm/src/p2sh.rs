//! The transparent address of a group wallet: a P2SH multisig address (ZIP 48, `sortedmulti`).
//! Each seat holds one secp256k1 account key, and a spend needs the signatures of `t` seats.
//! The key of a seat comes from the secret share of its FROST key package, so a backup of the
//! key share also restores it. The secret key never leaves the engine.

use std::{collections::HashSet, num::NonZeroU8};

use orchard::keys::{FullViewingKey, Scope};
use pczt::{
    roles::{
        creator::Creator,
        io_finalizer::IoFinalizer,
        signer::Signer,
        verifier::{OrchardError, TransparentError, Verifier},
    },
    Pczt,
};
use serde::Deserialize;
use serde_json::{json, Value};
use wasm_bindgen::prelude::*;
use zcash_primitives::transaction::{
    builder::{BuildConfig, Builder, BundlePadding, PcztResult},
    fees::{transparent::InputSize, zip317, FeeRule as _},
    TxVersion,
};
use zcash_protocol::{
    consensus::{BlockHeight, Network, Parameters},
    memo::MemoBytes,
    value::Zatoshis,
};
use zcash_script::script::{Evaluable as _, Redeem};
use zcash_transparent::{
    address::TransparentAddress,
    builder::p2sh_input_serialized_len,
    bundle::{OutPoint, TxOut},
    keys::NonHardenedChildIndex,
    sighash::SighashType,
    zip48,
};

use super::{
    e, ensure, network, parse_fvk, pczt_from_b64, pczt_to_b64, rng, Custom, Terms, R,
};

/// A standard P2SH multisig script holds at most 15 keys (ZIP 48).
const MAX_KEYS: usize = 15;

/// The ZIP 48 account key of the seat whose FROST key package is `key_package` (JSON, the form of
/// the web and native apps). The seed is a BLAKE2b hash of the secret share and the group key, so
/// each seat of each wallet has its own key.
fn account_key(key_package: &str, net: &Network) -> R<zip48::AccountPrivKey> {
    let kp: Value = serde_json::from_str(key_package).map_err(|_| "the key package is no JSON")?;
    let bytes = |field: &str| -> R<Vec<u8>> {
        let text = kp[field].as_str().ok_or(format!("the key package has no {field}"))?;
        hex::decode(text).map_err(|_| format!("the {field} of the key package is no hex"))
    };
    let (share, group) = (bytes("signing_share")?, bytes("verifying_key")?);
    if share.len() != 32 || group.len() != 32 {
        return Err("the key package has a share or a group key of the wrong length".into());
    }
    let seed = blake2b_simd::Params::new()
        .hash_length(64)
        .personal(b"Zigs_P2shSeed_v1")
        .to_state()
        .update(&share)
        .update(&group)
        .finalize();
    zip48::AccountPrivKey::from_seed(net, seed.as_bytes(), Default::default())
        .map_err(|_| "the ZIP 48 key cannot be derived from this share".into())
}

/// The key information expression (BIP 388) of the account key of this seat. The seat publishes
/// it, so that every seat can make the address of the group.
pub fn p2sh_key(key_package: &str, net: &str) -> R<String> {
    let net = network(net)?;
    Ok(account_key(key_package, &net)?.to_account_pubkey().key_info_expression(&net))
}

/// The address and the redeem script of the group: `t` signatures (at least 2) of the `keys` of
/// all seats (the published key information expressions, in any order). The key of this seat
/// (`key_package`) must be among them exactly once, and no two seats may have the same key: a key
/// twice in the script would let one seat give two of the `t` signatures.
pub(crate) fn group_script(
    t: u32, keys: &[String], key_package: &str, net: &Network,
) -> R<(TransparentAddress, Redeem)> {
    if keys.is_empty() || keys.len() > MAX_KEYS {
        return Err(format!("a group address needs 1 to {MAX_KEYS} keys, not {}", keys.len()));
    }
    // One signature would let one seat spend alone.
    let fits = |t: &NonZeroU8| (2..=keys.len()).contains(&usize::from(t.get()));
    let threshold = u8::try_from(t).ok().and_then(NonZeroU8::new).filter(fits);
    let threshold = threshold.ok_or(format!("the threshold {t} does not fit {} keys", keys.len()))?;
    let parse = |(i, k): (usize, &String)| {
        zip48::AccountPubKey::parse_key_info_expression(k, net)
            .ok_or(format!("key {} is no ZIP 48 key of this network", i + 1))
    };
    let parsed = keys.iter().enumerate().map(parse).collect::<R<Vec<_>>>()?;
    let own = account_key(key_package, net)?.to_account_pubkey();
    let mine = parsed.iter().filter(|k| **k == own).count();
    if mine != 1 {
        return Err(format!("the key of this device is {mine} times in the group keys, not once"));
    }
    let fvk = zip48::FullViewingKey::standard(threshold, parsed)
        .map_err(|e| format!("the group keys do not make a ZIP 48 address: {e:?}"))?;
    let (address, redeem) = fvk.derive_address(zip32::Scope::External, NonHardenedChildIndex::ZERO);
    distinct_keys(&redeem)?;
    Ok((address, redeem))
}

/// The P2SH address of the group (`group_script`). Returns JSON {address, redeem_script (hex)}.
pub fn p2sh_address(t: u32, keys: &[String], key_package: &str, net: &str) -> R<String> {
    let net = network(net)?;
    let (address, redeem) = group_script(t, keys, key_package, &net)?;
    let encoded = zcash_keys::address::Address::Transparent(address).encode(&net);
    Ok(json!({"address": encoded, "redeem_script": hex::encode(redeem.to_bytes())}).to_string())
}

/// Refuses a multisig script with the same public key twice.
fn distinct_keys(redeem: &Redeem) -> R<()> {
    use zcash_script::solver::{standard, ScriptKind};
    let Some(ScriptKind::MultiSig { pubkeys, .. }) = standard(redeem) else {
        return Err("the group script is no multisig script".into());
    };
    let unique: HashSet<&[u8]> = pubkeys.iter().map(|k| k.as_slice()).collect();
    if unique.len() != pubkeys.len() {
        return Err("two seats have the same key, so one seat could sign twice".into());
    }
    Ok(())
}

#[wasm_bindgen(js_name = p2shKey)]
pub fn js_p2sh_key(key_package: &str, net: &str) -> Result<String, JsError> {
    p2sh_key(key_package, net).map_err(|e| JsError::new(&e))
}

#[wasm_bindgen(js_name = p2shAddress)]
pub fn js_p2sh_address(
    t: u32, keys: Vec<String>, key_package: &str, net: &str,
) -> Result<String, JsError> {
    p2sh_address(t, &keys, key_package, net).map_err(|e| JsError::new(&e))
}

// ─────────────── The sweep: from the group address to the shielded wallet ───────────────
//
// A sweep spends payments of the group address to the external Ironwood address of the wallet.
// It has one phase: each device checks it and signs each input with its key, and the signatures
// are its approval. Any device that holds `t` of them finishes and sends it.

/// A sweep pays one Ironwood output, which the builder pads to two actions.
const SWEEP_ACTIONS: usize = 2;
/// At most this many payments in one sweep.
pub(crate) const MAX_SWEEP_INPUTS: usize = 50;

/// An unspent output of the group address, as `transparentUtxos` lists it (the txid in the
/// order of explorers).
#[derive(Deserialize, Clone)]
pub(crate) struct Coin {
    txid: String,
    index: u32,
    value: u64,
}

impl Coin {
    fn outpoint(&self) -> R<OutPoint> {
        let id = hex::decode(&self.txid).ok().and_then(|b| <[u8; 32]>::try_from(b).ok());
        let mut id = id.ok_or("a payment of the group address has a bad txid")?;
        id.reverse();
        Ok(OutPoint::new(id, self.index))
    }
}

/// The ZIP 317 fee of a transaction with `inputs` P2SH inputs of `size` bytes and `actions`
/// Ironwood actions: the rule that the builder applies.
pub(crate) fn sweep_fee(inputs: usize, size: usize, actions: usize) -> R<u64> {
    let sizes = std::iter::repeat_n(InputSize::Known(size), inputs);
    let fee = zip317::FeeRule::standard()
        .fee_required(&Network::MainNetwork, BlockHeight::from_u32(0), sizes, [], 0, 0, 0, actions)
        .map_err(e("fee"))?;
    Ok(fee.into_u64())
}

/// The size of one input of the group script in a transaction, with `t` signatures of the
/// largest size (ZIP 317).
pub(crate) fn input_size(redeem: &Redeem) -> R<usize> {
    p2sh_input_serialized_len(&redeem.clone().weaken())
        .ok_or_else(|| "the group script is no multisig script".to_string())
}

/// The payments that a sweep spends, largest first, and its fee: as many as raise the amount that
/// arrives, at most `MAX_SWEEP_INPUTS`. Anyone can send dust to the public address: a payment
/// worth less than the fee of its own bytes stays behind.
fn pick_coins(mut coins: Vec<Coin>, size: usize) -> R<(Vec<Coin>, u64)> {
    coins.sort_by(|a, b| b.value.cmp(&a.value));
    let (mut best, mut total) = ((0, 0, 0), 0u64);
    for (k, c) in coins.iter().take(MAX_SWEEP_INPUTS).enumerate() {
        total = total.checked_add(c.value).ok_or("the payments add up to too much")?;
        let fee = sweep_fee(k + 1, size, SWEEP_ACTIONS)?;
        if total.saturating_sub(fee) > best.1 {
            best = (k + 1, total - fee, fee);
        }
    }
    if best.0 == 0 {
        return Err("the transparent address holds no payment worth more than the fee".into());
    }
    coins.truncate(best.0);
    Ok((coins, best.2))
}

/// The PCZT of a sweep of `coins` of the group address `script` to the external address of `fvk`,
/// less the fee. `anchor` is a recent Ironwood root of the wallet, for the dummy spends of the
/// padding. Returns the PCZT, the value that arrives, the fee and the number of inputs.
pub(crate) fn build_sweep<P: Parameters>(
    params: P,
    terms: &Terms,
    (fvk, anchor): (&FullViewingKey, orchard::Anchor),
    coins: &[Coin],
    (address, redeem): &(TransparentAddress, Redeem),
) -> R<(Pczt, u64, u64, usize)> {
    let (coins, fee) = pick_coins(coins.to_vec(), input_size(redeem)?)?;
    let total: u64 = coins.iter().map(|c| c.value).sum();
    let mut b = Builder::new(params, terms.target, BuildConfig::Standard {
        sapling_anchor: None,
        orchard_anchor: None,
        ironwood_anchor: Some(anchor),
        orchard_padding: BundlePadding::DEFAULT,
        ironwood_padding: BundlePadding::DEFAULT,
    });
    if let Some(expiry) = terms.expiry {
        b = b.with_expiry_height(expiry);
    }
    let z = |v: u64| Zatoshis::from_u64(v).map_err(e("value"));
    for c in &coins {
        let coin = TxOut::new(z(c.value)?, address.script().into());
        b.add_transparent_p2sh_input(redeem.clone().weaken(), c.outpoint()?, coin)
            .map_err(e("builder"))?;
    }
    let (ovk, to) = (fvk.to_ovk(Scope::External), fvk.address_at(0u32, Scope::External));
    b.add_ironwood_output::<zip317::FeeRule>(Some(ovk), to, z(total - fee)?, MemoBytes::empty())
        .map_err(e("builder"))?;
    let PcztResult { pczt_parts, .. } =
        b.build_for_pczt(rng(), &zip317::FeeRule::standard()).map_err(e("build_for_pczt"))?;
    let pczt = Creator::build_from_parts(pczt_parts).ok_or("creator failed")?;
    let pczt = IoFinalizer::new(pczt).finalize_io(rng()).map_err(e("io finalizer"))?;
    Ok((pczt, total - fee, fee, coins.len()))
}

/// What a checked sweep does.
struct Swept {
    inputs: usize,
    total: u64,
    value: u64,
    fee: u64,
}

/// The number and the sum of the inputs of `p`. Each one spends from the group address with the
/// group script and signs the whole transaction.
fn sweep_inputs(p: &Pczt, (address, redeem): &(TransparentAddress, Redeem)) -> R<(usize, u64)> {
    let (want_pk, want_rs) = (address.script().to_bytes(), redeem.to_bytes());
    let mut sum = (0usize, 0u64);
    let check = |b: &zcash_transparent::pczt::Bundle| -> Result<(), TransparentError<String>> {
        for (i, input) in b.inputs().iter().enumerate() {
            let fail = |m: &str| TransparentError::Custom(format!("input {i} {m}"));
            if input.script_pubkey().to_bytes() != want_pk {
                return Err(fail("spends from another address than the group address"));
            }
            if input.redeem_script().as_ref().map(|r| r.to_bytes()) != Some(want_rs.clone()) {
                return Err(fail("has another script than the group script"));
            }
            if *input.sighash_type() != SighashType::ALL {
                return Err(fail("signs less than the whole transaction"));
            }
            if !input.partial_signatures().is_empty() {
                return Err(fail("carries signatures already"));
            }
            sum.0 += 1;
            sum.1 = sum.1.checked_add(input.value().into_u64()).ok_or_else(|| fail("overflows"))?;
        }
        Ok(())
    };
    Verifier::new(p.clone()).with_transparent(check).map_err(|x| match x {
        TransparentError::Custom(m) => m,
        other => format!("the transparent inputs do not parse: {other:?}"),
    })?;
    ensure(sum.0 > 0, "a move spends at least one payment of the group address")?;
    Ok(sum)
}

/// The one Ironwood output of `p` that carries value: its action, its value, and the number of
/// actions. It pays the external address of `fvk`, every spend is a dummy of value 0, and the
/// outgoing viewing key of the wallet opens it, so the wallet finds the note.
fn sweep_output(p: &Pczt, fvk: &FullViewingKey) -> R<(usize, u64, usize)> {
    let ext = fvk.address_at(0u32, Scope::External);
    let (mut found, mut actions) = (vec![], 0);
    let check = |b: &orchard::pczt::Bundle| -> Result<(), OrchardError<Custom>> {
        for (i, a) in b.actions().iter().enumerate() {
            let fail = |m: &str| OrchardError::Custom(Custom(format!("action {i} {m}")));
            a.verify_cv_net()?;
            actions += 1;
            let (s, o) = (a.spend(), a.output());
            let (sv, ov) = s.value().zip(*o.value()).ok_or_else(|| fail("has no value"))?;
            if sv.inner() != 0 {
                return Err(fail("spends a note"));
            }
            if ov.inner() == 0 {
                continue;
            }
            o.verify_note_commitment(s)?;
            if *o.recipient() != Some(ext) {
                return Err(fail("pays another address than this wallet"));
            }
            found.push((i, ov.inner()));
        }
        Ok(())
    };
    Verifier::new(p.clone()).with_ironwood(check)
        .map_err(|x| format!("the shielded part of the move does not check: {x:?}"))?;
    let [(i, value)] = found[..] else {
        return Err("a move pays exactly one shielded output to this wallet".into());
    };
    let opens = super::memo::recover(p, fvk)?.contains_key(&("Ironwood".to_string(), i));
    ensure(opens, "the output of the move does not open with the keys of this wallet")?;
    Ok((i, value, actions))
}

/// Checks that `p` moves payments of the group address to this wallet and nothing else.
fn check_sweep(
    p: &Pczt, script: &(TransparentAddress, Redeem), fvk: &FullViewingKey, net: Network,
) -> R<Swept> {
    ensure(super::sighash(p)?.0 == TxVersion::V6, "a move is a version 6 transaction")?;
    ensure(super::pczt_network(p)? == net, "the move is for another network")?;
    ensure(*p.global().expiry_height() != 0, "the transaction never expires")?;
    let s = p.sapling();
    ensure(s.spends().is_empty() && s.outputs().is_empty(), "the transaction has a Sapling part")?;
    ensure(p.orchard().actions().is_empty(), "a move has no Orchard part")?;
    ensure(p.transparent().outputs().is_empty(), "a move has no transparent output")?;
    let (inputs, total) = sweep_inputs(p, script)?;
    let (_, value, actions) = sweep_output(p, fvk)?;
    // More inputs or padded actions would raise the fee that the miners get.
    ensure(inputs <= MAX_SWEEP_INPUTS, &format!("a move spends at most {MAX_SWEEP_INPUTS} \
        payments, not {inputs}"))?;
    ensure(actions == SWEEP_ACTIONS, &format!("a move has {SWEEP_ACTIONS} shielded actions, \
        not {actions}"))?;
    let fee = sweep_fee(inputs, input_size(&script.1)?, actions)?;
    let paid = total.checked_sub(value);
    let paid_text = paid.map_or("less than 0".into(), |f| f.to_string());
    ensure(paid == Some(fee), &format!(
        "the move pays a fee of {paid_text} zat, not the ZIP 317 fee of {fee} zat"))?;
    Ok(Swept { inputs, total, value, fee })
}

/// The group of a move, as JSON {t, keys, key_package} from the page: `t`, `keys` and the key
/// package of one seat of this device, as for `p2sh_address`.
#[derive(Deserialize)]
pub(crate) struct Group {
    pub(crate) t: u32,
    pub(crate) keys: Vec<String>,
    pub(crate) key_package: String,
}

impl Group {
    pub(crate) fn script(&self, net: &Network) -> R<(TransparentAddress, Redeem)> {
        group_script(self.t, &self.keys, &self.key_package, net)
    }
}

fn group_of(json: &str) -> R<Group> {
    serde_json::from_str(json).map_err(|_| "the group is no JSON {t, keys, key_package}".into())
}

/// The digest of the PCZT text of a move. An approval names it: the txid does not cover the value
/// and the script of each input (ZIP 244), and a move with other values could keep the txid.
fn move_digest(pczt: &str) -> String {
    let h = blake2b_simd::Params::new().hash_length(32).personal(b"Zigs_SweepMove01")
        .hash(pczt.as_bytes());
    hex::encode(h.as_bytes())
}

/// The keys of a check: the PCZT, the group script and the viewing key of the wallet.
fn sweep_parts(
    pczt: &str, group: &Group, fvk: &str, net: &str,
) -> R<(Pczt, (TransparentAddress, Redeem), FullViewingKey, Network)> {
    let net = network(net)?;
    let script = group.script(&net)?;
    Ok((pczt_from_b64(pczt)?, script, parse_fvk(fvk)?, net))
}

/// The check of a sweep that each device runs before it signs, with the group and the viewing key
/// of the wallet. Returns JSON {inputs, total, value, fee, txid, digest, expiry_height}.
pub fn sweep_check(pczt: &str, group: &Group, fvk: &str, net: &str) -> R<String> {
    let (p, script, fvk, net) = sweep_parts(pczt, group, fvk, net)?;
    let s = check_sweep(&p, &script, &fvk, net)?;
    Ok(json!({"inputs": s.inputs, "total": s.total, "value": s.value, "fee": s.fee,
        "txid": super::txid_of(&p)?, "digest": move_digest(pczt),
        "expiry_height": p.global().expiry_height()})
    .to_string())
}

/// Checks the sweep (`sweep_check`) and its expiry against the chain height `tip`, then signs each
/// input with the key of the seat of `group`. ZIP 244 binds each signature to the whole
/// transaction and to the value and the script of every input, so the device needs no read of the
/// payments. Returns JSON {digest, key (hex), signatures: [hex, one per input: DER and the sighash
/// type]}.
pub fn sweep_sign(pczt: &str, group: &Group, fvk: &str, net: &str, tip: u32) -> R<String> {
    let (p, script, fvk, net) = sweep_parts(pczt, group, fvk, net)?;
    let s = check_sweep(&p, &script, &fvk, net)?;
    super::expiry::check(&p, tip)?;
    let sk = account_key(&group.key_package, &net)?
        .derive_signing_key(zip32::Scope::External, NonHardenedChildIndex::ZERO);
    let key = sk.public_key().serialize();
    let mut signer = Signer::new(p).map_err(e("signer"))?;
    for i in 0..s.inputs {
        signer.sign_transparent(i, &sk).map_err(e("sign"))?;
    }
    let mut sigs = vec![];
    let read = |b: &zcash_transparent::pczt::Bundle| -> Result<(), TransparentError<String>> {
        for input in b.inputs() {
            let sig = input.partial_signatures().get(&key);
            sigs.push(sig.map(hex::encode).ok_or(TransparentError::Custom("unsigned".into()))?);
        }
        Ok(())
    };
    Verifier::new(signer.finish()).with_transparent(read).map_err(e("signatures"))?;
    Ok(json!({"digest": move_digest(pczt), "key": hex::encode(key), "signatures": sigs})
        .to_string())
}

/// Appends the signatures of one seat ({key, signatures}) to `signer`: one for each of the
/// `inputs` inputs. A signature that is no DER signature of the whole transaction, or that does
/// not verify, fails with its key and input.
fn append_set(signer: &mut Signer, set: &Value, inputs: usize) -> R<()> {
    let key = set["key"].as_str().unwrap_or("?");
    let list = set["signatures"].as_array().filter(|l| l.len() == inputs);
    let list = list.ok_or_else(|| format!("key {key} sent no signature for each input"))?;
    for (i, sig) in list.iter().enumerate() {
        let fail = |m: &str| format!("the signature of key {key} on input {i} {m}");
        let bytes = sig.as_str().and_then(|h| hex::decode(h).ok());
        let bytes = bytes.ok_or_else(|| fail("is no hex"))?;
        let Some((&kind, der)) = bytes.split_last() else { return Err(fail("is empty")) };
        let whole = fail("signs less than the whole transaction");
        ensure(kind == SighashType::ALL.encode(), &whole)?;
        let sig = secp256k1::ecdsa::Signature::from_der(der).map_err(|_| fail("is no DER"))?;
        signer.append_transparent_signature(i, sig).map_err(|_| fail("does not verify"))?;
    }
    Ok(())
}

/// Checks that one seat's set ({key, signatures}) signs every one of the `inputs` inputs of `p`
/// with the key that it names. A set that copies the signatures of another key fails.
fn verified_set(p: &Pczt, set: &Value, inputs: usize) -> R<()> {
    let mut trial = Signer::new(p.clone()).map_err(e("signer"))?;
    append_set(&mut trial, set, inputs)?;
    let text = set["key"].as_str().unwrap_or("?");
    let key = hex::decode(text).ok().and_then(|k| <[u8; 33]>::try_from(k).ok());
    let key = key.ok_or_else(|| format!("the key {text} of a signature set is no public key"))?;
    let own = |b: &zcash_transparent::pczt::Bundle| -> Result<(), TransparentError<String>> {
        let all = b.inputs().iter().all(|i| i.partial_signatures().contains_key(&key));
        all.then_some(()).ok_or(TransparentError::Custom(String::new()))
    };
    Verifier::new(trial.finish()).with_transparent(own)
        .map_err(|_| format!("the signatures of key {text} are not signatures of that key"))?;
    Ok(())
}

/// Finishes the sweep with the signatures of `t` seats: the proof, the script of each input and
/// the transaction. `signatures` is JSON [{key, signatures}], as `sweep_sign` gives them. A set
/// that does not verify, or a second set of one key, is skipped, so one seat cannot block the
/// others. Fewer than `t` good sets fail before the proof, with the reason of each bad set.
/// Returns the JSON of `finalize`.
pub fn sweep_finish(pczt: &str, signatures: &str, t: usize) -> R<String> {
    let sets: Vec<Value> =
        serde_json::from_str(signatures).map_err(|_| "the signatures are no JSON")?;
    let p = pczt_from_b64(pczt)?;
    let inputs = p.transparent().inputs().len();
    let (mut good, mut keys, mut bad) = (vec![], HashSet::new(), vec![]);
    for set in sets.iter().filter(|set| set["key"].is_string()) {
        let key = set["key"].as_str().unwrap_or("?");
        if good.len() == t || keys.contains(key) {
            continue;
        }
        match verified_set(&p, set, inputs) {
            Ok(()) => { keys.insert(key); good.push(set); }
            Err(why) => bad.push(why),
        }
    }
    if good.len() < t {
        return Err(format!("{} of the {t} signature sets that the move needs verify. {}",
            good.len(), bad.join("; ")));
    }
    let mut signer = Signer::new(p).map_err(e("signer"))?;
    for set in good {
        append_set(&mut signer, set, inputs)?;
    }
    super::finalize(&pczt_to_b64(signer.finish())?)
}

#[wasm_bindgen(js_name = sweepCheck)]
pub fn js_sweep_check(pczt: &str, group: &str, fvk: &str, net: &str) -> Result<String, JsError> {
    super::js(group_of(group).and_then(|g| sweep_check(pczt, &g, fvk, net)))
}

#[wasm_bindgen(js_name = sweepSign)]
pub fn js_sweep_sign(
    pczt: &str, group: &str, fvk: &str, net: &str, tip: u32,
) -> Result<String, JsError> {
    super::js(group_of(group).and_then(|g| sweep_sign(pczt, &g, fvk, net, tip)))
}

#[wasm_bindgen(js_name = sweepFinish)]
pub fn js_sweep_finish(pczt: &str, signatures: &str, t: u32) -> Result<String, JsError> {
    super::js(sweep_finish(pczt, signatures, t as usize))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A key package of the form of the apps, with the share `s` and the group key `g`.
    fn package(s: u8, g: u8) -> String {
        json!({"signing_share": hex::encode([s; 32]), "verifying_key": hex::encode([g; 32]),
            "identifier": "01", "min_signers": 2})
        .to_string()
    }

    fn address_of(out: &str) -> String {
        serde_json::from_str::<Value>(out).unwrap()["address"].as_str().unwrap().to_string()
    }

    #[test]
    fn three_seats_make_one_two_of_three_address() {
        let packages = [package(1, 9), package(2, 9), package(3, 9)];
        let keys: Vec<String> = packages.iter().map(|p| p2sh_key(p, "mainnet").unwrap()).collect();
        assert!(keys[0].starts_with('['), "a key with its origin: {}", keys[0]);
        assert!(keys[0].contains("/48'/133'/0'/133000']xpub"), "{}", keys[0]);
        let first = address_of(&p2sh_address(2, &keys, &packages[0], "mainnet").unwrap());
        assert!(first.starts_with("t3"), "{first}");
        // Every seat makes the same address, in any order of the keys.
        let mut turned = keys.clone();
        turned.reverse();
        for p in &packages[1..] {
            assert_eq!(address_of(&p2sh_address(2, &turned, p, "mainnet").unwrap()), first);
        }
        // Another threshold, another group key or another network makes another address.
        assert_ne!(address_of(&p2sh_address(3, &keys, &packages[0], "mainnet").unwrap()), first);
        let other: Vec<String> = [package(1, 8), package(2, 8), package(3, 8)].iter()
            .map(|p| p2sh_key(p, "mainnet").unwrap()).collect();
        assert_ne!(other[0], keys[0], "the group key goes into the seed");
        let test: Vec<String> = packages.iter().map(|p| p2sh_key(p, "testnet").unwrap()).collect();
        let testnet = address_of(&p2sh_address(2, &test, &packages[0], "testnet").unwrap());
        assert!(testnet.starts_with("t2"), "{testnet}");
    }

    #[test]
    fn a_bad_key_set_is_refused() {
        let packages = [package(1, 9), package(2, 9), package(3, 9)];
        let keys: Vec<String> = packages.iter().map(|p| p2sh_key(p, "mainnet").unwrap()).collect();
        let err = |t: u32, keys: &[String], p: &str| {
            p2sh_address(t, keys, p, "mainnet").unwrap_err()
        };
        assert!(err(0, &keys, &packages[0]).contains("threshold 0"));
        assert!(err(4, &keys, &packages[0]).contains("threshold 4"));
        assert!(err(1, &keys, &packages[0]).contains("threshold 1"));
        assert!(err(2, &[], &packages[0]).contains("1 to 15 keys"));
        assert!(err(2, &vec![keys[0].clone(); 16], &packages[0]).contains("not 16"));
        let not_mine = [keys[1].clone(), keys[2].clone()];
        assert!(err(2, &not_mine, &packages[0]).contains("0 times"));
        let twice = [keys[0].clone(), keys[0].clone(), keys[2].clone()];
        assert!(err(2, &twice, &packages[0]).contains("2 times"));
        let copied = [keys[0].clone(), keys[1].clone(), keys[1].clone()];
        assert!(err(2, &copied, &packages[0]).contains("one seat could sign twice"));
        let test = p2sh_key(&packages[1], "testnet").unwrap();
        let wrong_net = [keys[0].clone(), test, keys[2].clone()];
        assert!(err(2, &wrong_net, &packages[0]).contains("key 2 is no ZIP 48 key"));
        assert!(p2sh_key("{}", "mainnet").unwrap_err().contains("no signing_share"));
        let short = json!({"signing_share": "0102", "verifying_key": hex::encode([9; 32])});
        assert!(p2sh_key(&short.to_string(), "mainnet").unwrap_err().contains("wrong length"));
    }
}
