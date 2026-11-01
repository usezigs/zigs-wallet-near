//! The rules of the plain wallet that read the wallet, the intent and the chain: the mode, the
//! genesis hash, the token, the recipient, the amount, the accounts that the page read and the
//! rent-state of the accounts that a message changes. A failed nonce transaction burns every
//! approval, so each of these refusals is a message that the runtime would fail after the nonce
//! advanced. Each test has the accepted case and at least one refusal.

#[path = "support/plain.rs"]
mod support;

use p3_check::consts::*;
use p3_check::plain::{Cluster, Mode, PlainIntent, Wallet};
use p3_check::plain_chain::{Account, Role};
use p3_check::rule::PlainRule as R;
use support::*;

const MIN: u64 = RENT_ZERO;

fn only(case: &Case, rule: R) {
    assert_eq!(case.refused_rules(), vec![rule]);
}

fn owned_by(owner: Key) -> Account {
    Account {
        lamports: 1_000_000,
        owner,
        executable: false,
        data: Vec::new(),
    }
}

// ---- the wallet: mode and genesis -----------------------------------------------------------

#[test]
fn a_pool_wallet_is_refused_by_the_mode_rule_and_a_plain_wallet_is_not() {
    for cluster in CLUSTERS {
        let mut case = Case::new(cluster, send_sol(recipient(), LAMPORTS));
        assert!(case.accepts());
        let bytes = case.bytes();
        case.pins.wallet = Wallet {
            cluster: Cluster::Devnet,
            mode: Mode::Pool,
        };
        case.chain.genesis = case.pins.wallet.genesis();
        assert_eq!(case.rules(&bytes), vec![R::PlainMode], "{cluster:?}");
    }
    assert!(
        Wallet::new(Cluster::Mainnet, Mode::Pool).is_err(),
        "mainnet has no pool mode"
    );
}

#[test]
fn a_genesis_hash_that_is_not_the_pin_of_the_cluster_is_refused_by_the_genesis_rule() {
    let wrong = [
        ("zero", [0u8; 32]),
        ("devnet", DEVNET_GENESIS),
        ("mainnet", MAINNET_GENESIS),
        ("one bit", {
            let mut key = MAINNET_GENESIS;
            key[31] ^= 1;
            key
        }),
    ];
    for cluster in CLUSTERS {
        let mut case = Case::new(cluster, send_sol(recipient(), LAMPORTS));
        assert!(case.accepts());
        let own = case.pins.wallet.genesis();
        for (name, genesis) in wrong {
            case.chain.genesis = genesis;
            let want = if genesis == own {
                vec![]
            } else {
                vec![R::PlainGenesis]
            };
            assert_eq!(case.refused_rules(), want, "{cluster:?} with {name}");
        }
    }
}

// ---- the token -------------------------------------------------------------------------------

#[test]
fn a_token_that_is_not_in_the_table_of_the_cluster_is_refused_by_the_token_rule() {
    for intent in [send_token(recipient(), UNITS), enable_token()] {
        let mut case = Case::devnet(intent);
        assert!(case.accepts());
        let bytes = case.bytes();
        for token in [1u8, 2, 255] {
            case.intent = match case.intent.clone() {
                PlainIntent::SendToken {
                    k,
                    nonce,
                    recipient,
                    amount,
                    ..
                } => PlainIntent::SendToken {
                    k,
                    nonce,
                    token,
                    recipient,
                    amount,
                },
                PlainIntent::EnableToken { blockhash, .. } => {
                    PlainIntent::EnableToken { token, blockhash }
                }
                other => other,
            };
            assert_eq!(case.rules(&bytes), vec![R::PlainToken], "token {token}");
        }
    }
}

// ---- the recipient ---------------------------------------------------------------------------

#[test]
fn a_recipient_that_is_off_the_curve_is_refused_by_the_curve_rule() {
    let pda = off_curve();
    assert!(!p3_check::pda::is_on_curve(&pda));
    let token_account = Case::devnet(send_token(recipient(), UNITS))
        .compiled()
        .addr
        .dest
        .unwrap();
    for to in [pda, token_account.address] {
        for intent in [send_sol(to, LAMPORTS), send_token(to, UNITS)] {
            let case = Case::devnet(intent);
            assert!(case.refuses(R::PlainRecipientCurve), "{}", base58(&to));
        }
    }
    assert!(Case::devnet(send_sol(recipient(), LAMPORTS)).accepts());
}

fn base58(key: &Key) -> String {
    p3_check::plain_display::base58(key)
}

