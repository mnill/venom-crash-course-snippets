pragma ever-solidity >= 0.64.0;

interface ITokenWallet {
    function owner() external view responsible returns (address);
    function balance() external view responsible returns (uint128);

    function transfer(
        uint128 amount,
        address recipient,
        uint128 deployWalletValue,
        address remainingGasTo,
        bool notify,
        TvmCell payload
    ) external;

    function acceptTransfer(
        uint128 amount,
        address sender,
        address remainingGasTo,
        bool notify,
        TvmCell payload
    ) external;

    function acceptMint(
        uint128 amount,
        address remainingGasTo,
        bool notify,
        TvmCell payload
    ) external;
}
