//! The plain checker on the message: the five shapes S1 to S5 byte for byte, the independent
//! compilers, one changed byte, the config, the key table, each instruction, the exact compute
//! units, the approval screen and the parse. Each test names the rule that refuses the message.

#[path = "support/plain.rs"]
mod support;

use p3_check::consts::*;
use p3_check::plain::{Cluster, PlainIntent};
use p3_check::plain_check::PlainSigner;
use p3_check::plain_display::{base58, decimal};
use p3_check::plain_template::{
    compile, CU_BUMP_TRY, CU_CREATE_IDEMPOTENT, CU_MARGIN, CU_SYSTEM, CU_TRANSFER_CHECKED,
};
use p3_check::rule::PlainRule;
use p3_check::template::{Data, LOADED_MAX};
use p3_check::v1::{self, Ix};
use solana_address::Address;
use solana_hash::Hash;
use solana_instruction::{AccountMeta, Instruction};
use solana_message::v1 as solana_v1;
use solana_system_interface::instruction as system;
use support::*;

fn addr(key: &Key) -> Address {
    Address::from(*key)
}

// ---- the five shapes, byte for byte -------------------------------------------------------

#[test]
fn each_shape_is_accepted_byte_for_byte_on_mainnet_and_on_devnet() {
    for cluster in CLUSTERS {
        for (name, intent) in shapes() {
            let case = Case::new(cluster, intent);
            let bytes = case.bytes();
            let report = case.run(&bytes, PlainSigner::Fee).expect("a verdict");
            assert!(
                report.violations.is_empty(),
                "{name} {cluster:?}: {report:?}"
            );
            assert!(report.screen.is_some(), "{name}");
            assert_eq!(
                v1::write(&v1::parse(&bytes).unwrap()).unwrap(),
                bytes,
                "{name}"
            );
            assert_eq!(bytes[0], v1::V1_PREFIX, "{name}: a v1 message");
        }
    }
}

#[test]
fn the_shapes_have_the_instructions_and_signers_of_the_design() {
    let want: [(&str, &[Key], u8); 5] = [
        ("S1 create nonce", &[SYSTEM_PROGRAM, SYSTEM_PROGRAM], 1),
        ("S2 send SOL", &[SYSTEM_PROGRAM, SYSTEM_PROGRAM], 2),
        (
            "S3 send USDC",
            &[SYSTEM_PROGRAM, ATA_PROGRAM, TOKEN_PROGRAM],
            2,
        ),
        ("S4 enable USDC", &[ATA_PROGRAM], 1),
        ("S5 cancel", &[SYSTEM_PROGRAM], 2),
    ];
    for ((name, intent), (want_name, programs, signers)) in shapes().into_iter().zip(want) {
        assert_eq!(name, want_name);
        let compiled = Case::devnet(intent.clone()).compiled();
        let msg = &compiled.message;
        let have: Vec<Key> = msg
            .ixs
            .iter()
            .map(|ix| *msg.program_key(ix).unwrap())
            .collect();
        assert_eq!(have, programs, "{name}");
        assert_eq!(msg.header[0], signers, "{name}");
        assert_eq!(msg.keys[0], PAYER, "{name}: the payer is the first account");
        assert_eq!(msg.lifetime, intent.lifetime(), "{name}");
        assert!(
            !msg.keys.contains(&COMPUTE_BUDGET_PROGRAM),
            "{name}: no ComputeBudget"
        );
        assert_eq!(msg.config.priority_fee, None, "{name}: no priority fee");
        assert_eq!(msg.config.loaded_limit, Some(LOADED_MAX), "{name}");
        assert_eq!(msg.config.compute_units, Some(compiled.units), "{name}");
    }
}

#[test]
fn a_new_nonce_account_has_no_group_signature_and_the_group_key_is_only_instruction_data() {
    let msg = Case::devnet(create_nonce()).compiled().message;
    assert_eq!(msg.header, [1, 0, 3]);
    assert!(
        !msg.keys.contains(&group()),
        "the group key is no account of S1"
    );
    let init = &msg.ixs[1].data;
    assert_eq!(&init[..4], &SYS_INIT_NONCE.to_le_bytes());
    assert_eq!(
        &init[4..],
        &group(),
        "the authority of the nonce account is the group key"
    );
}