#[test]
fn the_group_the_payer_the_nonce_a_program_a_sysvar_and_a_mint_are_no_recipients() {
    let nonce = Case::devnet(cancel()).compiled().addr.nonce.unwrap();
    let reserved = [
        group(),
        PAYER,
        nonce,
        SYSTEM_PROGRAM,
        TOKEN_PROGRAM,
        TOKEN_2022_PROGRAM,
        ATA_PROGRAM,
        COMPUTE_BUDGET_PROGRAM,
        ED25519_PROGRAM,
        CLOCK_SYSVAR,
        RENT_SYSVAR,
        RECENT_BLOCKHASHES,
        POOL_DEVNET,
        MULTISIG_DEVNET,
        USDC_MAINNET,
        USDC_DEVNET,
    ];
    for to in reserved {
        for cluster in CLUSTERS {
            for intent in [send_sol(to, LAMPORTS), send_token(to, UNITS)] {
                let case = Case::new(cluster, intent);
                assert!(case.refuses(R::PlainRecipientReserved), "{}", base58(&to));
            }
        }
    }
    let ok = Case::mainnet(send_token(recipient(), UNITS));
    assert!(ok.accepts(), "an ordinary wallet is a recipient");
}

#[test]
fn a_recipient_owned_by_a_program_that_is_not_the_system_program_is_refused() {
    let programs = [
        TOKEN_PROGRAM,
        ATA_PROGRAM,
        BPF_LOADER_UPGRADEABLE,
        [0x55; 32],
    ];
    for owner in programs {
        for intent in [
            send_sol(recipient(), LAMPORTS),
            send_token(recipient(), UNITS),
        ] {
            let case = Case::devnet(intent).read(Role::Recipient, Some(owned_by(owner)));
            only(&case, R::PlainRecipientOwner);
        }
    }
    let executable = Account {
        executable: true,
        ..system_account(MIN)
    };
    let with_data = Account {
        data: vec![1; 80],
        ..system_account(MIN)
    };
    for bad in [executable, with_data] {
        let case = Case::devnet(send_sol(recipient(), LAMPORTS)).read(Role::Recipient, Some(bad));
        only(&case, R::PlainRecipientOwner);
    }
    for good in [None, Some(system_account(0)), Some(system_account(5 * MIN))] {
        let case = Case::devnet(send_token(recipient(), UNITS)).read(Role::Recipient, good);
        assert!(case.accepts());
    }
}

// ---- the amount ------------------------------------------------------------------------------

#[test]
fn an_amount_of_zero_or_over_the_balance_is_refused_by_the_amount_rule() {
    let sol = |amount| Case::devnet(send_sol(recipient(), amount));
    assert!(
        sol(1).refuses(R::PlainRentRecipient),
        "1 lamport is under the minimum"
    );
    assert_eq!(
        sol(0).refused_rules(),
        vec![R::PlainAmount, R::PlainRentRecipient]
    );
    let balance = 5_000_000_000;
    assert!(
        sol(balance).accepts(),
        "the whole balance leaves the group at 0"
    );
    assert_eq!(sol(balance + 1).refused_rules(), vec![R::PlainAmount]);
    let token = |amount| Case::devnet(send_token(recipient(), amount));
    assert!(token(1).accepts());
    only(&token(0), R::PlainAmount);
    assert!(token(10_000_000).accepts(), "the whole token balance");
    only(&token(10_000_001), R::PlainAmount);
}

// ---- what the page read ---------------------------------------------------------------------

#[test]
fn rent_minimums_that_differ_from_the_pins_are_refused_by_the_rent_pin_rule() {
    let case = Case::mainnet(send_token(recipient(), UNITS));
    assert!(case.accepts());
    for change in [
        |c: &mut Case| c.chain.rents.zero = 890_880,
        |c: &mut Case| c.chain.rents.nonce += 1,
        |c: &mut Case| c.chain.rents.token -= 1,
        |c: &mut Case| c.chain.rents = Default::default(),
    ] {
        let mut bad = case.clone();
        change(&mut bad);
        only(&bad, R::PlainRentPin);
    }
}

#[test]
fn a_read_of_another_address_is_refused_by_the_chain_key_rule() {
    for (name, intent) in shapes() {
        let case = Case::devnet(intent);
        for (role, seen) in case.chain.reads.clone() {
            let mut other = seen.key;
            other[0] ^= 1;
            let bad = case.clone().read_key(role, other);
            assert!(
                bad.refuses(R::PlainChainKey),
                "{name}: the {} read",
                role.name()
            );
        }
    }
}

#[test]
fn a_page_that_leaves_out_a_read_gets_an_error_and_no_verdict() {
    for (name, intent) in shapes() {
        let mut case = Case::devnet(intent);
        let bytes = case.bytes();
        for at in 0..case.chain.reads.len() {
            let mut cut = case.clone();
            cut.chain.reads.remove(at);
            assert!(
                cut.run(&bytes, p3_check::plain_check::PlainSigner::Fee)
                    .is_err(),
                "{name}"
            );
        }
        case.chain.reads.clear();
        assert!(
            case.run(&bytes, p3_check::plain_check::PlainSigner::Fee)
                .is_err(),
            "{name}"
        );
    }
}

