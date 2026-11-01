//! The plain wallet: its pinned constants, its wallet labels (cluster and mode), the wire forms of
//! its pins and intents, and the separation from the pool path in both directions.

use std::str::FromStr;

use p3_check::consts::*;
use p3_check::frost::{self, PROGRAM_LABEL};
use p3_check::intent::Intent;
use p3_check::pda::is_on_curve;
use p3_check::pins::Pins;
use p3_check::plain::{Cluster, Mode, PlainIntent, PlainPins, Wallet, PINS_LEN};
use p3_check::rule::{PlainRule, PLAIN_INFO};
use p3_check::{sign, wasm};
use solana_address::Address;

fn b58(text: &str) -> Key {
    Address::from_str(text).expect("base58").to_bytes()
}

fn text(key: &Key) -> String {
    Address::from(*key).to_string()
}

const GROUP: Key = [0x11; 32];
const PAYER: Key = [0x22; 32];

fn pins(cluster: Cluster, mode: Mode) -> PlainPins {
    PlainPins {
        wallet: Wallet::new(cluster, mode).expect("wallet"),
        group: GROUP,
        payer: PAYER,
    }
}

// ---- the constants ------------------------------------------------------------------------

#[test]
fn every_plain_constant_equals_its_base58_text() {
    let table: [(Key, &str); 25] = [
        (TOKEN_PROGRAM, "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"),
        (
            TOKEN_2022_PROGRAM,
            "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
        ),
        (ATA_PROGRAM, "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"),
        (
            SECP256K1_PROGRAM,
            "KeccakSecp256k11111111111111111111111111111",
        ),
        (
            SECP256R1_PROGRAM,
            "Secp256r1SigVerify1111111111111111111111111",
        ),
        (BPF_LOADER_2, "BPFLoader2111111111111111111111111111111111"),
        (
            BPF_LOADER_UPGRADEABLE,
            "BPFLoaderUpgradeab1e11111111111111111111111",
        ),
        (STAKE_PROGRAM, "Stake11111111111111111111111111111111111111"),
        (VOTE_PROGRAM, "Vote111111111111111111111111111111111111111"),
        (CLOCK_SYSVAR, "SysvarC1ock11111111111111111111111111111111"),
        (
            EPOCH_SCHEDULE_SYSVAR,
            "SysvarEpochSchedu1e111111111111111111111111",
        ),
        (
            SLOT_HASHES_SYSVAR,
            "SysvarS1otHashes111111111111111111111111111",
        ),
        (
            SLOT_HISTORY_SYSVAR,
            "SysvarS1otHistory11111111111111111111111111",
        ),
        (
            STAKE_HISTORY_SYSVAR,
            "SysvarStakeHistory1111111111111111111111111",
        ),
        (
            EPOCH_REWARDS_SYSVAR,
            "SysvarEpochRewards1111111111111111111111111",
        ),
        (
            LAST_RESTART_SLOT_SYSVAR,
            "SysvarLastRestartS1ot1111111111111111111111",
        ),
        (
            MAINNET_GENESIS,
            "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d",
        ),
        (USDC_MAINNET, "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"),
        (USDC_DEVNET, "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU"),
        (SYSTEM_PROGRAM, "11111111111111111111111111111111"),
        (
            COMPUTE_BUDGET_PROGRAM,
            "ComputeBudget111111111111111111111111111111",
        ),
        (
            ED25519_PROGRAM,
            "Ed25519SigVerify111111111111111111111111111",
        ),
        (
            RECENT_BLOCKHASHES,
            "SysvarRecentB1ockHashes11111111111111111111",
        ),
        (RENT_SYSVAR, "SysvarRent111111111111111111111111111111111"),
        (
            INSTRUCTIONS_SYSVAR,
            "Sysvar1nstructions1111111111111111111111111",
        ),
    ];
    for (key, address) in table {
        assert_eq!(key, b58(address), "{address}");
        assert_eq!(text(&key), address);
    }
}

