import {EverWalletAccount} from "everscale-standalone-client/nodejs";

async function main() : Promise<any> {
  // Get keypair from the seed phrase
  const signer = (await locklift.keystore.getSigner("0"))!;

  // Get the contract by the pubkey.
  const diceOwnerWallet = await EverWalletAccount.fromPubkey({publicKey: signer.publicKey, workchain: 0});

  // Fulfil wallet's balance from the giver.
  await locklift.giver.sendTo(diceOwnerWallet.address, locklift.utils.toNano(10));
  console.log('EverWallet deployed at', diceOwnerWallet.address.toString());
}

main()
  .then(() => process.exit(0))
  .catch(e => {
    console.log(e);
    process.exit(1);
  });
