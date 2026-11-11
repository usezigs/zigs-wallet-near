//! The private mainnet wallet in the checker: the deployment table, the 194-byte pins, the label
//! of the signing round, the intents of a mainnet group and the cap of a Shield.
//! `the_mainnet_addresses_and_digest_are_the_values_of_the_program_tests` reads the vector
//! `vectors/program/mainnet.json`, which sol-program/svm-tests/tests/cluster.rs also reads.

#[path = "support/ceremony.rs"]
mod ceremony;
mod common;

use std::collections::BTreeMap;

use common::fixture::*;
use common::{b58, EXPIRY, NOW};
use p3_check::approve::Device;
use p3_check::beta::{approve_message, approve_payment, Signer};
use p3_check::consts::{
    Key, DEVNET_GENESIS, MAINNET_GENESIS, MULTISIG_DEVNET, MULTISIG_MAINNET, POOL_DEVNET,
    PRIVATE_CAP_MAINNET, REGISTRY_DEVNET,
};
use p3_check::frost::{check_cluster, PROGRAM_LABEL};
use p3_check::intent::{Intent, Program};
use p3_check::pay::{Account, Chain, Payment, Seen};
use p3_check::pins::Pins;
use p3_check::plain::PlainPins;
use p3_check::plan::{Plan, Proposal};
use p3_check::program::{
    approval_digest, cancellation_address, commitment, deployment_of_label, deployment_of_wire,
    owner_pda, proposal_address, settlements, DEVNET, KIND_PROPOSAL, MAINNET,
};
use p3_check::rule::Rule;
use p3_check::sign::{self, ApprovalCheck, Check};
use p3_check::template::{body_of, compile};
use p3_check::transact::Leg;
use p3_check::{fee, v1, wasm};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use solana_address::Address;

const PRIVATE: &str = "mainnet-private";

// ---- helpers ----------------------------------------------------------------------------------

fn device(f: &Fixture) -> Device<'_> {
    Device {
        pins: &f.pins,
        snapshot: &f.snapshot,
        now: NOW,
    }
}

/// The body of the payment of `f`, its proposal address and its bump under the row of the pins.
fn want_body(f: &Fixture) -> (Vec<u8>, Key, u8) {
    let pda = f.pins.for_pda().unwrap();
    let recipient = f.intent.pay().and_then(|pay| pay.recipient());
    let settled = settlements(&pda.sol_interface, recipient);
    let commitment = commitment(&f.tx.private_tx_hash, &f.tx, &settled).unwrap();
    let body = body_of(&pda, commitment, EXPIRY, PAYER).write().unwrap();
    let (address, bump) =
        proposal_address(f.pins.deployment, &f.pins.multisig, &commitment, &body).unwrap();
    (body, address, bump)
}

/// What a device sees once the proposal account of `f` exists.
fn seen(f: &Fixture) -> Seen {
    let (body, _, bump) = want_body(f);
    Seen {
        account: Some(Account {
            owner: f.pins.program,
            data: [&[KIND_PROPOSAL, bump][..], &body].concat(),
        }),
        approved: Vec::new(),
    }
}

fn pay(f: &Fixture) -> Result<Payment, Vec<Rule>> {
    approve_payment(&f.proposal(), &device(f), &seen(f), None)
        .map_err(|refusal| refusal.violations.iter().map(|v| v.rule).collect())
}

/// The wire forms of `check_payment` for `f`: proposal, pins, snapshot and chain.
fn wires(f: &Fixture) -> [Vec<u8>; 4] {
    let chain = Chain {
        seen: Some(seen(f)),
        recipient: None,
    };
    [
        f.proposal().encode().unwrap(),
        f.pins.wire(),
        f.snapshot.encode().unwrap(),
        chain.encode().unwrap(),
    ]
}

fn approval_input(w: &[Vec<u8>; 4]) -> ApprovalCheck<'_> {
    ApprovalCheck {
        check: Check {
            intent: &w[0],
            pins: &w[1],
            snapshot: &w[2],
        },
        chain: &w[3],
    }
}

