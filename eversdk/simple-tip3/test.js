const { Account } = require("@eversdk/appkit");
const { TonClient, signerKeys, signerNone,
    builderOpInteger,
    builderOpBitString,
} = require("@eversdk/core");
const { libNode } = require("@eversdk/lib-node");
const BigNumber = require('bignumber.js');

TonClient.useBinaryLibrary(libNode);

const { TokenRootContract } = require("./artifacts/TokenRootContract.js")
const { TokenWalletContract } = require("./artifacts/TokenWalletContract.js")
const { TokenDiceContract } = require("./artifacts/TokenDiceContract.js")
const { SetcodeMultisigContract } = require("./artifacts/SetcodeMultisigContract");

async function main(client) {
    try {
        let response;
        // prepare
        const rootOwnerKeys = await TonClient.default.crypto.generate_random_sign_keys();
        const user1Keys = await TonClient.default.crypto.generate_random_sign_keys();
        const user2Keys = await TonClient.default.crypto.generate_random_sign_keys();

        const rootOwnerMsig = await deployMultisigForPubkey(client, rootOwnerKeys);
        const user1Msig = await deployMultisigForPubkey(client, user1Keys);
        const user2Msig = await deployMultisigForPubkey(client, user2Keys);

        const rootOwnerAddress = await rootOwnerMsig.getAddress();
        const user1Address = await user1Msig.getAddress();
        const user2Address = await user2Msig.getAddress();


        const rootContract = new Account(TokenRootContract, {
            signer: signerNone(), // pubkey is not set
            client,
            initData: {
                name_: 'Test token',
                symbol_: 'TST',
                decimals_: 9,
                rootOwner_: await rootOwnerMsig.getAddress(),
                walletCode_: TokenWalletContract.code,
            }
        });

        // Deploy token root
        let rootInitData = (await client.abi.encode_initial_data({
            abi: rootContract.abi,
            initial_data: {
                name_: 'Test token',
                symbol_: 'TST',
                decimals_: 9,
                rootOwner_: await rootOwnerMsig.getAddress(),
                walletCode_: TokenWalletContract.code,
            },
            initial_pubkey: `0x0000000000000000000000000000000000000000000000000000000000000000` // if zero pubkey must be such string
        })).data

        // We take code + initial data and make StateInit.
        // We will send stateInit along with the message to call the constructor.
        // Validator will check is hash(stateInit) === address and will Initialize our contract
        // (will add code + initial data to account )
        const rootStateInit = (await client.boc.encode_tvc({
            code: TokenRootContract.code,
            data: rootInitData
        })).tvc;

        // Secondly we encode a message witch one will call the constructor in the same transaction
        // Technically contract can be deployed without calling a constructor or any other function and the account will have
        // status - active. Solidity has a special hidden variable "_constructorFlag" and always check it before any call.
        // So your contract can not be called before the constructor will be called successfully.

        // We encode a message with params is_internal: true/signer: signerNone because this is an internal message
        // we would like to send. Then we will put the encoded internal message as an argument "payload" into the external
        // message we will send to our multisig
        const rootDeployMessage = (await client.abi.encode_message_body({
            abi: rootContract.abi,
            call_set: {
                function_name: "constructor",
                input: {
                    remainingGasTo: rootOwnerAddress
                },
            },
            is_internal: true,
            signer: signerNone(),
        })).body

        const rootAddress = await rootContract.getAddress();

        await rootOwnerMsig.run('submitTransaction', {
            dest: rootAddress,
            value: 2_000_000_000, // 2 VENOMs
            bounce: false,
            allBalance: false,
            payload: rootDeployMessage,
            stateInit: rootStateInit
        })
        console.log(`root contract deployed at address: ${rootAddress}`);


        // Deploy wallets for user1 and user2
        for (let userAddress of [user1Address, user2Address]) {
            await rootOwnerMsig.run('submitTransaction', {
                dest: rootAddress,
                value: 1_000_000_000, // We attach 1 VENOM to the internal message, the change must be returned to our account
                bounce: false,
                allBalance: false,
                payload: (await client.abi.encode_message_body({
                    abi: rootContract.abi,
                    call_set: {
                        function_name: "deployWallet",
                        input: {
                            answerId: 0,
                            walletOwner: userAddress,
                            deployWalletValue: 100_000_000 //0.1 VENOM
                        },
                    },
                    is_internal: true,
                    signer: signerNone(),
                })).body
            });
        }

        const user1WalletContract = new Account(TokenWalletContract, {
            signer: signerNone(), // pubkey is not set
            client,
            initData: {
                root_: rootAddress,
                owner_: user1Address
            }
        });

        // Get address of user1 token wallet contract
        const user1TokenWalletAddress = (await rootContract.runLocal('walletOf', {
            answerId: 0, // because function marked as responsible
            walletOwner: user1Address
        })).decoded.output.value0;

        // Get address of user2 token wallet contract
        const user2TokenWalletAddress = (await rootContract.runLocal('walletOf', {
            answerId: 0, // because function marked as responsible
            walletOwner: user2Address
        })).decoded.output.value0;


        // Create instances for tokenWallet contract by specify the adress of already deployed contract
        const user1TokenWalletContract = new Account(TokenWalletContract, {
            signer: signerNone(),
            client,
            address: user1TokenWalletAddress
        });

        // We also can create an instance by specify initial data. Address will be the same
        const user2TokenWalletContract = new Account(TokenWalletContract, {
            signer: signerNone(),
            client,
            initData: {
                root_: rootAddress,
                owner_: user2Address
            }
        });

        // Mint tokens for user1 and user2
        for (let userAddress of [user1Address, user2Address]) {
            await rootOwnerMsig.run('submitTransaction', {
                dest: rootAddress,
                value: 1_000_000_000, // We attach 1 VENOM to the internal message, the change must be returned to our account
                bounce: false,
                allBalance: false,
                payload: (await client.abi.encode_message_body({
                    abi: rootContract.abi,
                    call_set: {
                        function_name: "mint",
                        input: {
                            amount: 100_000_000_000, // 100 * 10 ^ 9
                            recipient: userAddress,
                            deployWalletValue: 100_000_000, // 0.1 VENOM
                            remainingGasTo: rootOwnerAddress,
                            notify: false,
                            payload: ''
                        },
                    },
                    is_internal: true,
                    signer: signerNone(),
                })).body
            });
        }

        // TokenWallet balance must be 100 tokens
        assert('100000000000' === (await user1TokenWalletContract.runLocal('balance', {answerId:0})).decoded.output.value0, 'User1 balance must be 100 tokens');
        assert('100000000000' === (await user2TokenWalletContract.runLocal('balance', {answerId:0})).decoded.output.value0, 'User2 balance must be 100 tokens');

        // Transfer 50 tokens from user1 to user2
        await user1Msig.run('submitTransaction', {
            dest: user1TokenWalletAddress,
            value: 1_000_000_000, // We attach 1 VENOM to the internal message, the change must be returned to our account
            bounce: false,
            allBalance: false,
            payload: (await client.abi.encode_message_body({
                abi: user1TokenWalletContract.abi,
                call_set: {
                    function_name: "transfer",
                    input: {
                        amount: 50_000_000_000, // 50 * 10 ^ 9
                        recipient: user2Address,
                        deployWalletValue: 100_000_000, // 0.1 VENOM
                        remainingGasTo: user1Address,
                        notify: false,
                        payload: ''
                    },
                },
                is_internal: true,
                signer: signerNone(),
            })).body
        });

        assert('50000000000' === (await user1TokenWalletContract.runLocal('balance', {answerId:0})).decoded.output.value0, 'User1 balance must be 50 tokens');
        assert('150000000000' === (await user2TokenWalletContract.runLocal('balance', {answerId:0})).decoded.output.value0, 'User2 balance must be 150 tokens');


        // Try to send 1000 tokens from user1 wallet, balances must stay the same
        // Because we have not such amount of tokens on our wallet
        await user1Msig.run('submitTransaction', {
            dest: user1TokenWalletAddress,
            value: 1_000_000_000, // We attach 1 VENOM to the internal message, the change must be returned to our account
            bounce: false,
            allBalance: false,
            payload: (await client.abi.encode_message_body({
                abi: user1TokenWalletContract.abi,
                call_set: {
                    function_name: "transfer",
                    input: {
                        amount: 1000_000_000_000, // 1000 * 10 ^ 9
                        recipient: user2Address,
                        deployWalletValue: 100_000_000, // 0.1 VENOM
                        remainingGasTo: user1Address,
                        notify: false,
                        payload: ''
                    },
                },
                is_internal: true,
                signer: signerNone(),
            })).body
        });

        assert('50000000000' === (await user1TokenWalletContract.runLocal('balance', {answerId:0})).decoded.output.value0, 'User1 balance must be 50 tokens');
        assert('150000000000' === (await user2TokenWalletContract.runLocal('balance', {answerId:0})).decoded.output.value0, 'User2 balance must be 150 tokens');

        // Okay, just deploy the TokenDice contract from user1 msig.
        const diceContract = new Account(TokenDiceContract,{
            signer: signerNone(),
            client,
            initData: {
                tokenRoot_: rootAddress,
                owner_: user1Address
            },
        });

        // To deploy the contract from another contract we need to calculate initial data (static variables + pubkey)
        let diceContractInitData = (await client.abi.encode_initial_data({
            abi: diceContract.abi,
            initial_data: {
                tokenRoot_: rootAddress,
                owner_: user1Address
            },
            initial_pubkey: `0x0000000000000000000000000000000000000000000000000000000000000000` // if zero pubkey must be such string
        })).data

        // We take code + initial data and make StateInit.
        // We will send stateInit along with the message to call the constructor.
        // Validator will check is hash(stateInit) === address and will Initialize our contract
        // (will add code + initial data to account )
        const diceContractStateInit = (await client.boc.encode_tvc({
            code: TokenDiceContract.code,
            data: diceContractInitData
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
        await user1Msig.run('submitTransaction', {
            dest: diceContractAddress,
            value: 3_000_000_000, // 3 VENOMs
            bounce: true,
            allBalance: false,
            payload: diceDeployMessage,
            stateInit: diceContractStateInit
        })

        console.log('Dice contract deployed at', diceContractAddress, ', max bet is',  (await diceContract.runLocal('maxBet', {}, {})).decoded.output.value0);

        // Transfer tokens to dice contract
        await user1Msig.run('submitTransaction', {
            dest: user1TokenWalletAddress,
            value: 1_000_000_000, // We attach 1 VENOM to the internal message, the change must be returned to our account
            bounce: false,
            allBalance: false,
            payload: (await client.abi.encode_message_body({
                abi: user1TokenWalletContract.abi,
                call_set: {
                    function_name: "transfer",
                    input: {
                        amount: 50_000_000_000, // 50 * 10 ^ 9
                        recipient: diceContractAddress,
                        deployWalletValue: 100_000_000, // 0.1 VENOM
                        remainingGasTo: user1Address,
                        notify: true,
                        payload: ''
                    },
                },
                is_internal: true,
                signer: signerNone(),
            })).body
        });

        // Encode payload TVMCell to pass data with token transfers
        const encodedDiceBetValue = (await client.abi.encode_boc({
            params: [
                { name: "_bet_dice_value", type: "uint8" },
            ],
            data: {
                "_bet_dice_value": "5",
            }
        })).boc;

        const playMessage = (await client.abi.encode_message_body({
            abi: user2TokenWalletContract.abi,
            call_set: {
                function_name: "transfer",
                input: {
                    amount: 1_000_000_000, // 1 * 10 ^ 9 - 1 token
                    recipient: diceContractAddress,
                    deployWalletValue: 0, // 0 VENOM because we knew wallet is already deployed
                    remainingGasTo: user2Address,
                    notify: true,
                    payload: encodedDiceBetValue
                },
            },
            is_internal: true,
            signer: signerNone(),
        })).body


        // try to play
        for (let i = 0; i < 1000; i++) {
            let maxBet = new BigNumber((await diceContract.runLocal('maxBet', {}, {})).decoded.output.value0);
            let ourBalance = new BigNumber((await user2TokenWalletContract.runLocal('balance', {answerId: 0}, {})).decoded.output.value0);

            const oneToken = new BigNumber(1_000_000_000);

            if (maxBet.lt(oneToken)) {
                console.log('Dice contract has not enough balance to play');
                break;
            }
            if (ourBalance.lt(oneToken)) {
                console.log('We have not enough tokens to play');
                break;
            }

            console.log('\nTry to roll a dice...', i);

            let result = await user2Msig.run('sendTransaction', {
                dest: user2TokenWalletAddress,
                value: 1_500_000_000, // 1.5 VENOMs
                bounce: true, // Send funds back on any error in desctination account
                flags: 1, // Pay delivery fee from the multisig balance, not from the value.
                payload: playMessage
            });

            // Load list of all transactions and messages
            let transaction_tree = await client.net.query_transaction_tree({
                in_msg: result.transaction.in_msg,
                abi_registry: [user2Msig.abi, user2TokenWalletContract.abi, diceContract.abi]});

            // Look for game event log
            let gameLogMessage = transaction_tree.messages.find(m => m.src === diceContractAddress && m.decoded_body && m.decoded_body.name === 'Game');
            if (!gameLogMessage) {
                throw new Error('Game not found');
            }

            if (gameLogMessage.decoded_body.value.prize !== '0') {
                console.log('We won', (parseInt(gameLogMessage.decoded_body.value.prize)/1_000_000_000).toFixed(2), 'tokens');
                let ourNewBalance = new BigNumber((await user2TokenWalletContract.runLocal('balance', {answerId: 0}, {})).decoded.output.value0);
                assert(ourNewBalance.eq(ourBalance.plus(new BigNumber(gameLogMessage.decoded_body.value.prize).minus(1_000_000_000))));
                break;
            } else {
                console.log('Lose!')
            }
            // await sleep(1);
        }


        // console.log('Tokens transferred', ', max bet is',  (await diceContract.runLocal('maxBet', {}, {})).decoded.output.value0);
        console.log('Tests successful');
    } catch (e) {
        console.error(e);
    }
}

async function deployMultisigForPubkey(client, keypair) {
    let multisig = new Account(SetcodeMultisigContract, {
        signer: signerKeys(keypair),
        client,
        initData: {},
    });

    await multisig.deploy({
        useGiver: true,
        initInput: {
            owners: [`0x${keypair.public}`],
            reqConfirms: 1,
            lifetime: 3600
        }})
    return multisig;
}

(async () => {
    const client = new TonClient({
        network: {
            // Local EVER OS SE instance URL here
            endpoints: [ "http://localhost" ]
        }
    });
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

function sleep(seconds) {
    return new Promise(resolve => setTimeout(resolve, seconds * 1000));
}

function assert(condition, error) {
    if (!condition) {
        throw new Error(error);
    }
}