fn nonce_with(change: impl FnOnce(&mut Account)) -> Account {
    let mut account = Case::devnet(cancel()).chain.reads[1]
        .1
        .account
        .clone()
        .expect("nonce");
    change(&mut account);
    account
}

#[test]
fn the_nonce_account_must_be_initialised_for_the_group_with_the_lifetime_as_its_value() {
    let wrong_authority = nonce_data(&recipient(), &NONCE_VALUE);
    let stale = nonce_data(&group(), &[0x99; 32]);
    let mut uninitialised = nonce_data(&group(), &NONCE_VALUE);
    uninitialised[4] = 0;
    let mut legacy = nonce_data(&group(), &NONCE_VALUE);
    legacy[0] = 0;
    let bad = [
        ("absent", None),
        (
            "foreign owner",
            Some(nonce_with(|a| a.owner = TOKEN_PROGRAM)),
        ),
        ("too short", Some(nonce_with(|a| a.data.truncate(79)))),
        ("too long", Some(nonce_with(|a| a.data.push(0)))),
        (
            "uninitialised",
            Some(nonce_with(|a| a.data = uninitialised.clone())),
        ),
        (
            "legacy version",
            Some(nonce_with(|a| a.data = legacy.clone())),
        ),
        (
            "another authority",
            Some(nonce_with(|a| a.data = wrong_authority.clone())),
        ),
        (
            "another value",
            Some(nonce_with(|a| a.data = stale.clone())),
        ),
    ];
    for intent in [
        send_sol(recipient(), LAMPORTS),
        send_token(recipient(), UNITS),
        cancel(),
    ] {
        assert!(Case::devnet(intent.clone()).accepts());
        for (name, account) in bad.clone() {
            let case = Case::devnet(intent.clone()).read(Role::Nonce, account);
            only(&case, R::PlainNonceAccount);
            let _ = name;
        }
    }
}

#[test]
fn a_new_nonce_account_must_be_absent() {
    assert!(Case::devnet(create_nonce()).accepts());
    let case = Case::devnet(create_nonce()).read(Role::Nonce, Some(nonce_with(|_| {})));
    only(&case, R::PlainNonceAccount);
}

fn source_with(change: impl FnOnce(&mut Account)) -> Account {
    let mut account = token_account(&USDC_DEVNET, &group(), 10_000_000);
    change(&mut account);
    account
}

#[test]
fn a_token_account_of_the_group_must_be_initialised_with_the_pinned_mint_and_the_group_as_owner() {
    let state = |state: u8| token_data(&USDC_DEVNET, &group(), 10_000_000, state);
    let bad = [
        ("frozen", Some(source_with(|a| a.data = state(2)))),
        ("uninitialised", Some(source_with(|a| a.data = state(0)))),
        (
            "another mint",
            Some(source_with(|a| {
                a.data = token_data(&USDC_MAINNET, &group(), 10_000_000, 1)
            })),
        ),
        (
            "another owner",
            Some(source_with(|a| {
                a.data = token_data(&USDC_DEVNET, &recipient(), 10_000_000, 1)
            })),
        ),
        (
            "another program",
            Some(source_with(|a| a.owner = TOKEN_2022_PROGRAM)),
        ),
        (
            "system owner",
            Some(source_with(|a| a.owner = SYSTEM_PROGRAM)),
        ),
        ("too short", Some(source_with(|a| a.data.truncate(164)))),
        ("absent", None),
    ];
    for (name, account) in bad.clone() {
        let case = Case::devnet(send_token(recipient(), UNITS)).read(Role::Source, account);
        assert!(case.refuses(R::PlainSourceAccount), "send, {name}");
    }
    // Enable accepts a missing account, and an existing one only if it is valid.
    assert!(Case::devnet(enable_token()).accepts());
    let valid = Case::devnet(enable_token()).read(Role::Source, Some(source_with(|_| {})));
    assert!(valid.accepts());
    for (name, account) in bad.into_iter().filter(|(name, _)| *name != "absent") {
        let case = Case::devnet(enable_token()).read(Role::Source, account);
        assert!(case.refuses(R::PlainSourceAccount), "enable, {name}");
    }
}