/// The signing round of one seat with `label` as its cluster.
fn round_for(
    group: &ceremony::Group,
    seat: u16,
    label: &str,
    (nonces, commitments): (&str, &BTreeMap<u16, String>),
) -> String {
    let round = ceremony::round_of(group, seat, nonces, commitments);
    let mut round: Value = serde_json::from_str(&round).unwrap();
    round["cluster"] = json!(label);
    round.to_string()
}

/// Nonces and commitments of `seats` for one digest (hex).
fn commit(
    group: &ceremony::Group,
    seats: &[u16],
    digest: &str,
) -> (BTreeMap<u16, String>, BTreeMap<u16, String>) {
    let (mut nonces, mut commitments) = (BTreeMap::new(), BTreeMap::new());
    for seat in seats {
        let package = &group.done[usize::from(*seat) - 1].key_package;
        let made: Value = serde_json::from_str(&sign::nonces(package, digest).unwrap()).unwrap();
        nonces.insert(*seat, made["nonces"].as_str().unwrap().to_string());
        commitments.insert(*seat, made["commitments"].as_str().unwrap().to_string());
    }
    (nonces, commitments)
}

/// The seats approve the payment of `f` with rounds under `label` and combine their shares.
fn approve_with(
    group: &ceremony::Group,
    f: &Fixture,
    label: &str,
    seats: &[u16],
) -> Result<[u8; 64], String> {
    let got = pay(f).map_err(|rules| format!("{rules:?}"))?;
    let (nonces, commitments) = commit(group, seats, &hex::encode(got.digest));
    let w = wires(f);
    let mut shares = BTreeMap::new();
    for seat in seats {
        let round = round_for(group, *seat, label, (&nonces[seat], &commitments));
        let made: Value =
            serde_json::from_str(&sign::approval_share(&approval_input(&w), &round)?).unwrap();
        shares.insert(*seat, made["share"].as_str().unwrap().to_string());
    }
    let signature = sign::aggregate(
        &got.digest,
        &group.done[0].public_key_package,
        &ceremony::map_json(&commitments),
        &ceremony::map_json(&shares),
    )?;
    Ok(hex::decode(signature).unwrap().try_into().unwrap())
}

fn rules_of(message: &[u8], proposal: &Proposal, device: &Device, signer: Signer) -> Vec<Rule> {
    approve_message(message, proposal, device, signer)
        .err()
        .map(|r| r.violations.iter().map(|v| v.rule).collect())
        .unwrap_or_default()
}

fn compiled(intent: &Intent, pins: &Pins, tx: Option<&p3_check::transact::Transact>) -> Vec<u8> {
    v1::write(&compile(intent, pins, tx).unwrap()).unwrap()
}

fn bare(intent: Intent) -> Proposal {
    Proposal {
        intent,
        plan: Plan::default(),
        transact: Vec::new(),
    }
}

/// A private payment of the PDA of `GROUP` on mainnet.
fn mainnet_payment() -> Fixture {
    Fixture::payment_on(&MAINNET, &Spec::transfer(), GROUP, payee())
}

/// The pins of the tests of the group key on mainnet.
fn mainnet_pins() -> Pins {
    common::pins()
        .on_deployment(&MAINNET, MAINNET_GENESIS)
        .unwrap()
}

// ---- the deployment table ---------------------------------------------------------------------

#[test]
fn the_mainnet_row_names_9me7_and_each_part_of_its_program_label_is_a_constant() {
    assert_eq!(
        b58("9mE7WUJHK6dQwzK6AP6wf1eyPmePULZrGeRbXqke2ukq"),
        MULTISIG_MAINNET
    );
    assert_eq!(
        b58("5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d"),
        MAINNET_GENESIS
    );
    let parts: Vec<&str> = MAINNET.program_label.split(':').collect();
    assert_eq!(parts.len(), 5);
    assert_eq!((parts[0], parts[3]), ("zolana-mainnet", "spr-v1"));
    assert_eq!(
        b58(parts[1]),
        POOL_DEVNET,
        "the pool has one id on both clusters"
    );
    assert_eq!(b58(parts[2]), REGISTRY_DEVNET);
    assert_eq!(b58(parts[4]), MULTISIG_MAINNET);
    assert_eq!(
        (
            MAINNET.wire,
            MAINNET.label,
            MAINNET.genesis,
            MAINNET.program
        ),
        (2, PRIVATE, MAINNET_GENESIS, MULTISIG_MAINNET)
    );
    assert_eq!(MAINNET.cap, Some(PRIVATE_CAP_MAINNET));
    assert_eq!(PRIVATE_CAP_MAINNET, 500_000_000);
}

