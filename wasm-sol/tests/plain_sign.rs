//! Signing a plain message: the fee key signs the payer part and the group signs by FROST, each
//! only after the plain checker accepted the exact bytes. Also the wasm entry points of the plain
//! wallet and the wire form of the chain reads. A transaction needs two valid signatures, the fee
//! key and then the group key, and these tests verify both under `verify_strict`.

#[path = "support/ceremony.rs"]
mod ceremony;
mod common;
#[path = "support/plain.rs"]
mod support;

use std::collections::BTreeMap;

use ceremony::{map_json, unhex32, Group, WALLET};
use ed25519_dalek::{Signature, VerifyingKey};
use p3_check::bytes::hex;
use p3_check::consts::*;
use p3_check::plain::{Cluster, PlainIntent, PlainPins};
use p3_check::plain_chain::{PlainChain, Role};
use p3_check::plain_check::PlainCheck;
use p3_check::plain_sign;
use p3_check::plain_template;
use p3_check::sign::{self, Check};
use p3_check::{fee, wasm};
use serde_json::{json, Value};
use support::*;

struct Wallet {
    group: Group,
    group_key: Key,
    fee_secret: String,
    fee_public: Key,
}

fn wallet() -> Wallet {
    let group = ceremony::run(WALLET, 2, 3);
    let group_key = unhex32(&group.done[0].group_key);
    let made: Value =
        serde_json::from_str(&fee::derive(&group.done[0].key_package).unwrap()).unwrap();
    let text = |name: &str| made[name].as_str().unwrap().to_string();
    Wallet {
        group_key,
        fee_public: unhex32(&text("public")),
        fee_secret: text("secret"),
        group,
    }
}

impl Wallet {
    fn case(&self, cluster: Cluster, intent: PlainIntent) -> Case {
        Case::with_keys(cluster, intent, self.group_key, self.fee_public)
    }
}

/// The wire forms of a case, for the entries that take bytes.
struct Wire {
    intent: Vec<u8>,
    pins: Vec<u8>,
    chain: Vec<u8>,
}

impl Wire {
    fn of(case: &Case) -> Self {
        Self {
            intent: case.intent.encode(),
            pins: case.pins.wire(),
            chain: case.chain.encode(),
        }
    }

    fn check(&self) -> PlainCheck<'_> {
        PlainCheck {
            intent: &self.intent,
            pins: &self.pins,
            chain: &self.chain,
        }
    }
}

fn verifies(key: &Key, message: &[u8], signature: &[u8]) -> bool {
    let sig: [u8; 64] = signature.try_into().expect("64 bytes");
    VerifyingKey::from_bytes(key)
        .unwrap()
        .verify_strict(message, &Signature::from_bytes(&sig))
        .is_ok()
}

// ---- the fee key ------------------------------------------------------------------------------

fn fee_round(wallet: &Wallet) -> String {
    json!({"secret": wallet.fee_secret}).to_string()
}

#[test]
fn the_fee_key_signs_the_payer_part_of_every_shape_and_the_signature_verifies() {
    let wallet = wallet();
    for cluster in CLUSTERS {
        for (name, intent) in shapes() {
            let case = wallet.case(cluster, intent);
            let (message, wire) = (case.bytes(), Wire::of(&case));
            let signature = fee::sign_plain(&message, &wire.check(), &fee_round(&wallet))
                .unwrap_or_else(|why| panic!("{name} {cluster:?}: {why}"));
            assert!(
                verifies(&wallet.fee_public, &message, &hex_bytes(&signature)),
                "{name}"
            );
            assert!(
                fee::verify(&hex(&wallet.fee_public), &message, &signature).is_ok(),
                "{name}"
            );
        }
    }
}

fn hex_bytes(text: &str) -> Vec<u8> {
    p3_check::codec::unhex(text, "signature").unwrap()
}