#[test]
fn the_compiled_messages_equal_the_solana_message_compiler_on_every_shape() {
    for cluster in CLUSTERS {
        for (name, intent) in shapes() {
            let compiled = Case::new(cluster, intent.clone()).compiled();
            let ixs: Vec<Instruction> = compiled
                .ixs
                .iter()
                .map(|ix| Instruction {
                    program_id: addr(&ix.program),
                    accounts: ix
                        .accounts
                        .iter()
                        .map(|a| AccountMeta {
                            pubkey: addr(&a.key),
                            is_signer: a.signer,
                            is_writable: a.writable,
                        })
                        .collect(),
                    data: match &ix.data {
                        Data::Exact(data) => data.clone(),
                        other => panic!("{other:?}"),
                    },
                })
                .collect();
            let config = solana_v1::TransactionConfig::empty()
                .with_compute_unit_limit(compiled.units)
                .with_loaded_accounts_data_size_limit(LOADED_MAX);
            let theirs = solana_v1::Message::try_compile_with_config(
                &addr(&PAYER),
                &ixs,
                Hash::new_from_array(intent.lifetime()),
                config,
            )
            .unwrap_or_else(|e| panic!("{name}: {e:?}"));
            let mine = v1::write(&compiled.message).unwrap();
            assert_eq!(theirs.serialize(), mine, "{name}");
        }
    }
}

/// An expected instruction against an instruction of the Solana crates: program, accounts with
/// their flags, and data.
fn same_instruction(ours: &p3_check::template::ExpectedIx, theirs: &Instruction, what: &str) {
    let Data::Exact(data) = &ours.data else {
        panic!("{what}: fixed data")
    };
    assert_eq!(data, &theirs.data, "{what}: data");
    assert_eq!(addr(&ours.program), theirs.program_id, "{what}: program");
    let flags: Vec<_> = ours
        .accounts
        .iter()
        .map(|a| (addr(&a.key), a.signer, a.writable))
        .collect();
    let metas: Vec<_> = theirs
        .accounts
        .iter()
        .map(|m| (m.pubkey, m.is_signer, m.is_writable))
        .collect();
    assert_eq!(flags, metas, "{what}: accounts");
}

#[test]
fn the_system_instructions_equal_the_system_interface_builders() {
    let (payer, group_key) = (addr(&PAYER), addr(&group()));
    let own = |k: u32| p3_check::plain_template::nonce_account(&PAYER, k);
    let seed = "zigs-n-0";
    assert_eq!(
        Address::create_with_seed(&payer, seed, &addr(&SYSTEM_PROGRAM))
            .unwrap()
            .to_bytes(),
        own(0),
        "the nonce account is the address of the seed under the fee key"
    );
    let create = system::create_nonce_account_with_seed(
        &payer,
        &addr(&own(0)),
        &payer,
        seed,
        &group_key,
        RENT_NONCE,
    );
    let advance = system::advance_nonce_account(&addr(&own(3)), &group_key);
    let transfer = system::transfer(&group_key, &addr(&recipient()), LAMPORTS);
    let cases = [
        (
            "S1",
            create_nonce(),
            vec![create[0].clone(), create[1].clone()],
        ),
        ("S5", cancel(), vec![advance.clone()]),
        (
            "S2",
            send_sol(recipient(), LAMPORTS),
            vec![advance, transfer],
        ),
    ];
    for (name, intent, theirs) in cases {
        let compiled = compile(&intent, &pins(Cluster::Mainnet)).unwrap();
        assert_eq!(compiled.ixs.len(), theirs.len(), "{name}");
        for (at, (ours, theirs)) in compiled.ixs.iter().zip(&theirs).enumerate() {
            same_instruction(ours, theirs, &format!("{name} instruction {at}"));
        }
    }
}