#[test]
fn the_devnet_row_keeps_its_labels_and_ids() {
    assert_eq!(
        PROGRAM_LABEL,
        "zolana-devnet:ring1GaLCuJnkUMVkX2JeZLTTX17wKsV4fZmPVzXANW:\
         regy3WAeRXMYuMYxr5iK3Bf9Arr3PcxGxyzAddbiqDQ:spr-v1"
    );
    assert_eq!(
        (DEVNET.wire, DEVNET.label, DEVNET.program_label),
        (1, "devnet", PROGRAM_LABEL)
    );
    assert_eq!(
        (DEVNET.genesis, DEVNET.program, DEVNET.cap),
        (DEVNET_GENESIS, MULTISIG_DEVNET, None)
    );
    assert_eq!(check_cluster("devnet").unwrap(), &DEVNET);
    assert_eq!(check_cluster(PRIVATE).unwrap(), &MAINNET);
    for label in [
        "mainnet",
        "mainnet-plain",
        "devnet-plain",
        "mainnet-pool",
        "",
    ] {
        assert_eq!(
            check_cluster(label).unwrap_err(),
            "the cluster must be devnet",
            "{label}"
        );
        assert!(deployment_of_label(label).is_none(), "{label}");
    }
    for byte in [0, 3, 255] {
        assert!(deployment_of_wire(byte).is_none(), "{byte}");
    }
}

#[test]
fn the_mainnet_addresses_and_digest_are_the_values_of_the_program_tests() {
    let v: Value = serde_json::from_str(include_str!("../vectors/program/mainnet.json")).unwrap();
    let text = |name: &str| v[name].as_str().unwrap().to_string();
    let number = |name: &str| v[name].as_u64().unwrap();
    assert_eq!(text("program"), hex::encode(MULTISIG_MAINNET));
    assert_eq!(text("genesis"), hex::encode(MAINNET_GENESIS));
    assert_eq!(text("domain"), hex::encode(b"Zigs_SolApproval_v1"));
    let group = common::hex32(&text("group"));
    let program = Address::new_from_array(MULTISIG_MAINNET);
    let bump = |seeds: &[&[u8]]| u64::from(Address::find_program_address(seeds, &program).1);
    let owner = owner_pda(&MAINNET, &group).unwrap();
    assert_eq!(hex::encode(owner), text("owner"));
    assert_eq!(bump(&[b"multisig", &group]), number("owner_bump"));
    let expiry = hex::decode("80234b6b00000000").unwrap();
    let body = [
        &[0x5a; 32][..],
        &group,
        &expiry,
        &[0xa5; 32],
        &[1],
        &[0xb6; 32],
    ]
    .concat();
    assert_eq!(hex::encode(&body), text("body"));
    let (proposal, proposal_bump) = proposal_address(&MAINNET, &group, &[0x5a; 32], &body).unwrap();
    assert_eq!(hex::encode(proposal), text("proposal"));
    assert_eq!(u64::from(proposal_bump), number("proposal_bump"));
    assert_eq!(
        hex::encode(cancellation_address(&MAINNET, &proposal).unwrap()),
        text("cancellation")
    );
    assert_eq!(
        bump(&[b"cancelled_transaction", &proposal]),
        number("cancellation_bump")
    );
    let digest = text("digest");
    assert_eq!(
        hex::encode(approval_digest(&MAINNET, &proposal, &body)),
        digest
    );
    let explicit: [u8; 32] = Sha256::new()
        .chain_update(b"Zigs_SolApproval_v1")
        .chain_update(MAINNET_GENESIS)
        .chain_update(MULTISIG_MAINNET)
        .chain_update(proposal)
        .chain_update(&body)
        .finalize()
        .into();
    assert_eq!(hex::encode(explicit), digest);
    let entry = wasm::sol_approval_digest(PRIVATE, &hex::encode(proposal), &hex::encode(&body));
    assert_eq!(entry.unwrap(), digest);
}