#[test]
fn the_fee_key_signs_nothing_that_the_plain_checker_refuses() {
    let wallet = wallet();
    let case = wallet.case(Cluster::Mainnet, send_sol(recipient(), LAMPORTS));
    let wire = Wire::of(&case);
    let good = case.bytes();
    for at in (0..good.len()).step_by(7) {
        let mut bad = good.clone();
        bad[at] ^= 1;
        assert!(
            fee::sign_plain(&bad, &wire.check(), &fee_round(&wallet)).is_err(),
            "byte {at}"
        );
    }
    let refused = fee::sign_plain(
        &[good.clone(), vec![0]].concat(),
        &wire.check(),
        &fee_round(&wallet),
    );
    assert!(refused.unwrap_err().starts_with("refused\nplain-parse"));
    let mut wrong_genesis = case.clone();
    wrong_genesis.chain.genesis = DEVNET_GENESIS;
    let wire = Wire::of(&wrong_genesis);
    let why = fee::sign_plain(&good, &wire.check(), &fee_round(&wallet)).unwrap_err();
    assert!(why.contains("plain-genesis"), "{why}");
}

#[test]
fn a_fee_key_that_is_not_the_payer_of_the_pins_signs_nothing() {
    let wallet = wallet();
    let case = Case::with_keys(Cluster::Devnet, cancel(), wallet.group_key, [0x55; 32]);
    let (message, wire) = (case.bytes(), Wire::of(&case));
    let why = fee::sign_plain(&message, &wire.check(), &fee_round(&wallet)).unwrap_err();
    assert_eq!(why, "this fee key is not the payer of the proposal");
    assert!(
        fee::sign_plain(&message, &wire.check(), "{}").is_err(),
        "no secret"
    );
    assert!(fee::sign_plain(&message, &wire.check(), "not json").is_err());
}

#[test]
fn the_fee_entry_refuses_a_pool_message_and_pool_inputs() {
    let wallet = wallet();
    // The pool fee entry signs this message, for the pins that name the fee key as the payer.
    let mut fixture = common::fixture::Fixture::migration();
    fixture.pins.payer = wallet.fee_public;
    let message = fixture.bytes();
    let proposal = p3_check::plan::Proposal {
        intent: fixture.intent.clone(),
        plan: fixture.plan.clone(),
        transact: Vec::new(),
    };
    let (proposal, pool_pins, snapshot) = (
        proposal.encode().unwrap(),
        fixture.pins.wire(),
        fixture.snapshot.encode().unwrap(),
    );
    let pool = Check {
        intent: &proposal,
        pins: &pool_pins,
        snapshot: &snapshot,
    };
    let round = json!({"now": common::NOW, "secret": wallet.fee_secret}).to_string();
    assert!(
        fee::sign(&message, &pool, &round).is_ok(),
        "the pool entry signs its own message"
    );
    // The plain entry refuses the same message under every plain intent, and pool inputs.
    for (name, intent) in shapes() {
        let case = wallet.case(Cluster::Devnet, intent);
        let wire = Wire::of(&case);
        assert!(
            fee::sign_plain(&message, &wire.check(), &fee_round(&wallet)).is_err(),
            "{name}"
        );
    }
    let case = wallet.case(Cluster::Devnet, cancel());
    let wire = Wire::of(&case);
    let mixed = [
        PlainCheck {
            intent: &proposal,
            pins: &wire.pins,
            chain: &wire.chain,
        },
        PlainCheck {
            intent: &wire.intent,
            pins: &pool_pins,
            chain: &wire.chain,
        },
        PlainCheck {
            intent: &wire.intent,
            pins: &wire.pins,
            chain: &snapshot,
        },
    ];
    for check in mixed {
        let signed = fee::sign_plain(&case.bytes(), &check, &fee_round(&wallet));
        assert!(signed.is_err());
    }
}

// ---- the group share --------------------------------------------------------------------------