#[test]
fn the_genesis_hash_of_each_cluster_is_its_pin() {
    let devnet = Wallet::new(Cluster::Devnet, Mode::Plain).expect("devnet");
    let mainnet = Wallet::new(Cluster::Mainnet, Mode::Plain).expect("mainnet");
    assert_eq!(
        text(&devnet.genesis()),
        "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG"
    );
    assert_eq!(
        text(&mainnet.genesis()),
        "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d"
    );
    assert_ne!(devnet.genesis(), mainnet.genesis());
}

#[test]
fn each_cluster_pins_usdc_with_6_decimals_and_no_other_mint() {
    for (wallet, mint) in [
        (
            Cluster::Devnet,
            "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
        ),
        (
            Cluster::Mainnet,
            "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
        ),
    ] {
        let table = Wallet::new(wallet, Mode::Plain).expect("wallet").mints();
        assert_eq!(table.len(), 1);
        assert_eq!(table[0].symbol, "USDC");
        assert_eq!(table[0].decimals, 6);
        assert_eq!(text(&table[0].key), mint);
    }
}

#[test]
fn the_rent_pins_equal_the_values_read_on_both_clusters() {
    // getMinimumBalanceForRentExemption(0, 80, 165) on mainnet and Devnet, 1 November 2026.
    assert_eq!(
        (RENT_ZERO, RENT_NONCE, RENT_TOKEN),
        (650_240, 1_056_640, 1_488_440)
    );
    let per_byte = RENT_NONCE / (128 + 80);
    assert_eq!(per_byte, 5_080);
    assert_eq!(RENT_ZERO, 128 * per_byte);
    assert_eq!(RENT_TOKEN, (128 + 165) * per_byte);
}

#[test]
fn the_programs_and_sysvars_and_mints_that_a_send_must_not_pay_are_all_listed() {
    for key in [
        TOKEN_PROGRAM,
        SYSTEM_PROGRAM,
        ATA_PROGRAM,
        USDC_MAINNET,
        CLOCK_SYSVAR,
    ] {
        assert!(NOT_A_RECIPIENT.contains(&key));
    }
    // The all-zero System id, the Token program and the USDC mint are on the curve, so the curve
    // test alone does not refuse them.
    for key in [SYSTEM_PROGRAM, TOKEN_PROGRAM, USDC_MAINNET] {
        assert!(is_on_curve(&key), "{}", text(&key));
    }
}

// ---- the wallet: cluster and mode ---------------------------------------------------------

#[test]
fn a_pool_wallet_exists_on_devnet_only() {
    assert!(Wallet::new(Cluster::Devnet, Mode::Pool).is_ok());
    assert!(Wallet::new(Cluster::Devnet, Mode::Plain).is_ok());
    assert!(Wallet::new(Cluster::Mainnet, Mode::Plain).is_ok());
    assert!(Wallet::new(Cluster::Mainnet, Mode::Pool).is_err());
    assert!(Wallet::from_names("mainnet", "pool").is_err());
    assert!(Wallet::from_names("testnet", "plain").is_err());
    assert!(Wallet::from_names("mainnet", "other").is_err());
    assert_eq!(
        Wallet::from_names("mainnet", "plain").expect("wallet"),
        Wallet::new(Cluster::Mainnet, Mode::Plain).expect("wallet")
    );
}

#[test]
fn the_ceremony_takes_each_wallet_label_and_the_pool_signing_paths_take_the_pool_label_only() {
    let message = [0x81u8; 8];
    for label in ["devnet", "devnet-plain", "mainnet-plain"] {
        assert!(frost::check_label(label).is_ok(), "{label}");
        assert_eq!(
            Wallet::from_label(label).expect("wallet").label(),
            label,
            "the label round-trips"
        );
    }
    assert!(sign::digest("devnet", &message).is_ok());
    for label in ["devnet-plain", "mainnet-plain", "mainnet", "pool", ""] {
        assert!(sign::digest(label, &message).is_err(), "{label}");
    }
    for label in ["mainnet", "devnet-pool", "mainnet-pool", "plain"] {
        assert!(frost::check_label(label).is_err(), "{label}");
        assert!(Wallet::from_label(label).is_err(), "{label}");
    }
}