#[test]
fn the_addresses_and_the_digest_of_a_group_differ_between_the_rows() {
    let landed: Value = serde_json::from_slice(&common::read("program/landed.json")).unwrap();
    let group = common::hex32(landed["group"].as_str().unwrap());
    let pda = common::hex32(landed["pda"].as_str().unwrap());
    assert_eq!(owner_pda(&DEVNET, &group).unwrap(), pda);
    assert_ne!(owner_pda(&MAINNET, &group).unwrap(), pda);
    let body = hex::decode(landed["dmain"]["body"].as_str().unwrap()).unwrap();
    let address = |row| proposal_address(row, &group, &[7; 32], &body).unwrap().0;
    let (devnet, mainnet) = (address(&DEVNET), address(&MAINNET));
    assert_ne!(devnet, mainnet);
    assert_ne!(
        cancellation_address(&DEVNET, &devnet).unwrap(),
        cancellation_address(&MAINNET, &devnet).unwrap()
    );
    assert_ne!(
        approval_digest(&DEVNET, &devnet, &body),
        approval_digest(&MAINNET, &devnet, &body)
    );
}

// ---- the pins ---------------------------------------------------------------------------------

#[test]
fn the_194_byte_pins_read_back_on_both_rows_with_the_pda_and_assets_of_the_row() {
    let (devnet, mainnet) = (common::pins(), mainnet_pins());
    for (pins, byte) in [(&devnet, 1u8), (&mainnet, 2)] {
        let wire = pins.wire();
        assert_eq!(wire.len(), 194);
        assert_eq!(wire[0], byte);
        assert_eq!(&wire[162..], &pins.deployment.genesis);
        assert_eq!(&Pins::decode(&wire).unwrap(), pins);
    }
    assert_eq!(mainnet.pda, owner_pda(&MAINNET, &mainnet.multisig).unwrap());
    assert_ne!(mainnet.pda, devnet.pda);
    assert_eq!(mainnet.program, MULTISIG_MAINNET);
    assert!(mainnet.assets.entries().is_empty(), "SOL only on mainnet");
    assert!(!devnet.assets.entries().is_empty());
    let same = |p: &Pins| {
        (
            p.pool,
            p.registry,
            p.input_tree,
            p.sol_interface,
            p.user_record,
        )
    };
    assert_eq!(same(&mainnet), same(&devnet));
    assert_eq!(mainnet.nonce_rent, devnet.nonce_rent);
}

#[test]
fn pool_pins_and_plain_pins_never_read_as_each_other() {
    let plain = common::read("plain/devnet-s2-send-sol.pins");
    assert_eq!(plain.len(), 66);
    assert!(PlainPins::decode(&plain).is_ok());
    assert!(Pins::decode(&plain).is_err());
    for pins in [common::pins(), mainnet_pins()] {
        assert!(PlainPins::decode(&pins.wire()).is_err());
    }
}

/// Pins that every entry must refuse, by name.
fn bad_pins(pins: &Pins) -> Vec<(&'static str, Vec<u8>)> {
    let wire = pins.wire();
    let with_first = |byte: u8| [&[byte][..], &wire[1..]].concat();
    let mut flipped = wire.clone();
    flipped[193] ^= 1;
    vec![
        ("cluster byte 0", with_first(0)),
        ("cluster byte 3", with_first(3)),
        ("mainnet byte, Devnet genesis", with_first(2)),
        ("193 bytes", wire[..193].to_vec()),
        ("195 bytes", [&wire[..], &[0]].concat()),
        ("a flipped genesis bit", flipped),
        (
            "Devnet pins, mainnet genesis",
            pins.on_deployment(&DEVNET, MAINNET_GENESIS).unwrap().wire(),
        ),
        (
            "mainnet pins, Devnet genesis",
            pins.on_deployment(&MAINNET, DEVNET_GENESIS).unwrap().wire(),
        ),
    ]
}