#[test]
fn a_token_account_of_the_recipient_that_exists_must_be_the_recipients_and_not_frozen() {
    let to = recipient();
    let dest = |data: Vec<u8>, owner: Key| Account {
        data,
        owner,
        ..token_account(&USDC_DEVNET, &to, 0)
    };
    let valid = token_data(&USDC_DEVNET, &to, 7, 1);
    let case = Case::devnet(send_token(to, UNITS))
        .read(Role::Dest, Some(dest(valid.clone(), TOKEN_PROGRAM)));
    assert!(case.accepts(), "a token account that exists is no obstacle");
    let bad = [
        (
            "frozen",
            dest(token_data(&USDC_DEVNET, &to, 7, 2), TOKEN_PROGRAM),
        ),
        (
            "uninitialised",
            dest(token_data(&USDC_DEVNET, &to, 7, 0), TOKEN_PROGRAM),
        ),
        (
            "another mint",
            dest(token_data(&USDC_MAINNET, &to, 7, 1), TOKEN_PROGRAM),
        ),
        (
            "another owner",
            dest(token_data(&USDC_DEVNET, &group(), 7, 1), TOKEN_PROGRAM),
        ),
        ("another program", dest(valid.clone(), TOKEN_2022_PROGRAM)),
        ("system owner", dest(Vec::new(), SYSTEM_PROGRAM)),
    ];
    for (name, account) in bad {
        let case = Case::devnet(send_token(to, UNITS)).read(Role::Dest, Some(account));
        only(&case, R::PlainDestAccount);
        let _ = name;
    }
}

// ---- the rent-state ---------------------------------------------------------------------------

/// The lamports that the fee key must hold for each shape before the fee and the rent.
fn cost(intent: &PlainIntent) -> u64 {
    intent.fee()
        + match intent {
            PlainIntent::CreateNonce { .. } => RENT_NONCE,
            PlainIntent::SendToken { .. } | PlainIntent::EnableToken { .. } => RENT_TOKEN,
            _ => 0,
        }
}

#[test]
fn the_payer_ends_with_0_or_at_least_650240_lamports_after_the_fee_and_the_rent() {
    for (name, intent) in shapes() {
        let cost = cost(&intent);
        let holds = |lamports: u64| Case::devnet(intent.clone()).lamports(Role::Payer, lamports);
        assert_eq!(holds(cost).refused_rules(), vec![], "{name}: ends at 0");
        assert!(holds(cost + MIN).accepts(), "{name}: ends at 650,240");
        assert!(holds(cost + MIN + 1).accepts(), "{name}: ends at 650,241");
        only(&holds(cost + MIN - 1), R::PlainRentPayer);
        only(&holds(cost + 1), R::PlainRentPayer);
        only(&holds(cost - 1), R::PlainRentPayer);
        only(&holds(0), R::PlainRentPayer);
        let absent = Case::devnet(intent.clone()).read(Role::Payer, None);
        only(&absent, R::PlainRentPayer);
    }
}

#[test]
fn a_token_account_that_exists_costs_the_payer_no_rent() {
    let to = recipient();
    let known = Account {
        owner: TOKEN_PROGRAM,
        ..token_account(&USDC_DEVNET, &to, 0)
    };
    let case = |lamports: u64| {
        Case::devnet(send_token(to, UNITS))
            .read(Role::Dest, Some(known.clone()))
            .lamports(Role::Payer, lamports)
    };
    assert!(case(10_000).accepts(), "only the fee");
    assert!(case(10_000 + MIN).accepts());
    only(&case(10_000 + 1), R::PlainRentPayer);
    let enabled = Case::devnet(enable_token()).read(Role::Source, Some(source_with(|_| {})));
    assert!(enabled.clone().lamports(Role::Payer, 5_000).accepts());
}

#[test]
fn after_a_sol_send_the_group_holds_0_or_at_least_the_rent_minimum() {
    let amount = LAMPORTS;
    let holds =
        |lamports: u64| Case::devnet(send_sol(recipient(), amount)).lamports(Role::Group, lamports);
    assert!(holds(amount).accepts(), "ends at 0");
    assert!(holds(amount + MIN).accepts(), "ends at 650,240");
    only(&holds(amount + MIN - 1), R::PlainRentGroup);
    only(&holds(amount + 1), R::PlainRentGroup);
    only(&holds(amount - 1), R::PlainAmount);
    only(&holds(0), R::PlainAmount);
}

#[test]
fn a_recipient_of_a_sol_send_ends_with_at_least_the_rent_minimum() {
    let to = |amount: u64| Case::devnet(send_sol(recipient(), amount));
    assert!(
        to(MIN).accepts(),
        "a new account receives exactly the minimum"
    );
    only(&to(MIN - 1), R::PlainRentRecipient);
    let held = |before: u64, amount: u64| to(amount).lamports(Role::Recipient, before);
    assert!(
        held(1, MIN - 1).accepts(),
        "1 lamport and the rest make the minimum"
    );
    only(&held(10, MIN - 11), R::PlainRentRecipient);
    assert!(
        held(5 * MIN, 1).accepts(),
        "an account over the minimum may receive 1 lamport"
    );
    assert!(held(0, MIN).accepts());
    only(&held(0, MIN - 1), R::PlainRentRecipient);
}