/// A whole signing session of `signers` for a plain message: the aggregate signature as hex.
fn session(
    wallet: &Wallet,
    signers: &[u16],
    message: &[u8],
    case: &Case,
) -> Result<String, String> {
    let wire = Wire::of(case);
    let digest = plain_sign::digest(&case.pins.wallet, message)?;
    let (mut nonces, mut commitments) = (BTreeMap::new(), BTreeMap::new());
    for seat in signers {
        let package = &wallet.group.done[usize::from(*seat) - 1].key_package;
        let made: Value = serde_json::from_str(&sign::nonces(package, &digest)?).unwrap();
        nonces.insert(*seat, made["nonces"].as_str().unwrap().to_string());
        commitments.insert(*seat, made["commitments"].as_str().unwrap().to_string());
    }
    let mut shares = BTreeMap::new();
    for seat in signers {
        let round = round(
            wallet,
            *seat,
            case.pins.wallet.label(),
            &nonces[seat],
            &commitments,
        );
        let out = plain_sign::sign_share(message, &wire.check(), &round)?;
        let out: Value = serde_json::from_str(&out).unwrap();
        shares.insert(*seat, out["share"].as_str().unwrap().to_string());
    }
    sign::aggregate(
        message,
        &wallet.group.done[0].public_key_package,
        &map_json(&commitments),
        &map_json(&shares),
    )
}

fn round(
    wallet: &Wallet,
    seat: u16,
    label: &str,
    nonces: &str,
    commitments: &BTreeMap<u16, String>,
) -> String {
    json!({
        "now": 0,
        "cluster": label,
        "keyPackage": serde_json::from_str::<Value>(
            &wallet.group.done[usize::from(seat) - 1].key_package).unwrap(),
        "nonces": nonces,
        "commitments": serde_json::from_str::<Value>(&map_json(commitments)).unwrap(),
    })
    .to_string()
}

#[test]
fn a_send_gets_two_valid_signatures_the_fee_key_first_and_the_group_key_by_frost() {
    let wallet = wallet();
    let sends = [
        send_sol(recipient(), LAMPORTS),
        send_token(recipient(), UNITS),
        cancel(),
    ];
    for cluster in CLUSTERS {
        for (at, intent) in sends.iter().enumerate() {
            let case = wallet.case(cluster, intent.clone());
            let message = case.bytes();
            let wire = Wire::of(&case);
            let payer = fee::sign_plain(&message, &wire.check(), &fee_round(&wallet)).unwrap();
            let signers = [[1u16, 2], [1, 3], [2, 3]][at];
            let group = session(&wallet, &signers, &message, &case).unwrap();
            // The transaction: signatures in the order of the account table, payer then group.
            let parsed = p3_check::v1::parse(&message).unwrap();
            assert_eq!(parsed.keys[0], wallet.fee_public);
            assert_eq!(parsed.keys[1], wallet.group_key, "the group signs second");
            assert!(verifies(&parsed.keys[0], &message, &hex_bytes(&payer)));
            assert!(verifies(&parsed.keys[1], &message, &hex_bytes(&group)));
        }
    }
}

#[test]
fn the_group_key_gets_no_share_for_a_new_nonce_or_an_enable() {
    let wallet = wallet();
    for intent in [create_nonce(), enable_token()] {
        let case = wallet.case(Cluster::Devnet, intent);
        let why = session(&wallet, &[1, 2], &case.bytes(), &case).unwrap_err();
        assert!(why.contains("plain-signer"), "{why}");
    }
}