#[test]
fn every_entry_that_reads_pins_refuses_a_bad_cluster_byte_length_or_genesis() {
    let group = ceremony::run(ceremony::WALLET, 2, 3);
    let (nonces, commitments) = commit(&group, &[1], &"00".repeat(32));
    let round = ceremony::round_of(&group, 1, &nonces[&1], &commitments);
    let fee_round = json!({"now": NOW, "secret": "11".repeat(32)}).to_string();
    let f = Fixture::payment(&Spec::transfer());
    let w = wires(&f);
    let message = [0x80u8];
    let named = |why: &str| why.starts_with("pins: ");
    for (name, bad) in bad_pins(&f.pins) {
        let check = Check {
            intent: &w[0],
            pins: &bad,
            snapshot: &w[2],
        };
        let answer = wasm::check_message(&message, &w[0], &bad, &w[2], NOW);
        assert!(answer.starts_with("error\tpins: "), "{name}: {answer}");
        let answer = wasm::check_payment(&w[0], &bad, &w[2], &w[3], NOW);
        assert!(answer.starts_with("error\tpins: "), "{name}: {answer}");
        assert!(
            named(&wasm::compile_proposal(&w[0], &bad, &[]).unwrap_err()),
            "{name}"
        );
        assert!(
            named(&fee::sign(&message, &check, &fee_round).unwrap_err()),
            "{name}"
        );
        assert!(
            named(&sign::sign_share(&message, &check, &round).unwrap_err()),
            "{name}"
        );
        let input = ApprovalCheck {
            check,
            chain: &w[3],
        };
        assert!(
            named(&sign::approval_share(&input, &round).unwrap_err()),
            "{name}"
        );
    }
}

// ---- the label of the signing round -----------------------------------------------------------

#[test]
fn the_group_key_signs_a_message_only_in_a_round_with_the_label_of_the_pins() {
    let group = ceremony::run(ceremony::WALLET, 2, 3);
    let (proposal, message) = ceremony::nonce_message(&group, [5; 32]);
    let share = |label: &str| {
        let (nonces, commitments) = commit(&group, &[1, 2], &sign::digest(label, &message)?);
        let round = round_for(&group, 1, label, (&nonces[&1], &commitments));
        sign::sign_share(&message, &ceremony::check(&group, &proposal), &round)
    };
    share("devnet").expect("the label of the Devnet pins");
    assert_eq!(
        share(PRIVATE).unwrap_err(),
        "the round is for another cluster"
    );
    // With mainnet pins the group key signs no message at all.
    let pins = Pins::decode(&group.pins).unwrap();
    let pins = pins
        .on_deployment(&MAINNET, MAINNET_GENESIS)
        .unwrap()
        .wire();
    let message = wasm::compile_proposal(&proposal, &pins, &[]).unwrap();
    let (nonces, commitments) = commit(&group, &[1, 2], &sign::digest("devnet", &message).unwrap());
    let round = round_for(&group, 1, "devnet", (&nonces[&1], &commitments));
    let check = Check {
        intent: &proposal,
        pins: &pins,
        snapshot: &group.snapshot,
    };
    let why = sign::sign_share(&message, &check, &round).unwrap_err();
    assert!(why.contains("intent-retired"), "{why}");
}

#[test]
fn the_group_key_approves_a_payment_only_in_a_round_with_the_label_of_the_pins() {
    let group = ceremony::run(ceremony::WALLET, 2, 3);
    let key = ceremony::unhex32(&group.done[0].group_key);
    for (row, other) in [(&DEVNET, PRIVATE), (&MAINNET, "devnet")] {
        let f = Fixture::payment_on(row, &Spec::transfer(), key, payee());
        let why = approve_with(&group, &f, other, &[1, 2]).unwrap_err();
        assert_eq!(why, "the round is for another cluster", "{}", row.label);
        let signature = approve_with(&group, &f, row.label, &[1, 2]).expect("signed");
        let digest = pay(&f).unwrap().digest;
        sign::verify_strict(&key, &digest, &signature).expect("verify_strict");
    }
}

// ---- the intents of a mainnet group -----------------------------------------------------------

