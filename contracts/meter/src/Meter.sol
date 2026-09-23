// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title Meter
/// @notice Prepaid balances for a pay-as-you-go chat bot (spec 0007).
/// A user tops up with `topUp()` and native value. The operator (the bot's
/// own account) charges a price for each reply with `charge`. The owner can
/// withdraw only what the operator charged, never a user's prepaid balance.
/// Amounts are in the contract's value units: on pallet-revive that is the
/// native balance times the runtime's native-to-EVM ratio (1 PAS = 1e18).
contract Meter {
    address public owner;
    address public operator;
    /// Charged value that the owner has not withdrawn yet.
    uint256 public earned;
    mapping(address => uint256) private balances;

    event ToppedUp(address indexed user, uint256 amount, uint256 balance);
    event Charged(address indexed user, uint256 amount, uint256 balance);
    event OperatorChanged(address indexed operator);
    event Withdrawn(address indexed to, uint256 amount);

    modifier onlyOwner() {
        require(msg.sender == owner, "not owner");
        _;
    }

    modifier onlyOperator() {
        require(msg.sender == operator, "not operator");
        _;
    }

    constructor(address initialOperator) {
        owner = msg.sender;
        operator = initialOperator;
        emit OperatorChanged(initialOperator);
    }

    /// Credits the sender with the value sent.
    function topUp() external payable {
        require(msg.value > 0, "no value");
        uint256 balance = balances[msg.sender] + msg.value;
        balances[msg.sender] = balance;
        emit ToppedUp(msg.sender, msg.value, balance);
    }

    function balanceOf(address user) external view returns (uint256) {
        return balances[user];
    }

    /// Debits `amount` from `user`. Reverts when the balance is too small.
    function charge(address user, uint256 amount) external onlyOperator {
        uint256 balance = balances[user];
        require(balance >= amount, "insufficient balance");
        balance -= amount;
        balances[user] = balance;
        earned += amount;
        emit Charged(user, amount, balance);
    }

    function setOperator(address newOperator) external onlyOwner {
        operator = newOperator;
        emit OperatorChanged(newOperator);
    }

    /// Sends up to `earned` to `to`.
    function withdraw(address payable to, uint256 amount) external onlyOwner {
        require(amount <= earned, "exceeds earned");
        earned -= amount;
        (bool ok,) = to.call{value: amount}("");
        require(ok, "transfer failed");
        emit Withdrawn(to, amount);
    }
}