#[test]
fn the_token_instructions_have_the_layout_of_the_spl_programs() {
    let to = recipient();
    for cluster in CLUSTERS {
        let case = Case::new(cluster, send_token(to, UNITS));
        let compiled = case.compiled();
        let addr = compiled.addr;
        let (mint, source, dest) = (addr.mint.unwrap(), addr.source.unwrap(), addr.dest.unwrap());
        let flags = |ix: usize| -> Vec<(Key, bool, bool)> {
            compiled.ixs[ix]
                .accounts
                .iter()
                .map(|a| (a.key, a.signer, a.writable))
                .collect()
        };
        // ATA CreateIdempotent: funder, account, wallet, mint, System, Token program.
        assert_eq!(
            flags(1),
            vec![
                (PAYER, true, true),
                (dest.address, false, true),
                (to, false, false),
                (mint.key, false, false),
                (SYSTEM_PROGRAM, false, false),
                (TOKEN_PROGRAM, false, false),
            ]
        );
        assert_eq!(compiled.ixs[1].data, Data::Exact(vec![1]));
        // TransferChecked: source, mint, destination, authority; tag 12, amount, decimals.
        assert_eq!(
            flags(2),
            vec![
                (source.address, false, true),
                (mint.key, false, false),
                (dest.address, false, true),
                (group(), true, false),
            ]
        );
        let mut data = vec![12];
        data.extend_from_slice(&UNITS.to_le_bytes());
        data.push(6);
        assert_eq!(compiled.ixs[2].data, Data::Exact(data));
        assert_eq!(
            compiled.ixs[2].program, TOKEN_PROGRAM,
            "the legacy Token program only"
        );
    }
}

#[test]
fn the_associated_token_accounts_are_derived_under_the_ata_program() {
    let case = Case::mainnet(send_token(recipient(), UNITS));
    let addr = case.compiled().addr;
    let theirs = |wallet: &Key| {
        Address::find_program_address(
            &[wallet, &TOKEN_PROGRAM, &USDC_MAINNET],
            &Address::from(ATA_PROGRAM),
        )
    };
    let (source, dest) = (addr.source.unwrap(), addr.dest.unwrap());
    assert_eq!(
        (source.address, source.bump),
        (theirs(&group()).0.to_bytes(), theirs(&group()).1)
    );
    let want = theirs(&recipient());
    assert_eq!((dest.address, dest.bump), (want.0.to_bytes(), want.1));
}

// ---- one changed byte ------------------------------------------------------------------------

#[test]
fn one_changed_byte_at_any_position_of_any_shape_is_never_accepted() {
    for cluster in CLUSTERS {
        for (name, intent) in shapes() {
            let case = Case::new(cluster, intent);
            let good = case.bytes();
            for at in 0..good.len() {
                let mut bad = good.clone();
                bad[at] ^= 1;
                let accepted = match case.run(&bad, PlainSigner::Fee) {
                    Ok(report) => report.violations.is_empty(),
                    Err(_) => false,
                };
                assert!(!accepted, "{name} {cluster:?}: byte {at} changed");
            }
        }
    }
}

#[test]
fn a_message_with_one_byte_less_or_more_is_refused_by_the_parse_rule() {
    let case = Case::devnet(send_sol(recipient(), LAMPORTS));
    let good = case.bytes();
    let longer = [good.clone(), vec![0]].concat();
    for bytes in [good[..good.len() - 1].to_vec(), longer, Vec::new()] {
        assert_eq!(case.rules(&bytes), vec![PlainRule::PlainParse]);
    }
}

#[test]
fn an_off_chain_message_and_a_derive_payload_are_refused_by_the_parse_rule() {
    let case = Case::devnet(send_sol(recipient(), LAMPORTS));
    for prefix in [&OFFCHAIN_MAGIC[..], DERIVE_PREFIX] {
        let bytes = [prefix, &case.bytes()].concat();
        assert_eq!(case.rules(&bytes), vec![PlainRule::PlainParse]);
    }
    let legacy = [vec![0x00], case.bytes()[1..].to_vec()].concat();
    assert_eq!(
        case.rules(&legacy),
        vec![PlainRule::PlainParse],
        "not a v1 message"
    );
}

// ---- each part of the message -----------------------------------------------------------------

