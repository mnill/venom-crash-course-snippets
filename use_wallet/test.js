const { Address, ProviderRpcClient } = require('everscale-inpage-provider');
const { EverscaleStandaloneClient, EverWalletAccount, SimpleAccountsStorage } = require('everscale-standalone-client/nodejs');
const { SimpleKeystore } = require("everscale-standalone-client/client/keystore");
const { getGiverKeypair, getTokensFromGiver } = require("./giver");
const BigNumber = require('bignumber.js');

const { DiceContract } = require('./artifacts/DiceContract');

const keyStore = new SimpleKeystore();
const accountStorage = new SimpleAccountsStorage();

const provider = new ProviderRpcClient({
  fallback: () =>
    EverscaleStandaloneClient.create({
      connection: {
        id: 1, // connection id
        type: 'graphql',
        group: "localnet",
        data: {
          endpoints: ['127.0.0.1'],
          latencyDetectionInterval: 1000,
          local: true,
        },
      },
      keystore: keyStore,
      accountsStorage: accountStorage
    }),
});

async function main() {

  keyStore.addKeyPair(getGiverKeypair());

  // Generate a random keypair to set as owner of
  // our SimpleStorage contract. In production, you
  // of course need to import this keypair.

  // Player keypair
  const playerKeys = SimpleKeystore.generateKeyPair();
  keyStore.addKeyPair(playerKeys);

  // Casino owner keypair
  const diceOwnerKeys = SimpleKeystore.generateKeyPair();
  keyStore.addKeyPair(diceOwnerKeys);

  // in-page-provider initially was designed as web3-like
  // interface that one injected into web page from browser
  // extension. So they have accounts(wallets) as first class
  // citizen. In case we're using everscale-standalone-client
  // we can manage accounts and keys on our side.

  // So in this example in additional for keyStore
  // we are added simple accountStorage. So we can add
  // 'wallet' smart contract as account and use
  // them to start any transaction.

  // VenomWallet/EverWallet support several types of wallet,
  // most popular - EverWallet contract and Multisig2.
  // We will use ever wallet. It is very simple
  // smart contract owned by a pubkey.

  // It can be easily defined from pubkey.
  // Address of the EverWallet smart-contract depend
  // only on three params:
  // 1. code
  // 2. pubkey
  // 3. nonce (by default undefinied, used to deploy several wallet from one pubkey)

  // So we can define wallet just by pubkey, code is already
  // hardcoded in the everscale-standalone-client.
  const diceOwnerWallet = await EverWalletAccount.fromPubkey({publicKey: diceOwnerKeys.publicKey, workchain: 0});

  // Send some tokens to our wallet
  await getTokensFromGiver(provider, diceOwnerWallet.address, 10_000_000_000);

  // Then just add our account to the account storage.
  accountStorage.addAccount(diceOwnerWallet);

  console.log('dice owner address is', diceOwnerWallet.address.toString());
  // EverWallet contract no has a constructor and doesn't require
  // separate action for deploy.
  // in-page-provider will track is the wallet
  // deployed and if it is not deployed provider will add
  // the wallet's StateInit in the first external message.

  // Now we will deploy DiceContract by internal message from our
  // wallet. At first, we need to calculate dice contract address
  // and stateInit

  const {
    address: diceExpectedAddress,
    stateInit: diceExpectedStateInit
  } = await provider.getStateInit(DiceContract.abi, {
    // Dice code + empty data
    tvc: DiceContract.tvc,
    workchain: 0,
    // we did not set pubkey, because our dice contract
    // is internal owned (by internal messsage)
    initParams: {
      // static params only owner
      owner_: diceOwnerWallet.address
    }
  });

  const diceContract = new provider.Contract(DiceContract.abi, diceExpectedAddress);

  // By using send({ from, amount }) we can send an internal message
  // from the wallet account.
  let tx = await extractError(diceContract.methods
    .constructor({})
    .send({
      from: diceOwnerWallet.address,
      amount: '7000000000', // 7 VENOMs
      stateInit: diceExpectedStateInit
    }));

  // This is just a sugar, what really happened in the
  // lines above (pseudocode):
  // Sdk encoded an internal message payload which one
  // is calling constructor with no arguments
  // This is the same as
  // let payload = await (new diceContract.methods.constructor({}).encodeInternal();
  // Then by specifying - from: diceOwnerWallet.address
  // we tell provider to send this payload
  // from the connected wallet account by internal
  // and attach to this internal amount VENOM's from the
  // wallet account.
  // Also we specified stateInit, and sdk will also add
  // the stateInit to the internal message sended from the wallet account.

  // EverWallet is written on low level language, but on solidity
  // they probably will have function like this (pseudocode):

  //   function submitTransaction(
  //     address dest,
  //     uint128 value,
  //     bool bounce,
  //     uint8 flags,
  //     TvmCell payload,
  //     optional(TvmCell) stateInit
  // ) external {
  //       require(msg.pubkey() == tvm.pubkey(), 100);
  //       dest.transfer({
  //         value: value,
  //         bounce: bounce,
  //         flag: flags,
  //         body: payload,
  //         stateInit: stateInit
  //     });
  //   }

  // So the all sugar in send: from - is just encoding target
  // contract method call into internal message call and send
  // from the connected wallet. Easy.

  // One more important thing there, .send({from: address})
  // return the first transaction in the transaction chain.

  // So you have not any information is the internal message
  // you sent from the wallet successful or not. Or ever
  // you can not be sure is it delivered already or still
  // on the way. Also, you can have a really long transaction chain.

  // So to wait all transaction in the transaction tree you
  // need to subscribe to the transaction tree and wait until
  // all messages will be delivered.

  let constructorCallSuccess = false;
  const subscriber = new provider.Subscriber();
  await subscriber.trace(tx).tap(tx_in_tree => {
    if (tx_in_tree.account.equals(diceContract.address) && tx_in_tree.aborted === false)
      constructorCallSuccess = true;
  }).finished();

  if (!constructorCallSuccess) {
    throw new Error(`Successful constructor transaction on ${diceContract.address.toString()} not found`);
  }

  console.log('dice contract deployed at', diceContract.address.toString());

  // Okay, now we have dice contract deployed from diceOwnerWallet
  // Let's deploy our player Wallet and try to play
  const playerWallet = await EverWalletAccount.fromPubkey({publicKey: playerKeys.publicKey, workchain: 0});
  await getTokensFromGiver(provider, playerWallet.address, 30_000_000_000);
  accountStorage.addAccount(playerWallet);

  console.log('player wallet address is', playerWallet.address.toString(), '\n');
  // Let's play!
  for (let i = 0; i < 20; i++) {
    console.log('Try to play!');

    let maxBet = (await diceContract.methods.maxBet({}).call()).value0;
    if (new BigNumber(maxBet).lt(1_000_000_000)) {
      throw new Error('Max bet is less then 1 VENOM');
    }

    // Call roll method of the diceContract by internal message from
    // our player's wallet
    let tx = await diceContract.methods.roll({_bet_dice_value: 5})
      .send({
        from: playerWallet.address,
        amount: '1000000000' // 1 VENOM
      });

    // Looking for roll transaction
    const subscriber = new provider.Subscriber();
    let play_tx = await subscriber.trace(tx).filter(tx_in_tree => {
      return tx_in_tree.account._address === diceContract.address.toString();
    }).first();

    if (!play_tx) {
      throw new Error('Play transaction is not found!');
    }

    // Looking for the event Game(address player, uint8 bet, uint8 result,  uint128 prize);
    let decoded_events = await diceContract.decodeTransactionEvents({
      transaction: play_tx,
    });

    if (decoded_events[0].data.bet === decoded_events[0].data.result) {
      console.log('We won', new BigNumber(decoded_events[0].data.prize).shiftedBy(-9).toFixed(1), 'VENOMs\n');
      break;
    } else {
      console.log('We lose\n');
    }
    await sleep(1);
  }

  console.log("Test successful");
}

(async () => {
  try {
    console.log("Hello localhost VENOM!");
    await main();
    process.exit(0);
  } catch (error) {
    console.error(error);
  }
})();

async function extractError(transactionPromise) {
  return transactionPromise.then(res => {
    if (res.transaction?.aborted || res.aborted) {
      throw new Error(`Transaction aborted with code ${res.transaction?.exitCode || res.exitCode}`)
    }
    return res;
  });
}

function sleep(seconds) {
  return new Promise(resolve => setTimeout(resolve, seconds * 1000));
}
