const { Address, ProviderRpcClient } = require('everscale-inpage-provider');
const { EverscaleStandaloneClient } = require('everscale-standalone-client/nodejs');
const { SimpleStorageContract } = require("./artifacts/SimpleStorageContract");
const { SimpleKeystore } = require("everscale-standalone-client/client/keystore");
const { getGiverKeypair, getTokensFromGiver } = require("./giver");

const keyStore = new SimpleKeystore();
const provider = new ProviderRpcClient({
  // We setup fallback provider
  // in browser environment provider will try to
  // connect to the VenomWallet/EverWallet first
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
      keystore: keyStore
    }),
});

async function main() {
  // Add giver keypair to provider keystore
  // Giver is a generic name for any smart contract
  // that is used to send VENOM's for deploying
  // smart contracts by an external message.

  // The local node has a pre-deployed giver
  // with a simple interface. Add their keypair
  // to the keyStore, because provider
  // always looking into keystore to find a keypair
  // to sign an external message.
  keyStore.addKeyPair(getGiverKeypair());

  // Generate a random keypair to set as owner of
  // our SimpleStorage contract. In production, you
  // of course need to import this keypair.
  const keyPair = SimpleKeystore.generateKeyPair();
  keyStore.addKeyPair(keyPair);


  // Calculate a stateInit of our contract.

  // StateInit - it is a packed contract Code and InitialData(storage)

  // If you need to deploy a contract you need to attach
  // StateInit to the message (Internal or External)
  // If the target contract is not deployed before the transaction
  // starts validator will check is hash(stateInit) == address
  // of the destination contract.

  // If they match validator will initialize contract by the
  // given code + initialData from the stateInit.

  // We also got expectedAddress, because address is just hash(stateInit)
  const {address: expectedAddress, stateInit} = await provider.getStateInit(SimpleStorageContract.abi, {
    // Tvc it is code + zeroInitial data.
    // function will replace zero data to actual
    // from initParams.
    tvc: SimpleStorageContract.tvc,
    workchain: 0,
    publicKey: keyPair.publicKey,
    initParams: {
      random_number: Math.floor(Math.random() * 10000)
    }
  });

  // So to deploy smart-contract by the external message we need to
  // send some tokens with bounce: false flag to their address first.
  // After it account state will change their status
  // from NotExist to NotInitialized.
  // Local node has pre-deployed giver. For the testnet/mainnet
  // You need to setup giver by yourself.
  // Check "Setup environment for testnet/mainnet" article
  // to figure out how to do this.
  await getTokensFromGiver(provider, expectedAddress, 1_000_000_000); // 1 VENOM = 1_000_000_000 nanoVENOMs

  // Now we can send an external message to our account
  const contract = new provider.Contract(SimpleStorageContract.abi, expectedAddress);

  // We just send an external message to our contract
  // that one will call constructor with arguments _initial_value = 1
  // And also we attach stateInit to our message,
  // because our contract must be initialized first.

  await extractError(contract.methods.constructor({_initial_value: 1}).sendExternal({
    stateInit: stateInit,
    // Provider will search for the signer for this pubkey in the keyStore
    publicKey: keyPair.publicKey,
  }))

  // Call view method 'get'.
  // To do this, sdk will download full account state and run TVM locally
  let {value0: variableValue} = await contract.methods.get({}).call({});
  console.log('Account successfully deployed at address', expectedAddress.toString(), 'variable is set to', variableValue);

  console.log('Set variable to 42')
  await extractError(contract.methods.set({_value: 42}).sendExternal({
    publicKey: keyPair.publicKey,
  }))

  let {value0: newVariableValue} = await contract.methods.get({}).call({});

  if (newVariableValue !== '42') {
    throw new Error('Variable is not 42')
  } else {
    console.log('Success, variable value is', newVariableValue);
  }

  console.log("Test successful");
}

async function extractError(transactionPromise) {
  return transactionPromise.then(res => {
    if (res.transaction.aborted) {
      throw new Error(`Transaction aborted with code ${res.transaction.exitCode}`)
    }
    return res;
  });
}

(async () => {
  try {
    console.log("Hello VENOM!");
    await main();
    process.exit(0);
  } catch (error) {
    console.error(error);
  }
})();