#[test]
fn a_changed_compute_unit_or_loaded_limit_is_refused_by_the_config_rule() {
    for (name, intent) in shapes() {
        let case = Case::devnet(intent);
        let units = case.compiled().units;
        for other in [units - 1, units + 1, 0, 1_400_000, u32::MAX] {
            let bytes = edit(&case.bytes(), |m| m.config.compute_units = Some(other));
            assert_eq!(
                case.rules(&bytes),
                vec![PlainRule::PlainConfig],
                "{name}: {other} units"
            );
        }
        for other in [LOADED_MAX - 1, 214_500, 1] {
            let bytes = edit(&case.bytes(), |m| m.config.loaded_limit = Some(other));
            assert_eq!(
                case.rules(&bytes),
                vec![PlainRule::PlainConfig],
                "{name}: {other} loaded"
            );
        }
        assert!(case.accepts(), "{name}: the compiled value is accepted");
    }
}

#[test]
fn a_priority_fee_a_heap_size_or_a_missing_limit_is_refused_by_the_config_rule() {
    let case = Case::mainnet(send_sol(recipient(), LAMPORTS));
    let edits: [fn(&mut v1::Message); 4] = [
        |m| m.config.priority_fee = Some(0),
        |m| m.config.priority_fee = Some(3_000),
        |m| m.config.heap_size = Some(64 * 1024),
        |m| m.config.compute_units = None,
    ];
    for change in edits {
        let bytes = edit(&case.bytes(), change);
        assert!(case.rules(&bytes).contains(&PlainRule::PlainConfig));
    }
}

#[test]
fn a_message_paid_by_another_key_is_refused_by_the_payer_rule() {
    for (name, intent) in shapes() {
        let case = Case::devnet(intent);
        let bytes = edit(&case.bytes(), |m| m.keys[0] = [0x66; 32]);
        assert!(
            case.rules(&bytes).contains(&PlainRule::PlainPayer),
            "{name}"
        );
    }
}

#[test]
fn a_payer_that_is_the_group_key_is_refused_by_the_payer_rule_and_does_not_compile() {
    let mut case = Case::devnet(cancel());
    let good = case.bytes();
    case.pins.payer = case.pins.group;
    assert_eq!(case.rules(&good), vec![PlainRule::PlainPayer]);
    assert!(compile(&case.intent, &case.pins).is_err());
}

#[test]
fn a_changed_number_of_required_signatures_is_refused_by_the_signers_rule() {
    for (name, intent) in shapes() {
        let case = Case::devnet(intent);
        let signers = case.compiled().message.header[0];
        // A count that the table cannot hold does not parse; the others reach the rule. The
        // readonly counts are kept, so the table stays valid when one signer is added or removed.
        let bytes = edit(&case.bytes(), |m| m.header[0] = signers + 1);
        let rules = case.rules(&bytes);
        assert!(
            rules.contains(&PlainRule::PlainSigners) || rules == vec![PlainRule::PlainParse],
            "{name}: {rules:?}"
        );
        if signers == 2 {
            // One signer fewer, with no readonly signer, so that the message still parses.
            let bytes = edit(&case.bytes(), |m| {
                m.header[0] = 1;
                m.header[1] = 0;
            });
            let rules = case.rules(&bytes);
            assert!(
                rules.contains(&PlainRule::PlainSigners),
                "{name}: {rules:?}"
            );
        }
    }
}

#[test]
fn a_changed_account_table_is_refused_by_the_key_table_rule() {
    let case = Case::devnet(send_token(recipient(), UNITS));
    let last = case.compiled().message.keys.len() - 1;
    type Change = Box<dyn Fn(&mut v1::Message)>;
    let edits: [(&str, Change); 4] = [
        ("an extra account", Box::new(|m| m.keys.push([0x77; 32]))),
        (
            "a swapped pair",
            Box::new(move |m| m.keys.swap(last - 1, last)),
        ),
        ("a readonly count", Box::new(|m| m.header[2] -= 1)),
        ("a writable signer", Box::new(|m| m.header[1] = 0)),
    ];
    for (name, change) in edits {
        let bytes = edit(&case.bytes(), change);
        assert!(
            case.rules(&bytes).contains(&PlainRule::PlainKeyTable),
            "{name}"
        );
    }
}

#[test]
fn another_lifetime_is_refused_by_the_lifetime_rule() {
    for (name, intent) in shapes() {
        let case = Case::devnet(intent);
        let bytes = edit(&case.bytes(), |m| m.lifetime[0] ^= 1);
        assert_eq!(case.rules(&bytes), vec![PlainRule::PlainLifetime], "{name}");
    }
}