#[test]
fn a_mainnet_group_signs_no_create_nonce_and_no_nonce_payment_with_either_key() {
    let f = mainnet_payment();
    let create = bare(Intent::CreateNonce { blockhash: [5; 32] });
    let message = compiled(&create.intent, &f.pins, None);
    let moved = Fixture::build_on(
        &MAINNET,
        &Spec::migration(),
        GROUP,
        group(),
        pda_wallet_on(&MAINNET, &GROUP),
    );
    let migration = Proposal {
        intent: moved.intent.clone(),
        plan: moved.plan.clone(),
        transact: Vec::new(),
    };
    for signer in [Signer::Fee, Signer::Group] {
        let got = rules_of(&message, &create, &device(&f), signer);
        assert_eq!(
            got.first(),
            Some(&Rule::IntentRetired),
            "{signer:?}: {got:?}"
        );
        let got = rules_of(&moved.bytes(), &migration, &device(&moved), signer);
        assert_eq!(got, vec![Rule::IntentRetired], "{signer:?}");
    }
    // The same move on Devnet is the one nonce payment that both keys sign.
    let devnet = Fixture::migration();
    let migration = Proposal {
        intent: devnet.intent.clone(),
        plan: devnet.plan.clone(),
        transact: Vec::new(),
    };
    for signer in [Signer::Fee, Signer::Group] {
        let got = rules_of(&devnet.bytes(), &migration, &device(&devnet), signer);
        assert_eq!(got, vec![], "{signer:?}");
    }
}

/// The `create` message of the payment of `f`.
fn propose(f: &Fixture) -> (Proposal, Vec<u8>) {
    let Intent::Program(Program::Approve { pay }) = f.intent.clone() else {
        panic!("a payment");
    };
    let (body, _, _) = want_body(f);
    let intent = Intent::Program(Program::Propose {
        pay,
        commitment: body[..32].try_into().unwrap(),
        blockhash: [5; 32],
    });
    let message = compiled(&intent, &f.pins.for_pda().unwrap(), None);
    let proposal = Proposal {
        intent,
        ..f.proposal()
    };
    (proposal, message)
}

/// The `execute` message of the payment of `f` with the group signature.
fn execute(f: &Fixture, signature: [u8; 64]) -> (Proposal, Vec<u8>) {
    let intent = Intent::Program(Program::Execute {
        expiry: EXPIRY,
        rent_recipient: PAYER,
        signature,
        blockhash: [6; 32],
        recipient: None,
    });
    let message = compiled(&intent, &f.pins.for_pda().unwrap(), Some(&f.tx));
    (bare(intent), message)
}

/// The `cancel` message of an expired proposal of the fee key.
fn cancel(f: &Fixture) -> (Proposal, Vec<u8>) {
    let wire = [&[12][..], &[0x5a; 32], &EXPIRY.to_le_bytes(), &[5; 32]].concat();
    let intent = Intent::decode(&wire).unwrap();
    let message = compiled(&intent, &f.pins.for_pda().unwrap(), None);
    (bare(intent), message)
}

#[test]
fn shield_propose_approve_execute_and_cancel_compile_for_9me7_and_pass_on_mainnet() {
    let group = ceremony::run(ceremony::WALLET, 2, 3);
    let key = ceremony::unhex32(&group.done[0].group_key);
    let f = Fixture::payment_on(&MAINNET, &Spec::transfer(), key, payee());
    let w = wires(&f);
    let answer = wasm::check_payment(&w[0], &w[1], &w[2], &w[3], NOW);
    assert!(answer.starts_with("accepted"), "{answer}");
    let signature = approve_with(&group, &f, PRIVATE, &[1, 3]).expect("signed");
    assert_eq!(shield_rules(&f, 1_000, 0), vec![], "shield");
    let cases = [
        ("propose", propose(&f)),
        ("execute", execute(&f, signature)),
        ("cancel", cancel(&f)),
    ];
    for (name, (proposal, message)) in cases {
        assert_eq!(
            rules_of(&message, &proposal, &device(&f), Signer::Fee),
            vec![],
            "{name}"
        );
        let got = rules_of(&message, &proposal, &device(&f), Signer::Group);
        assert_eq!(got.first(), Some(&Rule::IntentRetired), "{name}: {got:?}");
        let keys = v1::parse(&message).unwrap().keys;
        assert!(keys.contains(&MULTISIG_MAINNET), "{name}");
        assert!(!keys.contains(&MULTISIG_DEVNET), "{name}");
    }
}

