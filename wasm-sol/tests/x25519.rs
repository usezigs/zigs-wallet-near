//! The X25519 viewing key against the vectors of privacy-rings at 3c018b82
//! (`vectors/upstream/key_derivation.json`, a copy of `test-vectors/key_derivation.json`), the
//! clamp, and the refusal of peer keys that are not X25519 keys. The secrets are compared with
//! `assert!(a == b)`, so a failure prints nothing of them.

use p3_check::codec::unhex_array;
use p3_check::consts::Key;
use p3_check::hashes::nullifier_pk;
use p3_check::roles::secrets;
use p3_check::viewing::{clamp, ViewingKey};
use serde_json::Value;

fn upstream() -> Value {
    let path = format!(
        "{}/vectors/upstream/key_derivation.json",
        env!("CARGO_MANIFEST_DIR")
    );
    serde_json::from_slice(&std::fs::read(path).unwrap()).unwrap()
}

fn field<const N: usize>(v: &Value, key: &str) -> [u8; N] {
    unhex_array(v[key].as_str().unwrap(), key).unwrap()
}

fn pk(secret: &Key) -> [u8; 33] {
    ViewingKey::from_bytes(secret).public()
}

#[test]
fn the_public_key_of_every_upstream_viewing_secret_is_the_upstream_key() {
    let all = upstream();
    let rail = &all["eddsa_rail"];
    assert!(pk(&field(rail, "viewing_secret")) == field::<33>(rail, "viewing_pubkey"));
    let counters = all["counter_view_tags"].as_array().unwrap();
    assert!(!counters.is_empty());
    for case in counters {
        assert!(pk(&field(case, "viewing_secret")) == field::<33>(case, "viewing_pubkey"));
    }
}

#[test]
fn the_transaction_key_of_the_upstream_vector_has_the_upstream_public_key() {
    let t = &upstream()["tx_viewing"];
    let key = ViewingKey::from_bytes(&field(t, "viewing_secret"));
    let tx_key = key.tx_key(&field(t, "first_nullifier")).unwrap();
    assert!(tx_key.public() == field::<33>(t, "tx_viewing_pubkey"));
}

#[test]
fn the_slot_cipher_equals_the_upstream_hpke_vector() {
    let h = &upstream()["hpke_utxo"];
    let eph = ViewingKey::from_bytes(&field(h, "ephemeral_secret"));
    let recipient = pk(&field(h, "recipient_secret"));
    let plain = unhex_vec(h, "plaintext");
    let slot = u32::try_from(h["slot_index"].as_u64().unwrap()).unwrap();
    let got = eph
        .slot_cipher(&recipient, &plain, &field(h, "salt"), slot)
        .unwrap();
    assert_eq!(got, unhex_vec(h, "ciphertext"));
}

fn unhex_vec(v: &Value, key: &str) -> Vec<u8> {
    p3_check::codec::unhex(v[key].as_str().unwrap(), key).unwrap()
}

#[test]
fn the_nullifier_key_of_the_upstream_vector_is_unchanged() {
    let rail = &upstream()["eddsa_rail"];
    let got = nullifier_pk(&field(rail, "nullifier_secret")).unwrap();
    assert!(got == field::<32>(rail, "nullifier_pubkey"));
}

#[test]
fn the_clamp_clears_three_low_bits_and_bit_255_and_sets_bit_254() {
    assert_eq!(clamp([0xff; 32])[0], 0xf8);
    assert_eq!(clamp([0xff; 32])[31], 0x7f);
    assert_eq!(clamp([0; 32])[0], 0);
    assert_eq!(clamp([0; 32])[31], 0x40);
    let mut middle = [0x5a; 32];
    middle[0] = 0x07;
    middle[31] = 0x80;
    let out = clamp(middle);
    assert_eq!((out[0], out[31]), (0, 0x40));
    assert!(out[1..31] == middle[1..31]);
}

#[test]
fn secrets_that_clamp_to_the_same_bytes_are_one_key() {
    let mut other = [7u8; 32];
    other[0] |= 0x07;
    other[31] |= 0x80;
    let base = {
        let mut b = other;
        b[0] &= 0xf8;
        b[31] = (b[31] & 0x7f) | 0x40;
        b
    };
    assert!(pk(&other) == pk(&base));
    let first = [9u8; 32];
    let a = ViewingKey::from_bytes(&other).tx_key(&first).unwrap();
    let b = ViewingKey::from_bytes(&base).tx_key(&first).unwrap();
    assert!(a.public() == b.public());
}

#[test]
fn the_viewing_secret_of_a_seed_is_clamped_and_has_the_new_label() {
    for seed in [[0u8; 32], [0xff; 32], [0x42; 32]] {
        let (_, viewing_sk) = secrets(&seed).unwrap();
        assert!(clamp(viewing_sk) == viewing_sk);
        assert_eq!(pk(&viewing_sk)[0], 4);
    }
    // Another label would give another key: the old P-256 label no longer derives one.
    let (_, new) = secrets(&[0x42; 32]).unwrap();
    let old = {
        use hkdf::Hkdf;
        let mut okm = [0u8; 32];
        Hkdf::<sha2::Sha256>::new(None, &[0x42; 32])
            .expand(b"zigs-sol/viewing-scalar/v1", &mut okm)
            .unwrap();
        clamp(okm)
    };
    assert!(new != old);
}

#[test]
fn a_peer_that_is_not_a_canonical_x25519_key_is_refused() {
    let me = ViewingKey::from_bytes(&[3; 32]);
    let good = pk(&[5; 32]);
    let salt = [1u8; 16];
    let cipher = |peer: &[u8; 33]| me.slot_cipher(peer, b"x", &salt, 0);
    assert!(cipher(&good).is_ok());
    let mut tagged = good;
    for tag in [0u8, 2, 3, 5] {
        tagged[0] = tag;
        assert!(cipher(&tagged).is_err(), "tag {tag}");
    }
    let mut alias = good;
    alias[32] |= 0x80;
    assert!(cipher(&alias).is_err(), "bit 255 set");
    let mut modulus = [0xffu8; 33];
    modulus[0] = 4;
    modulus[1] = 237;
    modulus[32] = 127;
    assert!(cipher(&modulus).is_err(), "u = 2^255 - 19");
    for u0 in [0u8, 1] {
        let mut low_order = [0u8; 33];
        low_order[0] = 4;
        low_order[1] = u0;
        assert!(cipher(&low_order).is_err(), "low order u = {u0}");
    }
}