#[test]
fn the_pool_wallet_keeps_its_label_and_its_program_label() {
    let pool = Wallet::new(Cluster::Devnet, Mode::Pool).expect("pool");
    assert_eq!(pool.label(), frost::CLUSTER);
    assert_eq!(pool.program_label(), PROGRAM_LABEL);
    assert_eq!(wasm::sol_program_label(), PROGRAM_LABEL);
}

#[test]
fn each_cluster_and_mode_has_its_own_label_and_program_label() {
    let all = [
        Wallet::new(Cluster::Devnet, Mode::Pool).expect("wallet"),
        Wallet::new(Cluster::Devnet, Mode::Plain).expect("wallet"),
        Wallet::new(Cluster::Mainnet, Mode::Plain).expect("wallet"),
    ];
    let labels: std::collections::BTreeSet<_> = all.iter().map(Wallet::label).collect();
    let programs: std::collections::BTreeSet<_> = all.iter().map(Wallet::program_label).collect();
    assert_eq!((labels.len(), programs.len()), (3, 3));
}

#[test]
fn a_plain_program_label_names_the_genesis_the_programs_and_the_mint_table() {
    for (cluster, name) in [(Cluster::Devnet, "devnet"), (Cluster::Mainnet, "mainnet")] {
        let wallet = Wallet::new(cluster, Mode::Plain).expect("wallet");
        let mint = wallet.mints()[0];
        let want = format!(
            "zigs-plain-{name}:{}:{}:{}:{}:USDC={}/6",
            text(&wallet.genesis()),
            text(&SYSTEM_PROGRAM),
            text(&TOKEN_PROGRAM),
            text(&ATA_PROGRAM),
            text(&mint.key)
        );
        assert_eq!(wallet.program_label(), want);
    }
}

#[test]
fn the_digest_of_a_plain_wallet_includes_its_cluster_and_mode_label() {
    let message = [0x81u8, 1, 2, 3];
    let devnet = pins(Cluster::Devnet, Mode::Plain);
    let mainnet = pins(Cluster::Mainnet, Mode::Plain);
    let pool_devnet = pins(Cluster::Devnet, Mode::Pool);
    let digests = [
        p3_check::plain_sign::digest_of(&devnet.wallet, &message).expect("digest"),
        p3_check::plain_sign::digest_of(&mainnet.wallet, &message).expect("digest"),
        sign::digest_of("devnet", &message).expect("pool digest"),
    ];
    assert_ne!(
        digests[0], digests[1],
        "a Devnet digest never equals a mainnet digest"
    );
    assert_ne!(
        digests[0], digests[2],
        "a plain digest never equals the pool digest"
    );
    assert_ne!(digests[1], digests[2]);
    assert!(p3_check::plain_sign::digest_of(&pool_devnet.wallet, &message).is_err());
}

// ---- the pins and the intents on the wire --------------------------------------------------

#[test]
fn the_plain_pins_have_66_bytes_and_round_trip() {
    for cluster in [Cluster::Devnet, Cluster::Mainnet] {
        let pins = pins(cluster, Mode::Plain);
        let wire = pins.wire();
        assert_eq!(wire.len(), PINS_LEN);
        assert_eq!(PINS_LEN, 66);
        assert_eq!(PlainPins::decode(&wire).expect("decode"), pins);
        assert!(PlainPins::decode(&wire[..65]).is_err());
        assert!(PlainPins::decode(&[wire.clone(), vec![0]].concat()).is_err());
    }
}

#[test]
fn the_pins_wire_refuses_a_bad_cluster_or_mode_byte_and_mainnet_pool() {
    let mut wire = pins(Cluster::Devnet, Mode::Plain).wire();
    for (at, value) in [(0, 0), (0, 3), (1, 0), (1, 3)] {
        let mut bad = wire.clone();
        bad[at] = value;
        assert!(PlainPins::decode(&bad).is_err(), "byte {at} = {value}");
    }
    wire[0] = 2;
    wire[1] = 2;
    assert!(PlainPins::decode(&wire).is_err(), "mainnet and pool");
    wire[0] = 1;
    let pool = PlainPins::decode(&wire).expect("devnet pool decodes, the checker refuses it");
    assert_eq!(pool.wallet.mode, Mode::Pool);
}

