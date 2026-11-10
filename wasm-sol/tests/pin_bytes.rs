//! Every byte of `nullifier_pk` (32) and `viewing_pk` (33) counts in every comparison with a pin.
//! A wrong pin is also refused by other rules (the ciphertext of the change output, the owner
//! hash, the template), so a test that only says "refused" cannot tell a comparison of all bytes
//! from a comparison of 31 of 32 or 32 of 33. These tests change one byte of one key and require
//! the named rule of that comparison in the answer (`mutate.py` cases `pin-*`).
//! Nothing here compares a secret with `assert_eq!`: a failure would print it.

mod common;

use common::fixture::*;
use common::NOW;
use p3_check::approve::{approve, Device};
use p3_check::consts::Key;
use p3_check::hashes::owner_hash;
use p3_check::intent::Intent;
use p3_check::pins::Pins;
use p3_check::plan::Plan;
use p3_check::rule::Rule::{self, *};
use p3_check::snapshot::Snapshot;

type Keys = (Key, [u8; 33]);

/// The rules, each with its detail, that refuse `bytes` for an intent on this device.
fn faults(intent: &Intent, bytes: &[u8], pins: &Pins, snapshot: &Snapshot) -> Vec<(Rule, String)> {
    let device = Device {
        pins,
        snapshot,
        now: NOW,
    };
    match approve(bytes, intent, &Plan::default(), &device) {
        Ok(_) => Vec::new(),
        Err(refusal) => refusal
            .violations
            .into_iter()
            .map(|v| (v.rule, v.detail))
            .collect(),
    }
}

/// The keys with one bit of `nullifier_pk` byte `at` flipped, or of `viewing_pk` byte `at - 32`.
fn flipped(keys: &Keys, nullifier: bool, at: usize, mask: u8) -> Keys {
    let mut out = *keys;
    if nullifier {
        out.0[at] ^= mask;
    } else {
        out.1[at] ^= mask;
    }
    out
}

/// A mask for byte `at` of `nullifier_pk` that leaves a field element (`approve` refuses
/// another value as `plan-invalid` before it compares the pins).
fn field_mask(keys: &Keys, at: usize) -> u8 {
    (0..8)
        .map(|bit| 1u8 << bit)
        .find(|mask| owner_hash(&GROUP, &flipped(keys, true, at, *mask).0).is_ok())
        .unwrap_or_else(|| panic!("no bit of nullifier_pk byte {at} keeps a field element"))
}

#[test]
fn every_byte_of_the_pinned_viewing_pk_is_compared_with_the_viewing_scalar() {
    let f = Fixture::build(&Spec::transfer());
    for at in 0..33 {
        let mut pins = f.pins.clone();
        pins.viewing_pk = flipped(&(pins.nullifier_pk, pins.viewing_pk), false, at, 1).1;
        let found = faults(&f.intent, &f.bytes(), &pins, &f.snapshot);
        assert!(
            found.iter().any(|(rule, _)| *rule == GroupViewingPk),
            "viewing_pk byte {at}: {found:?}"
        );
    }
}

#[test]
fn every_byte_of_the_pinned_nullifier_pk_is_compared_with_the_nullifier_secret() {
    let f = Fixture::build(&Spec::transfer());
    let keys = (f.pins.nullifier_pk, f.pins.viewing_pk);
    for at in 0..32 {
        let mut pins = f.pins.clone();
        pins.nullifier_pk = flipped(&keys, true, at, field_mask(&keys, at)).0;
        let found = faults(&f.intent, &f.bytes(), &pins, &f.snapshot);
        assert!(
            found.iter().any(|(rule, _)| *rule == GroupNullifierPk),
            "nullifier_pk byte {at}: {found:?}"
        );
    }
}
