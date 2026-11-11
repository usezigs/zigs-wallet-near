//! The cluster of a build (SOL-42). `build.sh test` builds the program for Devnet and for mainnet.
//! The pool id is the same on both. The genesis hash is the only constant that differs: the
//! mainnet program accepts only approvals over the mainnet genesis hash, and it calls only the
//! pool.

use std::{fs, path::PathBuf};

use sha2::{Digest, Sha256};
use solana_pubkey::Pubkey;
use zigs_min_multisig_svm_tests::{
    approval_ix, cancellation_under, code, digest_with, execute_ix, owner_address, owner_under,
    program_dir, refused_with, sample_transact, serialize, Rig, DEVNET_GENESIS, DOMAIN,
    MAINNET_ELF, MAINNET_GENESIS, MAINNET_PROGRAM_ID, POOL_ID, PROGRAM_ID,
};

/// The forwarded position of the pool account, in the account list of `execute`.
const POOL_AT: usize = 6 + 2;

/// An address that is not the pool.
const NOT_THE_POOL: Pubkey = Pubkey::new_from_array([0x6d; 32]);

fn holds(elf: &[u8], key: &Pubkey) -> bool {
    elf.windows(32).any(|bytes| bytes == key.as_ref())
}

#[test]
fn each_elf_holds_the_pool_and_the_genesis_hash_of_its_cluster_only() {
    let devnet = fs::read(program_dir().join("target/deploy/zigs_min_multisig.so")).expect("ELF");
    let mainnet = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(MAINNET_ELF);
    let mainnet = fs::read(mainnet).expect("mainnet ELF; run `sh sol-program/build.sh test`");
    for (elf, own, other) in [
        (&devnet, DEVNET_GENESIS, MAINNET_GENESIS),
        (&mainnet, MAINNET_GENESIS, DEVNET_GENESIS),
    ] {
        assert!(holds(elf, &POOL_ID), "the pool of {own}");
        assert!(holds(elf, &own), "own genesis hash {own}");
        assert!(!holds(elf, &other), "other genesis hash {other}");
    }
}

/// An approval over each pair of genesis hash and program id, with each pool account at the
/// pool's place. The mainnet program sits at its own id and takes only the mainnet pair.
#[test]
fn the_mainnet_program_takes_mainnet_approvals_and_calls_the_pool() {
    let cases = [
        (MAINNET_GENESIS, MAINNET_PROGRAM_ID, POOL_ID, None),
        (
            MAINNET_GENESIS,
            PROGRAM_ID,
            POOL_ID,
            Some(code::BAD_APPROVAL),
        ),
        (
            DEVNET_GENESIS,
            MAINNET_PROGRAM_ID,
            POOL_ID,
            Some(code::BAD_APPROVAL),
        ),
        (
            MAINNET_GENESIS,
            MAINNET_PROGRAM_ID,
            NOT_THE_POOL,
            Some(code::INVALID_SPP_PROGRAM),
        ),
    ];
    let transact = sample_transact();
    for (genesis, program, pool, refusal) in cases {
        let mut rig = Rig::mainnet();
        let body = rig.body(&transact);
        rig.create(&body).expect("create");
        let mut metas = rig.metas(&body, &transact);
        metas[POOL_AT].pubkey = pool;
        let digest = digest_with(DOMAIN, &genesis, &program, &body.proposal(), &body.bytes());
        let approval = approval_ix(&rig.group, &digest);
        let result = rig.send(&[approval, execute_ix(metas, &serialize(&transact))], &[]);
        match refusal {
            Some(code) => assert_eq!(refused_with(result), code, "{genesis} {program}"),
            // `Rig::send` allows a call to the rig's pool only: here the stub at the pool id.
            None => {
                let meta = result.expect("a mainnet approval settles");
                let calls: Vec<_> = meta.inner_instructions.iter().flatten().collect();
                assert_eq!(calls.len(), 1);
                assert_eq!(calls[0].instruction.data[0], 16);
            }
        }
    }
}

/// The value of a line of the shared vector file, `"name": "value"` or `"name": number`.
fn field(name: &str) -> String {
    let text = include_str!("../../../wasm-sol/vectors/program/mainnet.json");
    let key = format!("\"{name}\": ");
    let line = text
        .lines()
        .find_map(|line| line.trim().strip_prefix(&key))
        .unwrap_or_else(|| panic!("field {name}"));
    line.trim_end_matches(',').trim_matches('"').to_string()
}

fn bytes(name: &str) -> Vec<u8> {
    let text = field(name);
    (0..text.len())
        .step_by(2)
        .map(|at| u8::from_str_radix(&text[at..at + 2], 16).expect("hex"))
        .collect()
}

fn key(name: &str) -> Pubkey {
    Pubkey::try_from(bytes(name).as_slice()).expect("a 32-byte key")
}

/// The shared vector (`wasm-sol/vectors/program/mainnet.json`, made by a script that does not use
/// these crates) equals what the rig derives and what the mainnet program accepts.
#[test]
fn the_shared_mainnet_vector_matches_the_rig_and_the_program() {
    assert_eq!(key("program"), MAINNET_PROGRAM_ID);
    assert_eq!(key("genesis"), MAINNET_GENESIS);
    assert_eq!(bytes("domain"), DOMAIN);
    let group = key("group");
    let (owner, bump) = owner_under(&MAINNET_PROGRAM_ID, &group);
    assert_eq!(
        (owner, bump.to_string()),
        (key("owner"), field("owner_bump"))
    );
    let body = bytes("body");
    let hash: [u8; 32] = Sha256::digest(&body).into();
    let (proposal, bump) = Pubkey::find_program_address(
        &[b"proposed_transaction", group.as_ref(), &body[..32], &hash],
        &MAINNET_PROGRAM_ID,
    );
    assert_eq!(
        (proposal, bump.to_string()),
        (key("proposal"), field("proposal_bump"))
    );
    let (cancel, bump) = cancellation_under(&MAINNET_PROGRAM_ID, &proposal);
    assert_eq!(
        (cancel, bump.to_string()),
        (key("cancellation"), field("cancellation_bump"))
    );
    let digest = digest_with(
        DOMAIN,
        &MAINNET_GENESIS,
        &MAINNET_PROGRAM_ID,
        &proposal,
        &body,
    );
    assert_eq!(digest.to_vec(), bytes("digest"));
    // The same body under the Devnet program gives other addresses and another digest.
    assert_ne!(owner_under(&PROGRAM_ID, &group).0, owner);
    assert_ne!(owner_address(&group), owner);
}

/// The mainnet program, loaded at `9mE7…`, accepts the owner PDA that is derived under `9mE7…`.
#[test]
fn the_mainnet_program_settles_with_the_owner_address_under_its_own_id() {
    let mut rig = Rig::mainnet();
    let transact = sample_transact();
    let body = rig.body(&transact);
    assert_eq!(
        body.owner(),
        owner_under(&MAINNET_PROGRAM_ID, &body.group).0
    );
    rig.create(&body).expect("create");
    rig.execute(&body, &transact)
        .expect("the owner PDA is the one under 9mE7");
}
