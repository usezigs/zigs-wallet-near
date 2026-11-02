//! The transparent address of a group wallet: a P2SH multisig address (ZIP 48, `sortedmulti`).
//! Each seat holds one secp256k1 account key, and a spend needs the signatures of `t` seats.
//! The key of a seat comes from the secret share of its FROST key package, so a backup of the
//! key share also restores it. The secret key never leaves the engine.

use std::{collections::HashSet, num::NonZeroU8};

use serde_json::{json, Value};
use wasm_bindgen::prelude::*;
use zcash_protocol::consensus::Network;
use zcash_transparent::{keys::NonHardenedChildIndex, zip48};

use zcash_script::script::Evaluable as _;

use super::{network, R};

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

/// The P2SH address of the group: `t` signatures (at least 2) of the `keys` of all seats (the
/// published key information expressions, in any order). The key of this seat (`key_package`)
/// must be among them exactly once, and no two seats may have the same key: a key twice in the
/// script would let one seat give two of the `t` signatures. Returns JSON {address,
/// redeem_script (hex)}.
pub fn p2sh_address(t: u32, keys: &[String], key_package: &str, net: &str) -> R<String> {
    let net = network(net)?;
    if keys.is_empty() || keys.len() > MAX_KEYS {
        return Err(format!("a group address needs 1 to {MAX_KEYS} keys, not {}", keys.len()));
    }
    // One signature would let one seat spend alone.
    let fits = |t: &NonZeroU8| (2..=keys.len()).contains(&usize::from(t.get()));
    let threshold = u8::try_from(t).ok().and_then(NonZeroU8::new).filter(fits);
    let threshold = threshold.ok_or(format!("the threshold {t} does not fit {} keys", keys.len()))?;
    let parse = |(i, k): (usize, &String)| {
        zip48::AccountPubKey::parse_key_info_expression(k, &net)
            .ok_or(format!("key {} is no ZIP 48 key of this network", i + 1))
    };
    let parsed = keys.iter().enumerate().map(parse).collect::<R<Vec<_>>>()?;
    let own = account_key(key_package, &net)?.to_account_pubkey();
    let mine = parsed.iter().filter(|k| **k == own).count();
    if mine != 1 {
        return Err(format!("the key of this device is {mine} times in the group keys, not once"));
    }
    let fvk = zip48::FullViewingKey::standard(threshold, parsed)
        .map_err(|e| format!("the group keys do not make a ZIP 48 address: {e:?}"))?;
    let (address, redeem) = fvk.derive_address(zip32::Scope::External, NonHardenedChildIndex::ZERO);
    distinct_keys(&redeem)?;
    let encoded = zcash_keys::address::Address::Transparent(address).encode(&net);
    Ok(json!({"address": encoded, "redeem_script": hex::encode(redeem.to_bytes())}).to_string())
}

/// Refuses a multisig script with the same public key twice.
fn distinct_keys(redeem: &zcash_script::script::Redeem) -> R<()> {
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
