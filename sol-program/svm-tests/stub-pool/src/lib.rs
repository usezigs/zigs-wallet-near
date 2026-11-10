//! A stand-in for the shielded pool at its program id. There it accepts only `transact` (tag 16)
//! and returns one signer flag per account as its return data, so the tests see which accounts
//! the program signed for. At any other address it accepts every instruction: it stands for a
//! program that an attacker deploys.

use pinocchio::{cpi::set_return_data, error::ProgramError, AccountView, Address, ProgramResult};

pinocchio::entrypoint!(process_instruction);

/// ring1GaLCuJnkUMVkX2JeZLTTX17wKsV4fZmPVzXANW
const POOL_ID: Address = Address::new_from_array([
    12, 188, 181, 120, 174, 97, 37, 129, 50, 238, 175, 106, 193, 33, 192, 164, 43, 136, 162, 232,
    79, 177, 30, 126, 45, 91, 160, 175, 209, 39, 49, 99,
]);
const TRANSACT: u8 = 16;
/// The CPI of the program copies at most 24 accounts.
const MAX_ACCOUNTS: usize = 24;

pub fn process_instruction(
    program_id: &Address,
    accounts: &mut [AccountView],
    data: &[u8],
) -> ProgramResult {
    if program_id != &POOL_ID {
        return Ok(());
    }
    if data.first() != Some(&TRANSACT) || accounts.len() > MAX_ACCOUNTS {
        return Err(ProgramError::InvalidInstructionData);
    }
    let mut flags = [0u8; MAX_ACCOUNTS];
    for (flag, account) in flags.iter_mut().zip(accounts.iter()) {
        *flag = u8::from(account.is_signer());
    }
    set_return_data(&flags[..accounts.len()]);
    Ok(())
}
