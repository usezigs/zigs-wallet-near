//! The cluster of a build (SOL-42). `build.sh test` builds the program for Devnet and for mainnet.
//! The pool id is the same on both. The genesis hash is the only constant that differs: the
//! mainnet program accepts only approvals over the mainnet genesis hash, and it calls only the
//! pool.

use std::{fs, path::PathBuf};

use solana_pubkey::Pubkey;
use zigs_min_multisig_svm_tests::{
    approval_ix, code, digest_with, execute_ix, program_dir, refused_with, sample_transact,
    serialize, Rig, DEVNET_GENESIS, DOMAIN, MAINNET_ELF, MAINNET_GENESIS, POOL_ID, PROGRAM_ID,
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

/// An approval over each genesis hash, with each pool account at the pool's place.
#[test]
fn the_mainnet_program_takes_mainnet_approvals_and_calls_the_pool() {
    let cases = [
        (MAINNET_GENESIS, POOL_ID, None),
        (DEVNET_GENESIS, POOL_ID, Some(code::BAD_APPROVAL)),
        (
            MAINNET_GENESIS,
            NOT_THE_POOL,
            Some(code::INVALID_SPP_PROGRAM),
        ),
    ];
    let transact = sample_transact();
    for (genesis, pool, refusal) in cases {
        let mut rig = Rig::mainnet();
        let body = rig.body(&transact);
        rig.create(&body).expect("create");
        let mut metas = rig.metas(&body, &transact);
        metas[POOL_AT].pubkey = pool;
        let digest = digest_with(
            DOMAIN,
            &genesis,
            &PROGRAM_ID,
            &body.proposal(),
            &body.bytes(),
        );
        let approval = approval_ix(&rig.group, &digest);
        let result = rig.send(&[approval, execute_ix(metas, &serialize(&transact))], &[]);
        match refusal {
            Some(code) => assert_eq!(refused_with(result), code),
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
