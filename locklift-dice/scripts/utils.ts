import {Address, Contract, Signer} from "locklift";
import BigNumber from "bignumber.js";

export async function checkIsContractDeployed(address: Address, contract_name: string) {
    const account_state = (await locklift.provider.getFullContractState({
        address: address
    })).state;

    if (account_state === undefined || !account_state.isDeployed) {
        throw new Error(`Specified ${contract_name} is not deployed. Please set address to the actual`);
    }
}

export async function checkAccountBalanceIsAbove(address: Address, amount: BigNumber) {
    const account_state = (await locklift.provider.getFullContractState({
        address: address
    })).state;
    if (account_state === undefined) {
        throw new Error('Account is not exist');
    }
    if (new BigNumber(account_state.balance).lt(amount)) {
        throw new Error(`Account ${address.toString()} balance is less than ${amount.toFixed(0)}.`);
    }
}

export const isValidEverAddress = (address: string) => /^(?:-1|0):[0-9a-fA-F]{64}$/.test(address);