#[test]
fn a_plain_entry_never_reads_pool_pins_and_a_pool_entry_never_reads_plain_pins() {
    let plain = pins(Cluster::Devnet, Mode::Plain).wire();
    assert!(Pins::decode(&plain).is_err(), "pool pins need 161 bytes");
    let pool = Pins::devnet(GROUP, [3; 32], [2; 33], PAYER, [4; 32]).expect("pool pins");
    assert_eq!(pool.wire().len(), 161);
    assert!(
        PlainPins::decode(&pool.wire()).is_err(),
        "plain pins have 66 bytes"
    );
    let answer = wasm::check_message(&[0x81], &[13], &plain, &[], 0);
    assert!(answer.starts_with("error"), "{answer}");
}

fn intents() -> Vec<PlainIntent> {
    vec![
        PlainIntent::CreateNonce {
            k: 7,
            blockhash: [5; 32],
        },
        PlainIntent::SendSol {
            k: 1,
            nonce: [6; 32],
            recipient: [7; 32],
            lamports: 42,
        },
        PlainIntent::SendToken {
            k: 2,
            nonce: [8; 32],
            token: 0,
            recipient: [9; 32],
            amount: 1_500_000,
        },
        PlainIntent::EnableToken {
            token: 0,
            blockhash: [10; 32],
        },
        PlainIntent::Cancel {
            k: 3,
            nonce: [11; 32],
        },
    ]
}

#[test]
fn the_plain_intents_use_the_tags_after_the_pool_intents_and_round_trip() {
    let tags: Vec<u8> = intents().iter().map(|i| i.encode()[0]).collect();
    assert_eq!(tags, vec![13, 14, 15, 16, 17]);
    for intent in intents() {
        let wire = intent.encode();
        assert_eq!(PlainIntent::decode(&wire).expect("decode"), intent);
        assert!(
            PlainIntent::decode(&wire[..wire.len() - 1]).is_err(),
            "{}",
            intent.name()
        );
        assert!(PlainIntent::decode(&[wire.clone(), vec![0]].concat()).is_err());
        assert!(
            Intent::decode(&wire).is_err(),
            "a pool entry refuses a plain intent"
        );
    }
}

#[test]
fn a_pool_intent_is_no_plain_intent() {
    let pool = Intent::Cancel { nonce: [1; 32] }.encode();
    assert!(PlainIntent::decode(&pool).is_err());
    for tag in 0..13u8 {
        assert!(PlainIntent::decode(&[tag; 100]).is_err(), "tag {tag}");
    }
    assert!(PlainIntent::decode(&[18; 100]).is_err());
    assert!(PlainIntent::decode(&[]).is_err());
}

#[test]
fn only_a_message_with_a_nonce_has_two_signers() {
    let signers: Vec<u8> = intents().iter().map(PlainIntent::signer_count).collect();
    assert_eq!(signers, vec![1, 2, 2, 1, 2]);
    let lifetimes: Vec<Key> = intents().iter().map(PlainIntent::lifetime).collect();
    assert_eq!(
        lifetimes,
        vec![[5; 32], [6; 32], [8; 32], [10; 32], [11; 32]]
    );
}

// ---- the rule table -----------------------------------------------------------------------

#[test]
fn plain_rule_table_matches_enum() {
    for (index, info) in PLAIN_INFO.iter().enumerate() {
        assert_eq!(info.rule as usize, index, "{}", info.id);
        assert_eq!(info.rule.id(), info.id);
    }
    assert_eq!(PlainRule::PlainMode as usize, 0);
}

#[test]
fn the_plain_rule_ids_are_unique_and_none_is_a_pool_rule_id() {
    let pool: Vec<&str> = p3_check::rule::INFO.iter().map(|i| i.id).collect();
    let mut seen = std::collections::BTreeSet::new();
    for info in PLAIN_INFO {
        assert!(seen.insert(info.id), "{} twice", info.id);
        assert!(info.id.starts_with("plain-"), "{}", info.id);
        assert!(!pool.contains(&info.id), "{} is a pool rule id", info.id);
    }
    assert_eq!(
        p3_check::rule::INFO.len(),
        101,
        "the pool rule count does not change"
    );
}
