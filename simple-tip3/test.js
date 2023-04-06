const BigNumber = require('bignumber.js');

const { Address, ProviderRpcClient } = require('everscale-inpage-provider');
const { EverscaleStandaloneClient, EverWalletAccount, SimpleAccountsStorage } = require('everscale-standalone-client/nodejs');
const { SimpleKeystore } = require("everscale-standalone-client/client/keystore");
const { getGiverKeypair, getTokensFromGiver } = require("./giver");

const { TokenRootContract } = require("./artifacts/TokenRootContract.js")
const { TokenWalletContract } = require("./artifacts/TokenWalletContract.js")
const { TokenDiceContract } = require("./artifacts/TokenDiceContract.js")


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

  // giver key pairs
  keyStore.addKeyPair(getGiverKeypair());

  // generate keys for test wallets
  const rootOwnerKeys = SimpleKeystore.generateKeyPair();
  const user1Keys = SimpleKeystore.generateKeyPair();
  const user2Keys = SimpleKeystore.generateKeyPair();

  // add keys to the keystore
  keyStore.addKeyPair(rootOwnerKeys);
  keyStore.addKeyPair(user1Keys);
  keyStore.addKeyPair(user2Keys);

  // derive wallet contract from the pubkey
  const rootOwnerWallet = await EverWalletAccount.fromPubkey({publicKey: rootOwnerKeys.publicKey, workchain: 0});
  const user1Wallet = await EverWalletAccount.fromPubkey({publicKey: user1Keys.publicKey, workchain: 0});
  const user2Wallet = await EverWalletAccount.fromPubkey({publicKey: user2Keys.publicKey, workchain: 0});

  // send 10 VENOMs to the wallets
  await getTokensFromGiver(provider, rootOwnerWallet.address, venomToNanoVenom(10));
  await getTokensFromGiver(provider, user1Wallet.address, venomToNanoVenom(10));
  await getTokensFromGiver(provider, user2Wallet.address, venomToNanoVenom(10));

  // add wallets to the accountStorage to use .send({from: address})
  accountStorage.addAccount(rootOwnerWallet);
  accountStorage.addAccount(user1Wallet);
  accountStorage.addAccount(user2Wallet);


  // Calculate state init for token root
  const {
    address: tokenRootAddress,
    stateInit: tokenRootStateInit
  } = await provider.getStateInit(TokenRootContract.abi, {
    tvc: TokenRootContract.tvc,
    workchain: 0,
    initParams: {
      name_: 'Test token',
      symbol_: 'TST',
      decimals_: 9,
      rootOwner_: rootOwnerWallet.address,
      walletCode_: TokenWalletContract.code,
    }
  });

  // Create tokenRoot contract by abi & address
  const tokenRoot = new provider.Contract(TokenRootContract.abi, tokenRootAddress);

  // Deploy token root by internal message from the rootOwnerWallet address
  const deployTokenRootTX = await extractError(tokenRoot.methods
    .constructor({
      remainingGasTo: rootOwnerWallet.address
    })
    .send({
      from: rootOwnerWallet.address,
      amount: venomToNanoVenom(2),
      stateInit: tokenRootStateInit
    }));

  // Wait until all tx in the transactions tree are finished
  // Throw error if any of tx in the tree aborted.
  await waitUntilTransactionTreeFinished(deployTokenRootTX, true, []);


  // There we will deploy tokenWallets for our users

  // We call deployWallet method of tokenRoot from
  // our wallet by internal. This method marked as responsible.
  // Responsible - means that the called method will return some answer.
  // In this case deployWallet will return to the caller address of
  // deployed tokenWallet contract. answerId - a hidden argument which
  // one automatically added to the method signature. AnswerId - the
  // id of the function target contract must call in the sender in
  // callback. This is useful when some smart contract deploy wallet
  // for himself and waiting for the address of the deployed tokenWallet.

  // Because we call this method just from the wallet we will not use
  // callback functionality, but we must specify the answerId. So
  // we just set it to zero.

  const deployTokenWalletForUser1TX = await extractError(tokenRoot.methods
    .deployWallet({
      answerId: 0,
      walletOwner: user1Wallet.address,
      deployWalletValue: venomToNanoVenom(0.1)
    })
    .send({
      from: user1Wallet.address,
      amount: venomToNanoVenom(1), // 1 ever
    }));
  await waitUntilTransactionTreeFinished(deployTokenWalletForUser1TX, true, []);

  const deployTokenWalletForUser2TX = await extractError(tokenRoot.methods
    .deployWallet({
      answerId: 0,
      walletOwner: user2Wallet.address,
      deployWalletValue: venomToNanoVenom(0.1)
    })
    .send({
      from: user2Wallet.address,
      amount: '1000000000', // 1 VENOM
    }));
  await waitUntilTransactionTreeFinished(deployTokenWalletForUser2TX, true, []);

  // We call tokenRoot method walletOf() locally,
  // to get expected address of user1 tokenWallet contract.
  // This function also market as responsible, so it is designed to be used
  // by internal message, so we use call({responsible: true}) to guide sdk
  // that it must use hack to run responsible method locally.
  const {value0: user1TokenWalletAddress} = await tokenRoot.methods.walletOf(
    {
      answerId: 0,
      walletOwner: user1Wallet.address
    }).call({responsible: true});

  // Same for the user2
  const {value0: user2TokenWalletAddress} = await tokenRoot.methods.walletOf(
    {
      answerId: 0,
      walletOwner: user1Wallet.address
    }).call({responsible: true});

  const user1TokenWallet = new provider.Contract(TokenWalletContract.abi, user1TokenWalletAddress);
  const user2TokenWallet = new provider.Contract(TokenWalletContract.abi, user2TokenWalletAddress);

  // Mint some tokens to the user1.
  // Pay attention,
  // we use recipient: user1Wallet.address
  // not    recipient: user1TokenWallet.address
  // Because we send tokens to the owner address,
  // tokenWallet address will be calculated under the hood.
  const mintTokensToUser1Tx = await extractError(tokenRoot.methods.mint({
    amount: 100_000_000_000, // 100 * 10 ^ 9 = 100 tokens
    recipient: user1Wallet.address,
    deployWalletValue: venomToNanoVenom(0.1),
    remainingGasTo: rootOwnerWallet.address,
    notify: false,
    payload: ''
  }).send({
    from: rootOwnerWallet.address,
    amount: venomToNanoVenom(1),
  }))

  // We ignore failed transaction with error code 51
  // Because 51 - constructor already called, it is happened because
  // before mint we tried to deploy already deployed contract
  await waitUntilTransactionTreeFinished(mintTokensToUser1Tx, true, [51]);

  {
    const {value0: totalSupply} = await tokenRoot.methods.totalSupply({answerId: 0}).call({responsible: true});
    assert(totalSupply === '100000000000', 'total supply must be 100 tokens');
    const {value0: walletBalance} = await user1TokenWallet.methods.balance({answerId: 0}).call({responsible: true});
    assert(walletBalance === '100000000000', 'wallet1 balance must be 100 tokens');
  }

  // Let's transfer some tokens
  const transfer1tx = await extractError(user1TokenWallet.methods.transfer({
    amount: 50_000_000_000, // 50 * 10 ^ 9
    recipient: user2Wallet.address,
    deployWalletValue: venomToNanoVenom(0.1),
    remainingGasTo: user1Wallet.address,
    notify: false,
    payload: ''
  }).send({
    from: user1Wallet.address,
    amount: venomToNanoVenom(1)
  }))
  await waitUntilTransactionTreeFinished(transfer1tx, true, [51]);

  {
    const {value0: totalSupply} = await tokenRoot.methods.totalSupply({answerId: 0}).call({responsible: true});
    assert(totalSupply === '100000000000', 'total supply must be 100 tokens');
    const {value0: wallet1Balance} = await user1TokenWallet.methods.balance({answerId: 0}).call({responsible: true});
    assert(wallet1Balance === '50000000000', 'wallet1 balance must be 50 tokens');
    const {value0: wallet2Balance} = await user2TokenWallet.methods.balance({answerId: 0}).call({responsible: true});
    assert(wallet2Balance === '50000000000', 'wallet2 balance must be 50 tokens');
  }

  // Okay now try to send transfer from wrong owner address
  let wrongTransferTx = await extractError(user1TokenWallet.methods.transfer({
    amount: 50_000_000_000, // 50 * 10 ^ 9
    recipient: user2Wallet.address,
    deployWalletValue: venomToNanoVenom(0.1),
    remainingGasTo: user2Wallet.address,
    notify: false,
    payload: ''
  }).send({
    from: user2Wallet.address, // Wrong owner! must be user1Wallet
    amount: venomToNanoVenom(1)
  }))

  {
    let transferTransactionFailed = false;
    try {
      await waitUntilTransactionTreeFinished(wrongTransferTx, true, [51]);
    } catch (e) {
      assert(e.message === 'Transaction aborted with code 1000', 'Expect transaction will aborted with eror code "Wrong owner"');
      transferTransactionFailed = true;
    }
    assert(transferTransactionFailed, 'Transfer transaction must fail because we send it from wrong owner');
  }

  // Now try to play with our token dice contract.
  // Deploy the contract first.
  const {
    address: tokenDiceAddress,
    stateInit: tokenDiceStateInit
  } = await provider.getStateInit(TokenDiceContract.abi, {
    tvc: TokenDiceContract.tvc,
    workchain: 0,
    initParams: {
      tokenRoot_: tokenRoot.address,
      owner_: rootOwnerWallet.address
    }
  });

  const tokenDice = new provider.Contract(TokenDiceContract.abi, tokenDiceAddress);
  const tokenDiceDeployTx = await extractError(
    tokenDice.methods.constructor({}).send({
      from: rootOwnerWallet.address,
      amount: venomToNanoVenom(2),
      stateInit: tokenDiceStateInit
    })
  )
  await waitUntilTransactionTreeFinished(tokenDiceDeployTx, true, []);

  // Mint some tokens to the tokenDice contract
  const mintToTokenDiceTx = await extractError(tokenRoot.methods.mint({
    amount: 10_000_000_000, // 10 * 10 ^ 9 = 10 tokens
    recipient: tokenDice.address,
    deployWalletValue: '0', // We will no deploy wallet, it is already deployed
    remainingGasTo: rootOwnerWallet.address,
    // We should notify token dice, because it must update local balance value.
    notify: true,
    payload: ''
  }).send({
    from: rootOwnerWallet.address,
    amount: venomToNanoVenom(1),
  }))
  await waitUntilTransactionTreeFinished(mintToTokenDiceTx, true, []);

  // Encode TvmCell payload which one we will send with tokens transfer
  // to play.
  const encodedDiceBetValue = (await provider.packIntoCell({
    data: {
      _bet_dice_value: "5",
    },
    structure: [
      {name: '_bet_dice_value', type: 'uint8'},
    ],
  })).boc;

  // try to play
  for (let i = 0; i < 100; i++) {
    let maxBet = new BigNumber((await tokenDice.methods.maxBet( {}).call({})).value0);
    let ourBalance = new BigNumber((await user1TokenWallet.methods.balance({answerId: 0}).call({responsible: true})).value0);

    const oneToken = new BigNumber(1).shiftedBy(9);

    if (maxBet.lt(oneToken)) {
      console.log('Dice contract has not enough balance to play');
      break;
    }
    if (ourBalance.lt(oneToken)) {
      console.log('We have not enough tokens to play');
      break;
    }

    console.log('\nTry to roll a dice...', i);

    let playTransferTx = await extractError(user1TokenWallet.methods.transfer({
      amount: 1_000_000_000, // 1 * 10 ^ 9
      recipient: tokenDice.address,
      deployWalletValue: 0,
      remainingGasTo: user1Wallet.address,
      notify: true,
      payload: encodedDiceBetValue
    }).send({
      from: user1Wallet.address,
      amount: venomToNanoVenom(1)
    }));

    // Looking for roll transaction
    const subscriber = new provider.Subscriber();
    let playTx = await subscriber.trace(playTransferTx).filter(tx_in_tree => {
      return tx_in_tree.account._address === tokenDice.address.toString();
    }).first();

    if (!playTx) {
      throw new Error('Play transaction is not found!');
    } else {
      // Wait before all next transactions is finished
      await subscriber.trace(playTx).finished();
    }


    let decoded_events = await tokenDice.decodeTransactionEvents({
      transaction: playTx,
    });

    if (decoded_events[0].data.bet === decoded_events[0].data.result) {
      console.log('We won', (new BigNumber(decoded_events[0].data.prize).shiftedBy(-9)).toFixed(2), 'tokens');
      let ourNewBalance = new BigNumber((await user1TokenWallet.methods.balance({answerId: 0}).call({responsible: true})).value0);
      assert(ourNewBalance.eq(ourBalance.plus(new BigNumber(decoded_events[0].data.prize).minus(1_000_000_000))));
      break;
    } else {
      console.log('We lose\n');
    }

    await sleep(1);
  }
  console.log('Tests successful');
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

async function waitUntilTransactionTreeFinished(first_tx, throw_error_on_any_aborted, ignoreErrorCodes) {
  const subscriber = new provider.Subscriber();
  // This stream will search for the first tx with an error
  // or return null if all transactions parsed.
  let tx_with_error = await subscriber.trace(first_tx).filter(tx_in_tree => {
    return tx_in_tree.aborted === true && (!ignoreErrorCodes || !ignoreErrorCodes.includes(tx_in_tree.exitCode));
  }).first();
  if (tx_with_error)
    throw new Error(`Transaction aborted with code ${tx_with_error.exitCode}`);
}

async function extractError(transactionPromise) {
  return transactionPromise.then(res => {
    if (res.transaction?.aborted || res.aborted) {
      throw new Error(`Transaction ${res.transaction?.id.hash || res.id.hash} aborted with code ${res.transaction?.exitCode || res.exitCode}`);
    }
    return res;
  });
}

function venomToNanoVenom(amount) {
  return new BigNumber(amount).shiftedBy(9).toFixed(0);
}

function sleep(seconds) {
  return new Promise(resolve => setTimeout(resolve, seconds * 1000));
}

function assert(condition, error) {
  if (!condition) {
    throw new Error(error);
  }
}

