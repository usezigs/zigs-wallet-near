//! The known-answer vectors of privacy-rings at 3c018b82 (`vectors/upstream/`, copies of
//! `test-vectors/private_tx_hash.json`, `transact_derivation.json` and `dummy_owner_tags.json`)
//! against the Rust hashes. The upstream values do not come from this code, so no check here is
//! circular. `program::private_tx_hash` takes the root seed and derives the blinding itself, so
//! the vectors with a free blinding go through the same Poseidon of this crate and a local chain.

mod common;

use common::ts::{self, vectors_in};
use p3_check::codec::unhex_array;
use p3_check::consts::Key;
use p3_check::hashes::{dummy_hash, output_blinding, output_seed, owner_identity, poseidon};
use p3_check::plan::Role;
use p3_check::transact::OwnerTag;
use serde_json::Value;
use sha2::{Digest, Sha256};
use spr_hasher::primitives::hash_bytes;

fn upstream(name: &str) -> Value {
    let path = format!(
        "{}/vectors/upstream/{name}.json",
        env!("CARGO_MANIFEST_DIR")
    );
    serde_json::from_slice(&std::fs::read(path).unwrap()).unwrap()
}

fn key(v: &Value, name: &str) -> Key {
    unhex_array(v[name].as_str().unwrap(), name).unwrap()
}

/// A small integer as a right-aligned big-endian field element.
fn small(n: u64) -> Key {
    let mut out = [0u8; 32];
    out[24..].copy_from_slice(&n.to_be_bytes());
    out
}

/// The nonzero hash chain of `nonzero_hash_chain.json`: zeros are skipped, the first nonzero
/// value starts the chain and each later one is folded in with a Poseidon of two.
fn chain(values: &Value) -> Key {
    let mut hash = [0u8; 32];
    for value in values.as_array().unwrap() {
        let value: Key = unhex_array(value.as_str().unwrap(), "chain").unwrap();
        if value == [0; 32] {
            continue;
        }
        hash = if hash == [0; 32] {
            value
        } else {
            poseidon(&[&hash, &value]).unwrap()
        };
    }
    hash
}

#[test]
fn the_private_tx_hash_and_the_message_hash_equal_the_upstream_values() {
    let all = upstream("private_tx_hash");
    let all = all["vectors"].as_array().unwrap();
    assert!(all.len() >= 9, "{} vectors", all.len());
    for v in all {
        let name = v["name"].as_str().unwrap();
        let got = poseidon(&[
            &chain(&v["input_hashes"]),
            &chain(&v["output_hashes"]),
            &chain(&v["address_nullifiers"]),
            &key(v, "blinding"),
        ])
        .unwrap();
        assert!(got == key(v, "private_tx_hash"), "{name}: private_tx_hash");
        let message: Key = Sha256::new()
            .chain_update(got)
            .chain_update(key(v, "external_data_hash"))
            .finalize()
            .into();
        assert!(message == key(v, "message_hash"), "{name}: message_hash");
    }
}

#[test]
fn the_derivation_of_blindings_and_owner_identities_equals_the_upstream_values() {
    let v = upstream("transact_derivation");
    let id = &v["owner_identity"];
    let pubkey = key(id, "solana_pubkey");
    assert!(owner_identity(&pubkey).unwrap() == key(id, "solana_owner_identity"));
    let input: [u8; 33] =
        unhex_array(id["hash_bytes_33_input"].as_str().unwrap(), "input").unwrap();
    assert!(hash_bytes(&input).unwrap() == key(id, "hash_bytes_33"));

    let b = &v["blinding_seed"];
    let (first, root) = (
        small(b["first_nullifier"].as_u64().unwrap()),
        b["blinding_seed"].as_u64(),
    );
    let root = small(root.unwrap());
    let slot = b["output_index"].as_u64().unwrap() as u32;
    let seed = output_seed(&first, &root).unwrap();
    assert!(seed == key(b, "output_blinding_seed"), "output seed");
    let derived = output_blinding(&first, &seed, slot).unwrap();
    assert!(
        derived == key(b, "output_blinding_derived"),
        "blinding of the derived seed"
    );
    let primitive = output_blinding(&first, &root, slot).unwrap();
    assert!(
        primitive == key(b, "output_blinding"),
        "blinding of the root seed"
    );

    let d = &v["dummy_utxo_hash"];
    let blinding = small(d["blinding"].as_u64().unwrap());
    let got = dummy_hash(&blinding, d["tree_id"].as_u64().unwrap() as u16).unwrap();
    assert!(got == key(d, "hash"), "dummy utxo hash");
}

/// The public key of the Ed25519 key that fills 32 bytes with `seed`.
fn public_of(seed: u64) -> Key {
    let secret = [seed as u8; 32];
    ed25519_dalek::SigningKey::from_bytes(&secret)
        .verifying_key()
        .to_bytes()
}

#[test]
fn a_sponsored_transfer_tags_its_dummies_with_the_sender_as_the_upstream_case_does() {
    let up = upstream("dummy_owner_tags");
    let case = up["cases"]
        .as_array()
        .unwrap()
        .iter()
        .find(|c| c["name"] == "sponsored with change")
        .unwrap();
    assert!(case["owner_tag_kind"] == "inline");
    let sender = public_of(up["sender_seed"].as_u64().unwrap());
    assert!(
        key(case, "resolved") == sender,
        "the tag is the key of the sender"
    );
    let mut dummies = 0;
    for v in vectors_in("ts").into_iter().chain(vectors_in("pay")) {
        let sender =
            OwnerTag::Inline(unhex_array(v.json["group"]["key"].as_str().unwrap(), "key").unwrap());
        let outputs = v.json["outputs"].as_array().unwrap();
        for dummy in outputs.iter().filter(|o| ts::role_of(o) == Role::Dummy) {
            assert!(
                ts::tag_of(dummy) == sender,
                "{}: the tag of a dummy",
                v.name
            );
            dummies += 1;
        }
    }
    assert!(dummies >= 4, "{dummies} dummy outputs");
}