#[test]
fn an_extra_or_a_missing_instruction_is_refused_by_the_instruction_count_rule() {
    let case = Case::devnet(send_sol(recipient(), LAMPORTS));
    let extra = edit(&case.bytes(), |m| {
        m.keys.push(COMPUTE_BUDGET_PROGRAM);
        let program = u8::try_from(m.keys.len() - 1).unwrap();
        m.ixs.push(Ix {
            program,
            accounts: Vec::new(),
            data: vec![2, 0, 0, 0, 0],
        });
        m.header[2] += 1;
    });
    assert!(case
        .rules(&extra)
        .contains(&PlainRule::PlainInstructionCount));
    let missing = edit(&case.bytes(), |m| {
        m.ixs.pop();
    });
    assert!(case
        .rules(&missing)
        .contains(&PlainRule::PlainInstructionCount));
}

#[test]
fn another_program_in_an_instruction_is_refused_by_the_program_rule() {
    let case = Case::devnet(send_token(recipient(), UNITS));
    for (at, other) in [
        (1, TOKEN_2022_PROGRAM),
        (2, ATA_PROGRAM),
        (2, SYSTEM_PROGRAM),
        (0, COMPUTE_BUDGET_PROGRAM),
        (0, TOKEN_PROGRAM),
    ] {
        let bytes = edit(&case.bytes(), |m| {
            // Point the instruction at the program, adding it to the table if it is missing.
            let slot = m
                .keys
                .iter()
                .position(|key| *key == other)
                .unwrap_or_else(|| {
                    m.keys.push(other);
                    m.header[2] += 1;
                    m.keys.len() - 1
                });
            m.ixs[at].program = u8::try_from(slot).unwrap();
        });
        assert!(
            case.rules(&bytes).contains(&PlainRule::PlainProgram),
            "instruction {at} runs {}",
            base58(&other)
        );
    }
}

#[test]
fn another_account_in_an_instruction_is_refused_by_the_accounts_rule() {
    for (name, intent) in shapes() {
        let case = Case::mainnet(intent);
        let count = case.compiled().message.ixs.len();
        for at in 0..count {
            let bytes = edit(&case.bytes(), |m| {
                m.ixs[at].accounts.swap(0, 1);
            });
            let rules = case.rules(&bytes);
            assert!(
                rules.contains(&PlainRule::PlainAccounts),
                "{name} instruction {at}"
            );
            let shorter = edit(&case.bytes(), |m| {
                m.ixs[at].accounts.pop();
            });
            assert!(
                case.rules(&shorter).contains(&PlainRule::PlainAccounts),
                "{name} {at} short"
            );
        }
    }
}

#[test]
fn one_changed_byte_in_the_data_of_each_instruction_is_refused_by_the_data_rule() {
    for (name, intent) in shapes() {
        let case = Case::devnet(intent);
        let good = case.compiled().message;
        for (at, ix) in good.ixs.iter().enumerate() {
            for byte in 0..ix.data.len() {
                let bytes = edit(&case.bytes(), |m| m.ixs[at].data[byte] ^= 1);
                let rules = case.rules(&bytes);
                assert!(
                    rules.contains(&PlainRule::PlainData),
                    "{name}: ix {at} byte {byte}"
                );
            }
        }
    }
}

// ---- the exact compute units ---------------------------------------------------------------

/// A recipient wallet whose token account address needs exactly `tries` failed bump tries.
fn recipient_with_tries(tries: u8) -> Key {
    (0..=u8::MAX)
        .flat_map(|a| (0..=u8::MAX).map(move |b| [a, b]))
        .map(|seed| on_curve_pair(seed[0], seed[1]))
        .find(|wallet| {
            let seeds: [&[u8]; 3] = [wallet, &TOKEN_PROGRAM, &USDC_DEVNET];
            let bump = p3_check::pda::find_program_address(&seeds, &ATA_PROGRAM)
                .unwrap()
                .1;
            255 - bump == tries
        })
        .expect("a recipient")
}

fn on_curve_pair(a: u8, b: u8) -> Key {
    let mut seed = [a; 32];
    seed[1] = b;
    ed25519_dalek::SigningKey::from_bytes(&seed)
        .verifying_key()
        .to_bytes()
}