#[test]
fn a_message_that_the_plain_checker_refuses_gets_no_share_at_any_position() {
    let wallet = wallet();
    for intent in [
        send_sol(recipient(), LAMPORTS),
        send_token(recipient(), UNITS),
    ] {
        let case = wallet.case(Cluster::Devnet, intent);
        let good = case.bytes();
        for at in 0..good.len() {
            let mut bad = good.clone();
            bad[at] ^= 1;
            // The nonces are made for the changed bytes, so only the checker can refuse. Two
            // seats are enough for the threshold, so no later step could be the cause.
            let why = session(&wallet, &[1, 2], &bad, &case).unwrap_err();
            assert!(why.starts_with("refused\nplain-"), "byte {at}: {why}");
        }
        assert!(session(&wallet, &[1, 2], &good, &case).is_ok());
    }
}

#[test]
fn nonces_of_another_message_another_label_or_the_pool_digest_get_no_share() {
    let wallet = wallet();
    let case = wallet.case(Cluster::Devnet, send_sol(recipient(), LAMPORTS));
    let (message, wire) = (case.bytes(), Wire::of(&case));
    let other = case.clone().lamports(Role::Payer, 20_000_000_000);
    let other = {
        let mut other = other;
        other.intent = send_sol(recipient(), LAMPORTS + 1);
        other.bytes()
    };
    let digests = [
        (
            "another message",
            plain_sign::digest(&case.pins.wallet, &other).unwrap(),
        ),
        ("the pool digest", sign::digest("devnet", &message).unwrap()),
        (
            "a mainnet digest",
            plain_sign::digest(&pins(Cluster::Mainnet).wallet, &message).unwrap(),
        ),
    ];
    for (name, digest) in digests {
        let package = &wallet.group.done[0].key_package;
        let made: Value = serde_json::from_str(&sign::nonces(package, &digest).unwrap()).unwrap();
        let commitments =
            BTreeMap::from([(1u16, made["commitments"].as_str().unwrap().to_string())]);
        let round = round(
            &wallet,
            1,
            "devnet-plain",
            made["nonces"].as_str().unwrap(),
            &commitments,
        );
        let why = plain_sign::sign_share(&message, &wire.check(), &round).unwrap_err();
        assert_eq!(why, "the nonces were made for another message", "{name}");
    }
}

#[test]
fn a_round_for_another_cluster_or_mode_gets_no_share() {
    let wallet = wallet();
    let case = wallet.case(Cluster::Mainnet, send_sol(recipient(), LAMPORTS));
    let (message, wire) = (case.bytes(), Wire::of(&case));
    let digest = plain_sign::digest(&case.pins.wallet, &message).unwrap();
    // Two seats commit, so the threshold holds and only the label can refuse the share.
    let (mut nonces, mut commitments) = (BTreeMap::new(), BTreeMap::new());
    for seat in [1u16, 2] {
        let package = &wallet.group.done[usize::from(seat) - 1].key_package;
        let made: Value = serde_json::from_str(&sign::nonces(package, &digest).unwrap()).unwrap();
        nonces.insert(seat, made["nonces"].as_str().unwrap().to_string());
        commitments.insert(seat, made["commitments"].as_str().unwrap().to_string());
    }
    for label in ["devnet-plain", "devnet", "mainnet", "mainnet-pool", ""] {
        let round = round(&wallet, 1, label, &nonces[&1], &commitments);
        let why = plain_sign::sign_share(&message, &wire.check(), &round).unwrap_err();
        assert_eq!(why, "the round is for another cluster or mode", "{label}");
    }
    let round = round(&wallet, 1, "mainnet-plain", &nonces[&1], &commitments);
    assert!(plain_sign::sign_share(&message, &wire.check(), &round).is_ok());
    assert!(
        session(&wallet, &[1, 2], &message, &case).is_ok(),
        "the label of the wallet signs"
    );
}

#[test]
fn a_key_package_that_is_not_the_pinned_group_gets_no_share() {
    let wallet = wallet();
    let stranger = wallet_other();
    let case = wallet.case(Cluster::Devnet, cancel());
    let message = case.bytes();
    let err = session(&stranger, &[1], &message, &case).unwrap_err();
    assert!(err.contains("not the pinned group key"), "{err}");
}

fn wallet_other() -> Wallet {
    wallet()
}

