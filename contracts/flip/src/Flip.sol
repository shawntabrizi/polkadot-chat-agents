// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title Flip
/// @notice A two-player coin flip for a chat bot (spec 0007, M11b).
/// Each player sends exactly STAKE with `stake()`. The first stake opens a
/// round; the second closes it and settles in the same call: the contract
/// picks a winner with block randomness, pays the whole pot, and a new round
/// starts. The owner can refund a round that nobody joined for an hour.
///
/// Randomness: keccak256(abi.encode(blockhash(block.number - 1), player1,
/// player2)). `block.prevrandao` is a constant on pallet-revive
/// (2500000000000000, checked on devnet 2026-09-23), so it is not used.
/// The second player can predict the result before signing (a dry-run shows
/// it). The owner accepted that for a devnet demo; do not use this contract
/// for stakes of value.
///
/// Amounts are in the contract's value units: on pallet-revive that is the
/// native balance times the runtime's native-to-EVM ratio (1 PAS = 1e18).
contract Flip {
    uint256 public constant STAKE = 0.5 ether; // 0.5 PAS
    uint256 public constant REFUND_AFTER = 1 hours;

    address public owner;
    /// The number of the open (or next) round, from 1.
    uint256 public round = 1;
    address private player1;
    uint256 private openedAt;

    event Staked(uint256 indexed round, address indexed player);
    /// Both players of a settled round, emitted just before Settled, so a
    /// watcher that missed the first stake still knows both players.
    event Matched(uint256 indexed round, address player1, address player2);
    event Settled(uint256 indexed round, address indexed winner, uint256 pot);
    event Refunded(uint256 indexed round, address indexed player, uint256 amount);

    constructor() {
        owner = msg.sender;
    }

    function stake() external payable {
        require(msg.value == STAKE, "stake is 0.5 PAS");
        uint256 current = round;
        address first = player1;
        emit Staked(current, msg.sender);
        if (first == address(0)) {
            player1 = msg.sender;
            openedAt = block.timestamp;
            return;
        }
        require(first != msg.sender, "already staked");
        // State first: a new round starts before any value moves.
        player1 = address(0);
        openedAt = 0;
        round = current + 1;
        bytes32 seed = keccak256(abi.encode(blockhash(block.number - 1), first, msg.sender));
        address winner = uint256(seed) & 1 == 0 ? first : msg.sender;
        uint256 pot = 2 * STAKE;
        emit Matched(current, first, msg.sender);
        (bool ok,) = winner.call{value: pot}("");
        require(ok, "payout failed");
        emit Settled(current, winner, pot);
    }

    /// The player waiting in the open round, or address(0).
    function pending() external view returns (address) {
        return player1;
    }

    /// The account's stake in the open round: STAKE while it waits, else 0.
    function stakeOf(address player) external view returns (uint256) {
        return player != address(0) && player == player1 ? STAKE : 0;
    }

    /// Pays the waiting player back when the round is older than REFUND_AFTER.
    function refund() external {
        require(msg.sender == owner, "not owner");
        address first = player1;
        require(first != address(0), "no open round");
        require(block.timestamp >= openedAt + REFUND_AFTER, "round too recent");
        uint256 current = round;
        player1 = address(0);
        openedAt = 0;
        round = current + 1;
        (bool ok,) = first.call{value: STAKE}("");
        require(ok, "refund failed");
        emit Refunded(current, first, STAKE);
    }
}
