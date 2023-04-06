import {zeroAddress} from "locklift";
import BigNumber from "bignumber.js";
import {EverWalletAccount} from "everscale-standalone-client/nodejs";

async function main() {
  const signer = (await locklift.keystore.getSigner("0"))!;
  // The same EverWallet we deployed in script 0, because they are from one pubkey
  const diceOwnerWallet = await EverWalletAccount.fromPubkey({publicKey: signer.publicKey, workchain: 0});

  // Production ready tip-3 has a bit more constructor arguments than our
  // toy example, because it is support more features, like burn tokens.

  // Also, we will use Upgradable version of tip3 token.
  // It makes sense to use upgradable version of token even if you don't want
  // to upgrade token contract in the future. You can just send ownership
  // of the root to the black hole if you do not want to upgrade the token or
  // have ability to mint additional tokens.

  // Contract of the token wallet
  const TokenWalletUpgradable = locklift.factory.getContractArtifacts("TokenWalletUpgradeable");
  // Contract of the token root
  const TokenRootUpgradeable = locklift.factory.getContractArtifacts("TokenRootUpgradeable");

  // Special platform contract. It is necessary for upgradable contracts in distributed programming.
  // We always deploy this small contract and then upgrade it to the real one.
  // We describe this pattern in "How to upgrade contracts" article of this chapter.
  const TokenWalletPlatform = locklift.factory.getContractArtifacts("TokenWalletPlatform");

  // There are three options for deploying a TokenRoot
  // The first one is a simple deployment with an external message.
  // So we will just set a temporarily pubkey to it, to be sure the contract's
  // constructor is called correctly.
  // ( The message which one called the constructor is
  // signed by owner of static variable - pubkey ).

  // The second one is deploying by an internal message with stateInit,
  // like we deployed in the simple-tip3 example. From the
  // address which one is set as a owner of the TokenRoot.

  // And the third one is using a special "deployer" contract.
  // It is like fabric for contracts to support deployment for wallets
  // which ones are not supported stateInit sending or other contracts
  // like dao. It is easier to deploy a token root by just
  // calling " the deploy method" of some contract rather to build an stateInit.
  // factory - https://github.com/broxus/tip3/blob/master/contracts/additional/TokenFactory.tsol

  // We will use a simple deployment by an external message,
  // to show you how it is can be done with locklift.

  // Root token constructor params:
  // Mint initial supply to zero address
  const initialSupplyTo = zeroAddress;
  // How many tokens mint after deploy to initialSupplyTo
  const initialSupply = '0';
  // Disable future minting of the new tokens
  const disableMint = false;
  // Disable ability of the root owner to burn user's tokens
  const disableBurnByRoot = false;
  // Is users can burn their tokens.
  // Useful in some applications like bridges.
  const pauseBurn = false;
  // How many nano VENOMs use to deploy wallet if initial supplier
  const initialDeployWalletValue = '0';

  // TokenRoot static params:
  // Owner of the root contract (can mint or burn tokens)
  const rootOwner = diceOwnerWallet.address;
  // Name of the token
  const name = "USDice";
  // Symbol
  const symbol = "UD";
  // Decimals - 9
  const decimals = 9;

  // Token Root static variables.
  const initParams = {
    randomNonce_: '0',
    rootOwner_: rootOwner,
    name_: name,
    symbol_: symbol,
    deployer_: zeroAddress,
    decimals_: 9,
    walletCode_: TokenWalletUpgradable.code,
    platformCode_: TokenWalletPlatform.code
  }

  const expectedAddress = await locklift.provider.getExpectedAddress(TokenRootUpgradeable.abi, {
    initParams: initParams,
    publicKey: signer.publicKey,
    tvc: TokenRootUpgradeable.tvc
  });

  // Check is contract already deployed
  const account_state = (await locklift.provider.getFullContractState({
    address: expectedAddress
  })).state;

  if (account_state !== undefined && account_state.isDeployed) {
    throw new Error(`TokenRoot is already deployed at ${expectedAddress.toString()}`);
  }

  const { contract: tokenRoot } = await locklift.factory.deployContract({
    contract: "TokenRootUpgradeable",
    publicKey: signer.publicKey,
    //Static variables
    initParams: initParams,
    constructorParams: {
      initialSupplyTo: initialSupplyTo,
      initialSupply: new BigNumber(initialSupply).shiftedBy(decimals).toFixed(),
      deployWalletValue: initialDeployWalletValue,
      mintDisabled: disableMint,
      burnByRootDisabled: disableBurnByRoot,
      burnPaused: pauseBurn,
      remainingGasTo: diceOwnerWallet.address,
    },
    // How many tokens send from the giver to the contract
    // before deploy it by an external message
    value: locklift.utils.toNano(2),
  });

  console.log(`Token root deployed at: ${tokenRoot.address.toString()}`);
}

main()
  .then(() => process.exit(0))
  .catch(e => {
    console.log(e);
    process.exit(1);
  });