// ---- the wasm entries ---------------------------------------------------------------------------

#[test]
fn the_wasm_entries_check_compile_and_sign_a_plain_send() {
    let wallet = wallet();
    let case = wallet.case(Cluster::Mainnet, send_token(recipient(), UNITS));
    let wire = Wire::of(&case);
    let compiled = wasm::plain_compile_message(&wire.intent, &wire.pins).unwrap();
    assert_eq!(compiled, case.bytes());
    let answer = wasm::plain_check_message(&compiled, &wire.intent, &wire.pins, &wire.chain);
    assert!(
        answer.starts_with("accepted\nintent send-token\ncluster mainnet\n"),
        "{answer}"
    );
    let signature = wasm::sol_plain_fee_sign(
        &compiled,
        &wire.intent,
        &wire.pins,
        &wire.chain,
        &fee_round(&wallet),
    )
    .unwrap();
    assert!(wasm::sol_fee_verify(
        &hex(&wallet.fee_public),
        &compiled,
        &signature
    ));
    let digest = wasm::sol_plain_digest(&wire.pins, &compiled).unwrap();
    assert_eq!(
        digest,
        plain_sign::digest(&case.pins.wallet, &compiled).unwrap()
    );
}

#[test]
fn the_check_entry_answers_refused_or_error_and_never_throws() {
    let case = Case::devnet(send_sol(recipient(), LAMPORTS));
    let wire = Wire::of(&case);
    let mut bad = case.bytes();
    bad[40] ^= 1;
    let answer = wasm::plain_check_message(&bad, &wire.intent, &wire.pins, &wire.chain);
    assert!(answer.starts_with("refused\nplain-"), "{answer}");
    for (intent, pins, chain) in [
        (&[][..], &wire.pins[..], &wire.chain[..]),
        (&wire.intent[..], &[0u8; 5][..], &wire.chain[..]),
        (&wire.intent[..], &wire.pins[..], &wire.chain[..10]),
        (&[3u8; 4][..], &wire.pins[..], &wire.chain[..]),
    ] {
        let answer = wasm::plain_check_message(&case.bytes(), intent, pins, chain);
        assert!(answer.starts_with("error\t"), "{answer}");
    }
    let short_chain = PlainChain::default().encode();
    let answer = wasm::plain_check_message(&case.bytes(), &wire.intent, &wire.pins, &short_chain);
    assert!(answer.starts_with("refused\nplain-genesis"), "{answer}");
}

#[test]
fn the_reads_entry_lists_the_accounts_to_read_with_their_derived_addresses() {
    let case = Case::mainnet(send_token(recipient(), UNITS));
    let wire = Wire::of(&case);
    let answer = wasm::plain_reads(&wire.intent, &wire.pins);
    let rows: Vec<Vec<&str>> = answer.lines().map(|l| l.split('\t').collect()).collect();
    let roles: Vec<&str> = rows.iter().map(|r| r[0]).collect();
    assert_eq!(roles, vec!["payer", "nonce", "recipient", "source", "dest"]);
    for ((role, key), row) in
        p3_check::plain_chain::required(&case.intent, &case.pins, &case.compiled().addr)
            .iter()
            .zip(&rows)
    {
        assert_eq!(row[0], role.name());
        assert_eq!(row[1], hex(key));
        assert_eq!(row[2], p3_check::plain_display::base58(key));
    }
    assert!(wasm::plain_reads(&[1], &wire.pins).starts_with("error\t"));
}

