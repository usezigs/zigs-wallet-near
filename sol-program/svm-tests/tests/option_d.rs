//! The rules of ZOLANA.md 7.2 for the nullifier key option D: the program never calls
//! `register`, `update_keys`, `set_merging_enabled`, `merge_transact` or `deposit`, and never
//! reads or stores the nullifier key. The calls are checked on every successful transaction of
//! every test (`Rig::send` runs `check_cpis`); these tests add the full lifecycle in one place
//! and two static checks of the program's source and dependencies.

use std::fs;
use std::path::Path;

use solana_instruction::AccountMeta;
use solana_signer::Signer;
use zigs_min_multisig_svm_tests::{
    cancel_ix, close_cancelled_ix, program_dir, sample_transact, Rig, DAY,
};

const TEST_MODULE: &str = "#[cfg(test)]\nmod tests {\n";

/// The program's Rust code without comments and without unit tests, in lower case.
fn program_code() -> String {
    let mut code = String::new();
    for entry in fs::read_dir(program_dir().join("src")).expect("src") {
        let path = entry.expect("entry").path();
        let text = fs::read_to_string(&path).expect("read");
        for line in without_test_module(&text, &path).lines() {
            let without_comment = line.split("//").next().unwrap_or_default();
            code.push_str(&without_comment.to_lowercase());
            code.push('\n');
        }
    }
    code
}

/// `text` up to its `#[cfg(test)] mod tests` block. The block must end the file: after its first
/// line, each line is empty or indented, and the last line is `}`. So no program code follows it.
fn without_test_module<'a>(text: &'a str, path: &Path) -> &'a str {
    let Some(start) = text.find(TEST_MODULE) else {
        return text;
    };
    let body: Vec<&str> = text[start + TEST_MODULE.len()..].lines().collect();
    let (last, inner) = body.split_last().expect("a test module has a body");
    let indented = |line: &&str| line.is_empty() || line.starts_with(char::is_whitespace);
    assert!(
        *last == "}" && inner.iter().all(indented),
        "{}: code follows the test module",
        path.display()
    );
    &text[..start]
}

#[test]
fn every_instruction_calls_only_the_system_program_and_transact() {
    let mut rig = Rig::new();
    let transact = sample_transact();
    let body = rig.body(&transact);
    rig.create(&body).expect("create");
    let authority = AccountMeta::new_readonly(rig.authority.pubkey(), true);
    let signer = rig.authority.insecure_clone();
    let cancel = cancel_ix(&rig.payer.pubkey(), &body, Some(authority));
    rig.send(&[cancel], &[&signer]).expect("cancel");
    rig.set_time(body.expiry + 1);
    let close = close_cancelled_ix(&rig.payer.pubkey(), &body);
    rig.send(&[close], &[]).expect("close the record");
    let mut later = body.clone();
    later.expiry += 2 * DAY;
    rig.create(&later).expect("create again");
    let meta = rig.execute(&later, &transact).expect("execute");
    let calls: Vec<_> = meta.inner_instructions.iter().flatten().collect();
    assert_eq!(calls.len(), 1, "execute makes one call: transact");
    assert_eq!(calls[0].instruction.data[0], 16);
}

#[test]
fn the_program_depends_on_no_registry_crate() {
    let lock = fs::read_to_string(program_dir().join("Cargo.lock")).expect("Cargo.lock");
    assert!(
        !lock.contains("user-registry"),
        "the program must not link the user registry"
    );
    let manifest = fs::read_to_string(program_dir().join("Cargo.toml")).expect("Cargo.toml");
    assert!(!manifest.contains("user-registry"));
}

#[test]
fn the_program_code_names_no_forbidden_instruction_or_key() {
    let code = program_code();
    for word in [
        "register",
        "update_keys",
        "set_merging",
        "merge",
        "deposit",
        "nullifier",
        "user_record",
        "userrecord",
        "viewing",
    ] {
        assert!(!code.contains(word), "the program code names `{word}`");
    }
}
