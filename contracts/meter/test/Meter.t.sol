// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Meter} from "../src/Meter.sol";

// The few Foundry cheatcodes these tests use (no forge-std dependency).
interface Vm {
    function prank(address sender) external;
    function deal(address who, uint256 amount) external;
    function expectRevert(bytes calldata revertData) external;
    function expectEmit(bool t1, bool t2, bool t3, bool data) external;
}

contract MeterTest {
    Vm constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    event Charged(address indexed user, uint256 amount, uint256 balance);

    Meter meter;
    address constant OPERATOR = address(0xB07);
    address constant USER = address(0xA11CE);
    address constant OTHER = address(0xB0B);
    uint256 constant PAS = 1e18;

    receive() external payable {}

    function setUp() public {
        meter = new Meter(OPERATOR);
        vm.deal(USER, 10 * PAS);
        vm.deal(OTHER, 10 * PAS);
    }

    function topUp(address who, uint256 amount) internal {
        vm.prank(who);
        meter.topUp{value: amount}();
    }

    function assertEq(uint256 a, uint256 b, string memory what) internal pure {
        require(a == b, what);
    }

    function test_topUpCreditsTheSenderOnly() public {
        topUp(USER, PAS);
        topUp(USER, PAS / 2);
        assertEq(meter.balanceOf(USER), PAS + PAS / 2, "user credited twice");
        assertEq(meter.balanceOf(OTHER), 0, "another account is not credited");
    }

    function test_topUpWithoutValueReverts() public {
        vm.expectRevert(abi.encodeWithSignature("Error(string)", "no value"));
        vm.prank(USER);
        meter.topUp();
    }

    // The bot charges after each reply: the balance drops by the price and
    // the Charged event carries what the client shows as the new balance.
    function test_operatorChargeDebitsAndEmits() public {
        topUp(USER, PAS);
        vm.expectEmit(true, false, false, true);
        emit Charged(USER, PAS / 10, PAS - PAS / 10);
        vm.prank(OPERATOR);
        meter.charge(USER, PAS / 10);
        assertEq(meter.balanceOf(USER), PAS - PAS / 10, "debited");
        assertEq(meter.earned(), PAS / 10, "earned");
    }

    // A reply is never charged past zero: the bot must ask for a top-up.
    function test_chargeAboveBalanceReverts() public {
        topUp(USER, PAS / 20);
        vm.expectRevert(abi.encodeWithSignature("Error(string)", "insufficient balance"));
        vm.prank(OPERATOR);
        meter.charge(USER, PAS / 10);
    }

    // Only the bot may spend a user's balance, never the user or a stranger.
    function test_onlyOperatorCharges() public {
        topUp(USER, PAS);
        vm.expectRevert(abi.encodeWithSignature("Error(string)", "not operator"));
        vm.prank(OTHER);
        meter.charge(USER, 1);
        vm.expectRevert(abi.encodeWithSignature("Error(string)", "not operator"));
        meter.charge(USER, 1); // the owner is not the operator either
    }

    function test_ownerChangesOperator() public {
        topUp(USER, PAS);
        vm.expectRevert(abi.encodeWithSignature("Error(string)", "not owner"));
        vm.prank(OPERATOR);
        meter.setOperator(OTHER);
        meter.setOperator(OTHER);
        vm.prank(OTHER);
        meter.charge(USER, 1);
        vm.expectRevert(abi.encodeWithSignature("Error(string)", "not operator"));
        vm.prank(OPERATOR);
        meter.charge(USER, 1);
    }

    // The owner withdraws only what was charged; prepaid balances stay.
    function test_ownerWithdrawsOnlyEarned() public {
        topUp(USER, PAS);
        vm.prank(OPERATOR);
        meter.charge(USER, PAS / 10);
        vm.expectRevert(abi.encodeWithSignature("Error(string)", "exceeds earned"));
        meter.withdraw(payable(address(this)), PAS / 10 + 1);
        uint256 before = address(this).balance;
        meter.withdraw(payable(address(this)), PAS / 10);
        assertEq(address(this).balance - before, PAS / 10, "owner received earned");
        assertEq(address(meter).balance, PAS - PAS / 10, "prepaid balance stays in the contract");
        vm.expectRevert(abi.encodeWithSignature("Error(string)", "not owner"));
        vm.prank(USER);
        meter.withdraw(payable(USER), 0);
    }
}