#[test]
fn a_recipient_token_account_with_3_failed_bump_tries_gets_the_exact_compute_units() {
    for tries in [0u8, 1, 3] {
        let to = recipient_with_tries(tries);
        let case = Case::devnet(send_token(to, UNITS));
        let want = CU_SYSTEM
            + CU_CREATE_IDEMPOTENT
            + CU_BUMP_TRY * u32::from(tries)
            + CU_TRANSFER_CHECKED
            + CU_MARGIN;
        let compiled = case.compiled();
        assert_eq!(compiled.units, want, "{tries} failed tries");
        assert_eq!(compiled.message.config.compute_units, Some(want));
        assert!(case.accepts());
        // The value for 0 tries is refused for a recipient that needs more, and the reverse.
        let other = Case::devnet(send_token(recipient_with_tries(0), UNITS))
            .compiled()
            .units;
        if tries != 0 {
            assert_eq!(want - other, CU_BUMP_TRY * u32::from(tries));
            let bytes = edit(&case.bytes(), |m| m.config.compute_units = Some(other));
            assert_eq!(case.rules(&bytes), vec![PlainRule::PlainConfig]);
        }
    }
}

#[test]
fn the_group_token_account_of_enable_gets_its_own_failed_tries_in_the_compute_units() {
    let case = Case::devnet(enable_token());
    let compiled = case.compiled();
    let source = compiled.addr.source.unwrap();
    let tries = 255 - u32::from(source.bump);
    assert_eq!(
        compiled.units,
        CU_CREATE_IDEMPOTENT + CU_BUMP_TRY * tries + CU_MARGIN,
        "{tries} failed tries"
    );
}

#[test]
fn the_compute_units_are_one_exact_value_for_each_shape_and_never_a_range() {
    let case = Case::devnet(send_sol(recipient(), LAMPORTS));
    assert_eq!(case.compiled().units, 2 * CU_SYSTEM + CU_MARGIN);
    assert_eq!(
        Case::devnet(create_nonce()).compiled().units,
        2 * CU_SYSTEM + CU_MARGIN
    );
    assert_eq!(
        Case::devnet(cancel()).compiled().units,
        CU_SYSTEM + CU_MARGIN
    );
    for (name, intent) in shapes() {
        let case = Case::devnet(intent);
        let units = case.compiled().units;
        for other in [units - 1, units + 1] {
            let bytes = edit(&case.bytes(), |m| m.config.compute_units = Some(other));
            assert!(!case.rules(&bytes).is_empty(), "{name}: {other}");
        }
    }
}

// ---- the approval screen -----------------------------------------------------------------------

fn screen(case: &Case) -> String {
    case.run(&case.bytes(), PlainSigner::Fee)
        .unwrap()
        .screen
        .expect("accepted")
}

#[test]
fn the_screen_of_a_sol_send_has_the_full_recipient_the_amount_the_fee_and_the_cluster() {
    let text = screen(&Case::mainnet(send_sol(recipient(), LAMPORTS)));
    let want = [
        "intent send-sol".to_string(),
        "cluster mainnet".to_string(),
        format!("recipient {}", Address::from(recipient())),
        "amount 1.500000000".to_string(),
        "units 1500000000".to_string(),
        "symbol SOL".to_string(),
        "fee 10000".to_string(),
        "rent 0".to_string(),
        format!("payer {}", Address::from(PAYER)),
        format!("group {}", Address::from(group())),
    ]
    .join("\n");
    assert_eq!(text, want);
    assert_eq!(
        Address::from(recipient()).to_string().len(),
        base58(&recipient()).len()
    );
}