#[test]
fn an_spl_payment_or_an_spl_leg_on_mainnet_is_refused() {
    let mut spec = Spec::transfer();
    spec.inputs = vec![(MINT, 100)];
    spec.pay = Some((MINT, 40));
    let spl = Fixture::payment_on(&MAINNET, &spec, GROUP, payee());
    let got = pay(&spl).unwrap_err();
    assert!(got.contains(&Rule::AssetUnknown), "{got:?}");
    let mut leg = mainnet_payment();
    leg.tx.legs.push(Leg::Spl {
        withdrawal: true,
        amount: 1,
        bump: 255,
    });
    let got = pay(&leg).unwrap_err();
    assert!(got.contains(&Rule::LegAsset), "{got:?}");
}

#[test]
fn a_private_payment_to_the_own_pda_address_passes_the_checker_on_mainnet() {
    let own = pda_wallet_on(&MAINNET, &GROUP);
    let f = Fixture::payment_on(&MAINNET, &Spec::transfer(), GROUP, own);
    let w = wires(&f);
    let answer = wasm::check_payment(&w[0], &w[1], &w[2], &w[3], NOW);
    assert!(answer.starts_with("accepted"), "{answer}");
}

// ---- the cap of a Shield ----------------------------------------------------------------------

/// The rules that refuse a Shield of `amount` with `held` for the fee key under the pins of `f`.
fn shield_rules(f: &Fixture, amount: u64, held: u64) -> Vec<Rule> {
    let proposal = bare(Intent::Shield {
        blockhash: [5; 32],
        amount,
        held,
    });
    let message = compiled(&proposal.intent, &f.pins.for_pda().unwrap(), None);
    let mut snapshot = f.snapshot.clone();
    snapshot.inputs.clear();
    let device = Device {
        pins: &f.pins,
        snapshot: &snapshot,
        now: NOW,
    };
    rules_of(&message, &proposal, &device, Signer::Fee)
}

#[test]
fn a_mainnet_shield_may_bring_the_private_balance_to_the_cap_and_not_one_lamport_more() {
    let f = mainnet_payment();
    assert_eq!(shield_rules(&f, 500_000_000, 0), vec![]);
    assert_eq!(shield_rules(&f, 200_000_000, 300_000_000), vec![]);
    assert_eq!(
        shield_rules(&f, 200_000_001, 300_000_000),
        vec![Rule::ShieldOverCap]
    );
    assert_eq!(shield_rules(&f, 1, 500_000_000), vec![Rule::ShieldOverCap]);
    // The wasm entry reads `held` from the wire of the intent.
    let proposal = bare(Intent::Shield {
        blockhash: [5; 32],
        amount: 2,
        held: 499_999_999,
    });
    let message = compiled(&proposal.intent, &f.pins.for_pda().unwrap(), None);
    let mut snapshot = f.snapshot.clone();
    snapshot.inputs.clear();
    let wire = proposal.encode().unwrap();
    assert_eq!(wire.len(), 49, "tag, blockhash, amount, held");
    let snapshot = snapshot.encode().unwrap();
    let answer = wasm::check_message(&message, &wire, &f.pins.wire(), &snapshot, NOW);
    assert!(answer.starts_with("refused\nshield-over-cap\t"), "{answer}");
}

#[test]
fn a_held_value_near_u64_max_is_refused_and_devnet_has_no_cap() {
    let f = mainnet_payment();
    for held in [u64::MAX, u64::MAX - 999, u64::MAX - 1_000] {
        assert_eq!(
            shield_rules(&f, 1_000, held),
            vec![Rule::ShieldOverCap],
            "{held}"
        );
    }
    let devnet = Fixture::payment(&Spec::transfer());
    assert_eq!(shield_rules(&devnet, 1_000, u64::MAX), vec![]);
    assert_eq!(shield_rules(&devnet, 600_000_000, 0), vec![]);
}
