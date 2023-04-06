const {Address} = require("everscale-inpage-provider");

// Never!!! commit your giver private key!
const giverKeyPair = {
  secretKey: '172af540e43a524763dd53b26a066d472a97c4de37d5498170564510608250c3',
  publicKey: '2ada2e65ab8eeab09490e3521415f45b6e42df9c760a639bcf53957550b25a16'
} ;
const address = new Address('0:ece57bcc6c530283becbbd8a3b24d3c5987cdddc3c8b7b33be6e4a6312490415');

const giverAbi = {
  "ABI version": 2,
  header: ["time", "expire"],
  functions: [
    {
      name: "upgrade",
      inputs: [{ name: "newcode", type: "cell" }],
      outputs: [],
    },
    {
      name: "sendTransaction",
      inputs: [
        { name: "dest", type: "address" },
        { name: "value", type: "uint128" },
        { name: "bounce", type: "bool" },
      ],
      outputs: [],
    },
    {
      name: "getMessages",
      inputs: [],
      outputs: [
        {
          components: [
            { name: "hash", type: "uint256" },
            { name: "expireAt", type: "uint64" },
          ],
          name: "messages",
          type: "tuple[]",
        },
      ],
    },
    {
      name: "constructor",
      inputs: [],
      outputs: [],
    },
  ],
  events: [],
};

function getGiverKeypair() {
  return giverKeyPair
}

async function getTokensFromGiver(provider, sendTo, value) {
  const giverContract = new provider.Contract(giverAbi, address);
  // We call 'sendTransaction' method of the giver
  const {transaction} = await giverContract.methods
    .sendTransaction({
      value: value,
      dest: sendTo,
      bounce: false,
    })
    // Provider will search for signer for this pubkey in their keystore
    .sendExternal({ publicKey: giverKeyPair.publicKey });

  if (transaction.aborted) {
    throw new Error(`Transaction aborted with code ${transaction.exitCode}`)
  }
}

module.exports = { getGiverKeypair, getTokensFromGiver };
