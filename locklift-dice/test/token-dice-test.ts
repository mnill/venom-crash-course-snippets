import { expect } from "chai";
import {Address, Contract, Signer, zeroAddress} from "locklift";
import { FactorySource } from "../build/factorySource";
import BigNumber from "bignumber.js";
import {EverWalletAccount} from "everscale-standalone-client/nodejs";

let signer: Signer;
let TokenOwner: EverWalletAccount;
let TokenDice: Contract<FactorySource["TokenDice"]>;
let TokenRoot: Contract<FactorySource["TokenRootUpgradeable"]>;
let OwnerTokenWallet: Contract<FactorySource["TokenWalletUpgradeable"]>;

describe("Test Dice contract", async function () {
  before(async () => {
    signer = (await locklift.keystore.getSigner("0"))!;
    TokenOwner = await EverWalletAccount.fromPubkey({publicKey: signer.publicKey, workchain: 0});
    await locklift.giver.sendTo(TokenOwner.address, locklift.utils.toNano(10));
    locklift.factory.accounts.storage.addAccount(TokenOwner);

    const TokenWalletUpgradable = locklift.factory.getContractArtifacts("TokenWalletUpgradeable");
    const TokenRootUpgradeable = locklift.factory.getContractArtifacts("TokenRootUpgradeable");
    const TokenWalletPlatform = locklift.factory.getContractArtifacts("TokenWalletPlatform");

    // Deploy new TokenRoot ( because we have randomNonce contracts address will always be a new one)
    const { contract: tokenRoot } = await locklift.factory.deployContract({
      contract: "TokenRootUpgradeable",
      publicKey: signer.publicKey,
      initParams: {
        randomNonce_: locklift.utils.getRandomNonce(),
        rootOwner_: TokenOwner.address,
        name_: 'Test',
        symbol_: 'Test',
        deployer_: zeroAddress,
        decimals_: 9,
        walletCode_: TokenWalletUpgradable.code,
        platformCode_: TokenWalletPlatform.code
      },
      constructorParams: {
        initialSupplyTo: zeroAddress,
        initialSupply: '0',
        deployWalletValue: '0',
        mintDisabled: false,
        burnByRootDisabled: false,
        burnPaused: false,
        remainingGasTo: TokenOwner.address,
      },
      // How many tokens send from the giver to the contract
      // before deploy it by an external message
      value: locklift.utils.toNano(2),
    });

    TokenRoot = tokenRoot;
  });

  describe("Contracts", async function () {
    it("Load contract factory", async function () {
      const tokenDiceData = await locklift.factory.getContractArtifacts("TokenDice");

      expect(tokenDiceData.code).not.to.equal(undefined, "Code should be available");
      expect(tokenDiceData.abi).not.to.equal(undefined, "ABI should be available");
      expect(tokenDiceData.tvc).not.to.equal(undefined, "tvc should be available");
    });

    it("Deploy token dice contract by internal message", async function () {
      const tokenDiceData = await locklift.factory.getContractArtifacts("TokenDice");

      // Encode stateInit of tokenDice contract
      const {address: diceContractAddress, stateInit: tokenDiceStateInit} = await locklift.provider.getStateInit(tokenDiceData.abi, {
        tvc: tokenDiceData.tvc,
        workchain: 0,
        initParams: {
          tokenRoot_: TokenRoot.address,
          owner_: TokenOwner.address
        }
      })

      TokenDice = new locklift.provider.Contract(tokenDiceData.abi, diceContractAddress)

      const tracing = await locklift.tracing.trace(
        TokenDice.methods.constructor({}).send({
          from: TokenOwner.address,
          amount: locklift.utils.toNano(3),
          stateInit: tokenDiceStateInit
        })
      )

      expect(await locklift.provider.getBalance(TokenDice.address).then(balance => Number(balance))).to.be.above(0);
    });

    it("Mint tokens to owner's wallet", async function () {
      const amount_to_mint = new BigNumber(100_000_000_000); //100 tokens * 9 decimals

      await locklift.tracing.trace(TokenRoot.methods.mint({
        amount: amount_to_mint.toFixed(),
        recipient: TokenOwner.address,
        deployWalletValue: locklift.utils.toNano(0.1), // 0.1 VENOM
        remainingGasTo: TokenOwner.address,
        notify: false,
        payload: "",
      }).send({
        from: TokenOwner.address,
        amount: locklift.utils.toNano(1)
      }))

      const ownerTokenWalletAddress = (await TokenRoot.methods.walletOf({answerId: 0, walletOwner: TokenOwner.address}).call()).value0;
      OwnerTokenWallet = locklift.factory.getDeployedContract('TokenWalletUpgradeable', ownerTokenWalletAddress);

      const { value0: tokenWalletBalance} = await OwnerTokenWallet.methods.balance({answerId: 0}).call();
      const { value0: totalSupply } = await TokenRoot.methods.totalSupply({ answerId: 0 }).call();

      expect(tokenWalletBalance).to.be.equal(amount_to_mint.toFixed(0), "Wrong tokens amount");
      expect(totalSupply).to.be.equal(amount_to_mint.toFixed(0), "Wrong total supply amount");
    });

    it("Mint tokens to TokenDice contract", async function () {
      const amount_to_mint = new BigNumber(10_000_000_000); //10 tokens * 9 decimals

      await locklift.tracing.trace(TokenRoot.methods.mint({
        amount: amount_to_mint.toFixed(),
        recipient: TokenDice.address,
        deployWalletValue: locklift.utils.toNano(0.1), // 0.1 VENOM
        remainingGasTo: TokenOwner.address,
        notify: true,
        payload: "",
      }).send({
        from: TokenOwner.address,
        amount: locklift.utils.toNano(1)
      }))

      const tokenDiceBalance = await TokenDice.methods.balance_({}).call();
      const tokenDiceMaxBet = await TokenDice.methods.maxBet({}).call();

      expect(tokenDiceBalance.balance_).to.be.equal(amount_to_mint.toFixed(0), "Wrong tokens amount");
      expect(tokenDiceMaxBet.value0).to.be.equal(amount_to_mint.div(5).toFixed(0, BigNumber.ROUND_DOWN), "Wrong max bet");
    });

    it("If we tried to play with bet_value gt then maxBet tokens must return back", async function () {
      const { value0: tokenDiceMaxBet } = await TokenDice.methods.maxBet({}).call();
      const { value0: ownerTokenWalletBalanceBeforePlay} = await OwnerTokenWallet.methods.balance({answerId: 0}).call();

      const betPayload = (await locklift.provider.packIntoCell({
        data: {
          _bet_dice_value: 5,
        },
        structure: [
          {name: '_bet_dice_value', type: 'uint8'}
        ] as const,
      })).boc;

      await locklift.tracing.trace(OwnerTokenWallet.methods.transfer({
        amount: new BigNumber(tokenDiceMaxBet).plus(1).toFixed(),
        recipient: TokenDice.address,
        // We will not deploy target wallet because we sure wallet is exists
        // If there is no wallet at the destination
        // tokens will return
        deployWalletValue: 0,
        remainingGasTo: TokenOwner.address,
        notify: true,
        payload: betPayload
      }).send({
        from: TokenOwner.address,
        amount: locklift.utils.toNano(1)
      }));

      let {value0: ownerTokenWalletBalanceAfterPlay} = await OwnerTokenWallet.methods.balance({answerId: 0}).call();
      expect(ownerTokenWalletBalanceBeforePlay).to.be.equal(ownerTokenWalletBalanceAfterPlay, "Wrong tokens amount");
    });

    it("If we play we will eventually win", async function () {
      for (let i = 0; i < 100; i++) {
        const { value0: ownerTokenWalletBalanceBeforePlay} = await OwnerTokenWallet.methods.balance({answerId: 0}).call();

        const betPayload = (await locklift.provider.packIntoCell({
          data: {
            _bet_dice_value: 5,
          },
          structure: [
            {name: '_bet_dice_value', type: 'uint8'}
          ] as const,
        })).boc;

        const tracing = await locklift.tracing.trace(OwnerTokenWallet.methods.transfer({
          amount: new BigNumber(1).shiftedBy(9).toFixed(), // 1 * 10^9(decimals) = 1 token
          recipient: TokenDice.address,
          deployWalletValue: 0,
          remainingGasTo: TokenOwner.address,
          notify: true,
          payload: betPayload
        }).send({
          from: TokenOwner.address,
          amount: locklift.utils.toNano(1)
        }));

        let {value0: ownerTokenWalletBalanceAfterPlay} = await OwnerTokenWallet.methods.balance({answerId: 0}).call();

        // Find event Game(address player, uint8 bet, uint8 result,  uint128 prize); in transaction tree
        let gameEvent = tracing.traceTree?.findEventsForContract({
          contract: TokenDice,
          name: "Game",
        });

        if (gameEvent![0].result === gameEvent![0].bet) {
          // We won!
          expect(new BigNumber(ownerTokenWalletBalanceBeforePlay).lt(new BigNumber(ownerTokenWalletBalanceAfterPlay))).to.be.true;
          break;
        } else {
          expect(new BigNumber(ownerTokenWalletBalanceBeforePlay).gt(new BigNumber(ownerTokenWalletBalanceAfterPlay))).to.be.true;
        }
      }
    });
  });
});
