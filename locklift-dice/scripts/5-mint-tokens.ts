import {Address} from "locklift";
import {checkIsContractDeployed} from "./utils";
import {EverWalletAccount} from "everscale-standalone-client/nodejs";

async function main() {
  const signer = (await locklift.keystore.getSigner("0"))!;
  // The same EverWallet we deployed in script 0, because they are from one pubkey
  const diceOwnerWallet = await EverWalletAccount.fromPubkey({publicKey: signer.publicKey, workchain: 0});
  // We need to add our EverWallet as account to provider
  // to use .send({from: 'address'})
  await locklift.factory.accounts.storage.addAccount(diceOwnerWallet);

  const mintTo = new Address("0:5b63d61ce6267f4afd35f54b3ef50b250ff31eee8070ae925d66f22bbfaabe7a");

  // Put there address of the token root the previous script.
  const tokenRootAddress = '0:e56ffdc692d7fa68534bab03e62e13fc2fb7b2be8aff1da94fdbf580290eb952';

  await checkIsContractDeployed(new Address(tokenRootAddress), 'TokenRootUpgradeable')
  const TokenRoot = locklift.factory.getDeployedContract('TokenRootUpgradeable', new Address(tokenRootAddress));

  // Call the method from our wallet
  const tracing = await locklift.tracing.trace(TokenRoot.methods.mint({
    amount: 1_000_000_000, //10 tokens * 9 decimals
    recipient: mintTo,
    deployWalletValue: locklift.utils.toNano(0.1), // 0.1 VENOMs
    remainingGasTo: diceOwnerWallet.address,
    notify: false,
    payload: "",
  }).send({
    from: diceOwnerWallet.address,
    amount: locklift.utils.toNano(1)
  }));


  const tokenWalletAddress = (await TokenRoot.methods.walletOf({answerId: 0, walletOwner: mintTo}).call()).value0;
  const TokenWallet = locklift.factory.getDeployedContract('TokenWalletUpgradeable', tokenWalletAddress);

  const {value0: tokenWalletBalance} = await TokenWallet.methods.balance({ answerId: 0 }).call();
  const { value0: totalSupply } = await TokenRoot.methods.totalSupply({ answerId: 0 }).call();

  console.log(`Tokens minted to ${mintTo.toString()}, wallet balance is ${tokenWalletBalance}, total supply is ${totalSupply}`);
}

main()
  .then(() => process.exit(0))
  .catch(e => {
    console.log(e);
    process.exit(1);
  });
