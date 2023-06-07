const { Account } = require("@eversdk/appkit");
const {
  TonClient,
  signerKeys,
  signerNone,
} = require("@eversdk/core");
const { libNode } = require("@eversdk/lib-node");
const BigNumber = require('bignumber.js');

TonClient.useBinaryLibrary(libNode);

const { DiceContract } = require("./artifacts/DiceContract");
const { SetcodeMultisigContract } = require("./artifacts/SetcodeMultisigContract");

// We create a client connection to the local node
const client = new TonClient({
  network: {
    // Local EVER OS SE instance URL here
    endpoints: [ "http://localhost" ]
  }
});

async function main(client) {
  try {
    // generate random keys pairs
    const players_keys = await TonClient.default.crypto.generate_random_sign_keys();
    const casino_owner_keys = await TonClient.default.crypto.generate_random_sign_keys();

    // create an instance of multisig for the casino owner
    let casinoOwnerMultisig = new Account(SetcodeMultisigContract, {
      signer: signerKeys(casino_owner_keys),
      client,
      initData: {},
    });

    const casinoOwnerMultisigAddress = await casinoOwnerMultisig.getAddress();

    // Deploy msig with 1 owner for casino owner
    await casinoOwnerMultisig.deploy({
      useGiver: true,
      initInput: {
        //constructor values
        owners: [`0x${casino_owner_keys.public}`],
        reqConfirms: 1,
        lifetime: 3600
      }})

    console.log(`Casino owner multisig is deployed : ${casinoOwnerMultisigAddress}`);

    // Our dice conrract instance
    let diceContract = new Account(DiceContract,{
      signer: signerNone(),
      client,
      initData: {
        owner_: casinoOwnerMultisigAddress
      },
    });

    // To deploy the contract from another contract we need to calculate initial data (static variables + pubkey)
    let initData = (await client.abi.encode_initial_data({
      abi: diceContract.abi,
      initial_data: {
        owner_: casinoOwnerMultisigAddress
      },
      initial_pubkey: `0x0000000000000000000000000000000000000000000000000000000000000000` // if zero pubkey must be such string
    })).data

    // We take code + initial data and make StateInit.
    // We will send stateInit along with the message to call the constructor.
    // Validator will check is hash(stateInit) === address and will Initialize our contract
    // (will add code + initial data to account )
    const diceContractStateInit = (await client.boc.encode_tvc({
      code: DiceContract.code,
      data: initData
    })).tvc;

    // Secondly we encode a message witch one will call the constructor in the same transaction
    // Technically contract can be deployed without calling a constructor or any other function and the account will have
    // status - active. Solidity has a special hidden variable "_constructorFlag" and always check it before any call.
    // So your contract can not be called before the constructor will be called successfully.

    // We encode a message with params is_internal: true/signer: signerNone because this is an internal message
    // we would like to send. Then we will put the encoded internal message as an argument "payload" into the external
    // message we will send to our multisig

    const diceDeployMessage = (await client.abi.encode_message_body({
      abi: diceContract.abi,
      call_set: {
        function_name: "constructor",
        input: {},
      },
      is_internal: true,
      signer: signerNone(),
    })).body

    const diceContractAddress = await diceContract.getAddress();

    // We call submitTransaction method of multisig and pass diceDeployMessage and diceContractStateInit to deploy
    // our dice contract.
    // There we are creating an external message with arguments and sending it to the contract. For signing the message
    // by default will be used "signer" which one we specified when created and "casinoOwnerMultisig" instance - casino_owner_keys
    await casinoOwnerMultisig.run('submitTransaction', {
      dest: diceContractAddress,
      value: 9_000_000_000, // 9 VENOMs
      bounce: true,
      allBalance: false,
      payload: diceDeployMessage,
      stateInit: diceContractStateInit
    })

    // SIMPLIFIED how submitTransaction of msig2 looks like:
    // But if your msig2 has more than 1 custodian they will be putted into queue
    // and will wait for confirmation from other custodians
    //   function submitTransaction(
    //     address dest,
    //     uint128 value,
    //     bool bounce,
    //     bool allBalance,
    //     TvmCell payload,
    //     TvmCell stateInit
    // ) {
    //       require(msg.pubkey() == m_ownerKey, 100);
    //       uint8 flags = FLAG_IGNORE_ERRORS(1) | FLAG_PAY_FWD_FEE_FROM_BALANCE(2);
    //       if (allBalance) {
    //           flags = FLAG_IGNORE_ERRORS(1) | FLAG_SEND_ALL_REMAINING(128);
    //           value = 0;
    //       }
    //       dest.transfer({
    //         value: value,
    //         bounce: bounce,
    //         flag: sendFlags,
    //         body: payload,
    //         stateInit: stateInit
    //     });
    //   }


    console.log('Dice contract deployed, max bet is', nanoVenomsToVenoms((await diceContract.runLocal('maxBet', {}, {})).decoded.output.value0));

    // In the same way we create multisig for the player
    let playerMultisig = new Account(SetcodeMultisigContract, {
      signer: signerKeys(players_keys),
      client,
      initData: {},
    });

    const playerMultisigAddress = await casinoOwnerMultisig.getAddress();

    await playerMultisig.deploy({
      useGiver: true,
      initInput: {
        //constructor values
        owners: [`0x${players_keys.public}`],
        reqConfirms: 1,
        lifetime: 3600
      }})


    // We encode a message with params is_internal: true/signer: signerNone because this is an internal message
    // we would like to send. Then we will put the encoded internal message as an argument "payload" into the external
    // message we will send to our multisig
    const makeBetMessage = (await client.abi.encode_message_body({
      abi: diceContract.abi,
      call_set: {
        function_name: "roll",
        input: {
          _bet_dice_value: 0
        },
      },
      is_internal: true,
      signer: signerNone(),
    })).body;

    for (let i = 0; i < 100; i++) {
      // We use bignumber because it is good practise, maximum safe int in js is only 9_000_000 VENOMs
      // https://stackoverflow.com/questions/307179/what-is-javascripts-highest-integer-value-that-a-number-can-go-to-without-losin

      let maxBet = new BigNumber((await diceContract.runLocal('maxBet', {}, {})).decoded.output.value0);
      if (maxBet.lt(0.6 * 1_000_000_000)) {
        console.log('Dice contract has not enough balance to play');
        break;
      }
      let ourBalance = new BigNumber(await playerMultisig.getBalance());

      // 0.7 because 0.6 + gas;
      if (ourBalance.lt(0.7 * 1_000_000_000)) {
        console.log('We have not enough VENOMs to play');
        break;
      }
      console.log('\nTry to roll a dice...');

      let result = await playerMultisig.run('sendTransaction', {
        dest: diceContractAddress,
        value: 600_000_000, // 0.6 VENOMs
        bounce: true, // Send funds back on any error in desctination account
        flags: 1, // Pay delivery fee from the multisig balance, not from the value.
        payload: makeBetMessage
      });

      // Load list of all transactions and messages
      let transaction_tree = await client.net.query_transaction_tree({
        in_msg: result.transaction.in_msg,
        abi_registry: [playerMultisig.abi, diceContract.abi]});

      // Look for game event log
      let gameLogMessage = transaction_tree.messages.find(m => m.src === diceContractAddress && m.decoded_body && m.decoded_body.name === 'Game');
      if (!gameLogMessage)
        throw new Error('Game not found');

      if (gameLogMessage.decoded_body.value.prize !== '0') {
        console.log('We won', nanoVenomsToVenoms(gameLogMessage.decoded_body.value.prize), 'VENOMs');
        break;
      } else {
        console.log('Lose!')
      }
      await sleep(1);
    }

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

// To human readable amount
function nanoVenomsToVenoms(nano) {
  return (nano / 1_000_000_000).toString();
}

function sleep(seconds) {
  return new Promise(resolve => setTimeout(resolve, seconds * 1000));
}
