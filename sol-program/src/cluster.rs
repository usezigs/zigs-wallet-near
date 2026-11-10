//! The cluster of this build (SOL-42). The genesis hash binds every approval to the cluster. The
//! shielded pool is the target of the `transact` CPI, and it has one id on every cluster. A build
//! names exactly one cluster: `--features devnet` or `--features mainnet`, and a mainnet build
//! fails when its genesis hash is the Devnet one.

use pinocchio::Address;

#[cfg(not(any(feature = "devnet", feature = "mainnet")))]
compile_error!("choose the cluster: --features devnet or --features mainnet (SOL-42)");
#[cfg(all(feature = "devnet", feature = "mainnet"))]
compile_error!("choose one cluster, not both (SOL-42)");

const DEVNET_GENESIS: Address =
    Address::from_str_const("EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG");

/// The shielded pool v1.0.0 of `spr-interface` at the pinned commit, the same on Devnet and
/// mainnet.
pub const POOL_ID: Address = Address::from_str_const("ring1GaLCuJnkUMVkX2JeZLTTX17wKsV4fZmPVzXANW");

#[cfg(feature = "devnet")]
pub const GENESIS: Address = DEVNET_GENESIS;

#[cfg(feature = "mainnet")]
pub const GENESIS: Address =
    Address::from_str_const("5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d");

#[cfg(feature = "mainnet")]
const _: () = {
    assert!(
        !same(&GENESIS, &DEVNET_GENESIS),
        "a mainnet build carries the Devnet genesis hash"
    );
};

#[cfg(feature = "mainnet")]
const fn same(a: &Address, b: &Address) -> bool {
    let (a, b) = (a.to_bytes(), b.to_bytes());
    let mut at = 0;
    while at < a.len() {
        if a[at] != b[at] {
            return false;
        }
        at += 1;
    }
    true
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_pool_is_the_pool_of_the_pinned_interface() {
        assert_eq!(POOL_ID, spr_interface::PROGRAM_ID_PUBKEY);
    }
}