#[test]
fn the_screen_of_a_token_send_has_the_symbol_the_pinned_mint_and_the_rent_of_a_new_account() {
    let text = screen(&Case::mainnet(send_token(recipient(), UNITS)));
    for line in [
        "intent send-token",
        "cluster mainnet",
        "amount 2.500000",
        "units 2500000",
        "symbol USDC",
        "mint EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
        "fee 10000",
        "rent 1488440",
    ] {
        assert!(text.lines().any(|l| l == line), "{line}\n{text}");
    }
    let devnet = screen(&Case::devnet(send_token(recipient(), UNITS)));
    assert!(devnet.contains("cluster devnet"));
    assert!(devnet.contains("mint 4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU"));
    let known = Case::devnet(send_token(recipient(), UNITS)).read(
        p3_check::plain_chain::Role::Dest,
        Some(token_account(&USDC_DEVNET, &recipient(), 0)),
    );
    assert!(
        screen(&known).contains("rent 0"),
        "no rent for a token account that exists"
    );
}

#[test]
fn the_screen_of_the_other_shapes_shows_the_fee_and_the_rent_the_payer_funds() {
    let nonce = screen(&Case::devnet(create_nonce()));
    assert!(
        nonce.contains("fee 5000") && nonce.contains("rent 1056640"),
        "{nonce}"
    );
    let enable = screen(&Case::devnet(enable_token()));
    assert!(
        enable.contains("fee 5000") && enable.contains("rent 1488440"),
        "{enable}"
    );
    assert!(!enable.contains("recipient"), "{enable}");
    let cancelled = screen(&Case::devnet(cancel()));
    assert!(
        cancelled.contains("fee 10000") && cancelled.contains("rent 0"),
        "{cancelled}"
    );
}

#[test]
fn the_base58_text_equals_solana_address_for_random_keys_and_leading_zero_bytes() {
    let mut keys: Vec<Key> = (0..64u8).map(on_curve).collect();
    keys.extend([
        [0u8; 32],
        [255; 32],
        SYSTEM_PROGRAM,
        TOKEN_PROGRAM,
        RENT_SYSVAR,
    ]);
    let mut zeros = [7u8; 32];
    zeros[..3].fill(0);
    keys.push(zeros);
    for key in keys {
        assert_eq!(base58(&key), Address::from(key).to_string());
    }
    assert_eq!(base58(&[]), "");
}

#[test]
fn an_amount_has_exactly_its_decimals_and_no_rounding() {
    assert_eq!(decimal(1_500_000, 6), "1.500000");
    assert_eq!(decimal(1, 6), "0.000001");
    assert_eq!(decimal(0, 6), "0.000000");
    assert_eq!(decimal(u64::MAX, 6), "18446744073709.551615");
    assert_eq!(decimal(5_000, 9), "0.000005000");
    assert_eq!(decimal(42, 0), "42");
}

// ---- a pool message and the group signer -----------------------------------------------------

#[test]
fn a_message_of_the_pool_is_never_accepted_as_a_plain_message() {
    let pool = std::fs::read(format!(
        "{}/vectors/smoke/{}",
        env!("CARGO_MANIFEST_DIR"),
        std::fs::read_dir(format!("{}/vectors/smoke", env!("CARGO_MANIFEST_DIR")))
            .unwrap()
            .filter_map(|e| e.ok())
            .map(|e| e.file_name().to_string_lossy().to_string())
            .find(|name| name.ends_with(".msg"))
            .expect("a pool message")
    ))
    .unwrap();
    for (name, intent) in shapes() {
        let case = Case::devnet(intent);
        let accepted = match case.run(&pool, PlainSigner::Fee) {
            Ok(report) => report.violations.is_empty(),
            Err(_) => false,
        };
        assert!(!accepted, "{name}");
    }
}

#[test]
fn the_group_key_signs_a_send_and_a_cancel_and_never_a_new_nonce_or_an_enable() {
    for (name, intent) in shapes() {
        let case = Case::devnet(intent.clone());
        let report = case.run(&case.bytes(), PlainSigner::Group).unwrap();
        let rules: Vec<PlainRule> = report.violations.iter().map(|v| v.rule).collect();
        let group_may_sign = matches!(
            intent,
            PlainIntent::SendSol { .. }
                | PlainIntent::SendToken { .. }
                | PlainIntent::Cancel { .. }
        );
        let want = if group_may_sign {
            vec![]
        } else {
            vec![PlainRule::PlainSigner]
        };
        assert_eq!(rules, want, "{name}");
        let fee = case.run(&case.bytes(), PlainSigner::Fee).unwrap();
        assert!(
            fee.violations.is_empty(),
            "{name}: the fee key signs all five"
        );
    }
}
