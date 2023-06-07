const { Account } = require("@eversdk/appkit");
const { TonClient, signerKeys, signerNone } = require("@eversdk/core");
const { libNode } = require("@eversdk/lib-node");

TonClient.useBinaryLibrary(libNode);

const { SimpleStorageContract } = require("./artifacts/SimpleStorageContract")

// We create a client connection to the local node
const client = new TonClient({
  network: {
    // Local EVER OS SE instance URL here
    endpoints: [ "http://localhost" ]
  }
});


async function main(client) {
  try {
    // generate random keys pair
    const keys = await TonClient.default.crypto.generate_random_sign_keys();

    // Create an instance of contract.
    // To create an instance we need to specify
    // * signer - keypair to sign an external messages we will send to this contract. keys.public is the same key is tvm.pubkey()
    // * client - a client to a blockchain
    // * initData - it is initial values for all STATIC variables.

    let simpleStorageInstance= new Account(SimpleStorageContract, {
      signer: signerKeys(keys),
      client,
      initData: {
        random_number: Math.floor(Math.random() * 100)
      },
    });

    // Contract address is always a hash(hash(contract_code) + hash(initial value of all static variables)).
    // So now when we have known contract code and all initial data we can calculate future address of the contract.
    const simpleStorageInstanceAddress = await simpleStorageInstance.getAddress();

    // Note: that is tvm.pubkey() is also a static variable. Just a hidden one.
    // So our contract address depend on CODE + random_number + keys.pubkey

    // Deploy our contract.
    // We use param useGiver: true - this is mean sdk will use pre-deployed wallet with VENOMs on the local network to
    // send a necessary amount of VENOMs to the contract to deploy it.
    // initInput - it is variables that will be passed to the constructor.

    // Note: the contract address is not dependent on the variables we will send to the constructor.
    await simpleStorageInstance.deploy({
      useGiver: true,
      initInput: {
        _initial_value: '0x1'
      }})
    console.log(`Simple storage deployed at : ${simpleStorageInstanceAddress}`);


    // Note: you can also create an instance of the contract not only by specifying a pubkey and static variables and just
    // by the address. Like this:
    // simpleStorageInstance = new Account(SimpleStorageContract, {
    //   signer: signerNone(),
    //   client,
    //   address: simpleStorageInstanceAddress
    // });

    // runLocal - a way to call a view methods of the contracts.
    // sdk will download current account state + code and execute tvm locally to get the answer.

    let response = await simpleStorageInstance.runLocal("variable", {});
    console.log('After deploy variable param is', response.decoded.output.variable);

    // run - send an external message to the contract. Specified signer will be used to sign the message.
    console.log('Set variable to 0xFF');
    await simpleStorageInstance.run("set", {
      _value: 0xFF
    });

    console.log('Success');

    response = await simpleStorageInstance.runLocal("variable", {});
    console.log('Now variable param is', response.decoded.output.variable);

    console.log("Test successful");
  } catch (e) {
    console.error(e);
  }
}

(async () => {
  try {
    console.log("Hello localhost BC!");
    await main(client);
    process.exit(0);
  } catch (error) {
    if (error.code === 504) {
      console.error(`Network is inaccessible. You have to start EVER OS SE using \`everdev se start\`.\n If you run SE on another port or ip, replace http://localhost endpoint with http://localhost:port or http://ip:port in index.js file.`);
    } else {
      console.error(error);
    }
  }
  client.close();
})();
