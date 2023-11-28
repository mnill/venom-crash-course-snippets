import {Address} from "locklift";
import {checkAccountBalanceIsAbove, checkIsContractDeployed} from "./utils";
import {EverWalletAccount} from "everscale-standalone-client/nodejs";
import BigNumber from "bignumber.js";

async function main() {
    const signer = (await locklift.keystore.getSigner("0"))!;
    // The same EverWallet we deployed in script 0, because they are from one pubkey
    const diceOwnerWallet = await EverWalletAccount.fromPubkey({publicKey: signer.publicKey, workchain: 0});

    console.log(diceOwnerWallet.address)
    await checkAccountBalanceIsAbove(diceOwnerWallet.address, new BigNumber(locklift.utils.toNano(4)));

    // Put there address of the token root the previous script.
    const tokenRootAddress = '0:cb5f57378e82174ed95502b01df16235d8d94e974ce24a4dc8a10143f23c0c44';
    await checkIsContractDeployed(new Address(tokenRootAddress), 'TokenRoot')

    // We will deploy TokenDice.tsol by the internal message from our EverWallet
    const TokenDice = locklift.factory.getContractArtifacts("TokenDice");

    // Calculate the state init for tvc and initial params.
    // StateInit - code + static variables, to deploy the contract
    // Also this function return address of the future contract
    // Because address it is a hash(stateInit)
    const {address: diceContractAddress, stateInit: tokenDiceStateInit} = await locklift.provider.getStateInit(TokenDice.abi, {
        workchain: 0,
        tvc: TokenDice.tvc,
        initParams: {
            tokenRoot_: new Address(tokenRootAddress),
            owner_: diceOwnerWallet.address
        }
    })


    // We need to add our EverWallet as account to provider
    // to use .send({from: 'address'})
    await locklift.factory.accounts.storage.addAccount(diceOwnerWallet);

    // Contract instance
    const tokenDice = new locklift.provider.Contract(TokenDice.abi, diceContractAddress);

    console.log('Try deploy at', tokenDice.address.toString());

    // Tracing - it is method like we used in previous samples,
    // but it is more complicated and can be used only with graphql
    // endpoint. Please read locklift documentation to study
    // about tracing feature.
    const tracing = await locklift.tracing.trace(
        tokenDice.methods.constructor({}).send({
            from: diceOwnerWallet.address,
            amount: locklift.utils.toNano(3),
            stateInit: tokenDiceStateInit
        })
    )

    await checkIsContractDeployed(diceContractAddress, 'TokenDice');
    console.log(`Token dice deployed at: ${diceContractAddress.toString()}`);
}

main()
    .then(() => process.exit(0))
    .catch(e => {
        console.log(e);
        process.exit(1);
    });