#[test]
fn the_compile_entry_refuses_a_pool_wallet_a_token_that_is_not_pinned_and_a_group_payer() {
    let case = Case::devnet(send_token(recipient(), UNITS));
    let wire = Wire::of(&case);
    let compile = |intent: &[u8], pins: &[u8]| {
        let (intent, pins) = (
            PlainIntent::decode(intent)?,
            p3_check::plain::PlainPins::decode(pins)?,
        );
        p3_check::plain_template::compile(&intent, &pins).map(|_| ())
    };
    assert!(compile(&wire.intent, &wire.pins).is_ok());
    let mut pool = wire.pins.clone();
    pool[1] = 2;
    assert!(compile(&wire.intent, &pool).is_err(), "pool mode");
    let mut token = wire.intent.clone();
    token[1 + 4 + 32] = 1;
    assert!(compile(&token, &wire.pins).is_err(), "token 1");
    let mut payer = wire.pins.clone();
    let group = case.pins.group;
    payer[34..].copy_from_slice(&group);
    assert!(
        compile(&wire.intent, &payer).is_err(),
        "payer is the group key"
    );
}

#[test]
fn the_label_entries_follow_the_wallet_table() {
    for (cluster, mode, label) in [
        ("devnet", "pool", "devnet"),
        ("devnet", "plain", "devnet-plain"),
        ("mainnet", "plain", "mainnet-plain"),
    ] {
        assert_eq!(wasm::sol_wallet_label(cluster, mode).unwrap(), label);
        let program = wasm::sol_wallet_program_label(cluster, mode).unwrap();
        assert!(program.starts_with("zolana-devnet:") || program.starts_with("zigs-plain-"));
    }
    assert_eq!(
        wasm::sol_wallet_program_label("devnet", "pool").unwrap(),
        wasm::sol_program_label()
    );
}

#[test]
fn the_plain_rule_list_names_every_plain_rule_once() {
    let list = wasm::plain_rule_list();
    let ids: Vec<&str> = list
        .lines()
        .map(|l| l.split('\t').next().unwrap())
        .collect();
    assert_eq!(ids.len(), p3_check::rule::PLAIN_INFO.len());
    assert!(ids.iter().all(|id| id.starts_with("plain-")));
    assert!(
        !wasm::rule_list().contains("plain-"),
        "the pool list does not change"
    );
}

// ---- the wire form of the reads ----------------------------------------------------------------

#[test]
fn the_chain_reads_round_trip_and_a_bad_wire_is_an_error() {
    let case = Case::devnet(send_token(recipient(), UNITS));
    let wire = case.chain.encode();
    assert_eq!(PlainChain::decode(&wire).unwrap(), case.chain);
    assert!(
        PlainChain::decode(&wire[..wire.len() - 1]).is_err(),
        "truncated"
    );
    assert!(
        PlainChain::decode(&[wire.clone(), vec![0]].concat()).is_err(),
        "trailing byte"
    );
    let mut twice = case.chain.clone();
    twice.reads.push(twice.reads[0].clone());
    assert!(PlainChain::decode(&twice.encode()).is_err(), "a role twice");
    let mut role = wire.clone();
    role[32 + 24 + 1] = 9;
    assert!(PlainChain::decode(&role).is_err(), "unknown role");
    let mut flag = wire.clone();
    flag[32 + 24 + 1 + 1 + 32] = 2;
    assert!(PlainChain::decode(&flag).is_err(), "present flag 2");
    assert!(PlainChain::decode(&[]).is_err());
}

#[test]
fn an_absent_account_is_not_an_account_with_no_lamports() {
    let case = Case::devnet(send_sol(recipient(), LAMPORTS));
    let absent = case.clone().read(Role::Recipient, None);
    let empty = case.clone().lamports(Role::Recipient, 0);
    assert_ne!(absent.chain.encode(), empty.chain.encode());
    assert_eq!(
        PlainChain::decode(&absent.chain.encode()).unwrap(),
        absent.chain
    );
    assert_eq!(
        PlainChain::decode(&empty.chain.encode()).unwrap(),
        empty.chain
    );
}

// ---- the smoke vectors --------------------------------------------------------------------------

#[test]
fn the_plain_smoke_vectors_are_the_answers_of_the_native_check() {
    let dir = format!("{}/vectors/plain", env!("CARGO_MANIFEST_DIR"));
    let mut names: Vec<String> = std::fs::read_dir(&dir)
        .unwrap()
        .filter_map(|entry| {
            entry
                .ok()?
                .file_name()
                .to_str()?
                .strip_suffix(".msg")
                .map(String::from)
        })
        .collect();
    names.sort();
    assert!(names.len() >= 20, "{} vectors", names.len());
    let (mut accepted, mut refused, mut errors) = (0, 0, 0);
    for name in &names {
        let read = |ext: &str| std::fs::read(format!("{dir}/{name}.{ext}")).unwrap();
        let answer = String::from_utf8(read("answer")).unwrap();
        let (message, intent, pins) = (read("msg"), read("intent"), read("pins"));
        let got = wasm::plain_check_message(&message, &intent, &pins, &read("chain"));
        let again = "run: cargo run --release --example plain_vectors";
        assert_eq!(got, answer, "{name}: {again}");
        if answer.starts_with("accepted") {
            assert_eq!(
                wasm::plain_compile_message(&intent, &pins).unwrap(),
                message,
                "{name}"
            );
            accepted += 1;
        } else if answer.starts_with("refused") {
            refused += 1;
        } else {
            errors += 1;
        }
    }
    assert!(
        accepted >= 10 && refused >= 8 && errors >= 1,
        "{accepted} {refused} {errors}"
    );
}

#[test]
fn every_plain_entry_refuses_a_pool_wallet_and_every_pool_entry_refuses_a_plain_one() {
    let wallet = wallet();
    let case = wallet.case(Cluster::Devnet, send_sol(recipient(), LAMPORTS));
    let message = case.bytes();
    let mut wire = Wire::of(&case);
    wire.pins[1] = 2; // the mode byte: pool
    let reads = wasm::plain_reads(&wire.intent, &wire.pins);
    assert!(reads.starts_with("error\t"), "{reads}");
    let answer = wasm::plain_check_message(&message, &wire.intent, &wire.pins, &wire.chain);
    assert!(answer.starts_with("refused\nplain-mode"), "{answer}");
    let why = fee::sign_plain(&message, &wire.check(), &fee_round(&wallet)).unwrap_err();
    assert!(why.starts_with("refused\nplain-mode"), "{why}");
    // The nonces are good (two seats, the plain digest), so the mode rule is the only cause.
    let digest = plain_sign::digest(&case.pins.wallet, &message).unwrap();
    let (mut nonces, mut commitments) = (BTreeMap::new(), BTreeMap::new());
    for seat in [1u16, 2] {
        let package = &wallet.group.done[usize::from(seat) - 1].key_package;
        let made: Value = serde_json::from_str(&sign::nonces(package, &digest).unwrap()).unwrap();
        nonces.insert(seat, made["nonces"].as_str().unwrap().to_string());
        commitments.insert(seat, made["commitments"].as_str().unwrap().to_string());
    }
    let round = round(&wallet, 1, "devnet-plain", &nonces[&1], &commitments);
    let why = plain_sign::sign_share(&message, &wire.check(), &round).unwrap_err();
    assert!(why.starts_with("refused\nplain-mode"), "{why}");
    let pool = PlainPins::decode(&wire.pins).unwrap().wallet;
    assert!(plain_sign::digest(&pool, &message).is_err());
    let pool_compile =
        plain_template::compile(&case.intent, &PlainPins::decode(&wire.pins).unwrap());
    assert!(pool_compile.is_err());
    // The pool entries never read the plain inputs.
    let plain = Wire::of(&case);
    assert!(wasm::check_message(&message, &plain.intent, &plain.pins, &[], 0).starts_with("error"));
    assert!(sign::digest(case.pins.wallet.label(), &message).is_err());
    assert!(wasm::compile_proposal(&plain.intent, &plain.pins, &[]).is_err());
}
