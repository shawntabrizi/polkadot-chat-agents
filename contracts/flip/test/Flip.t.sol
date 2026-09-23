// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Flip} from "../src/Flip.sol";

// The few Foundry cheatcodes these tests use (no forge-std dependency).
interface Vm {
    function prank(address sender) external;
    function deal(address who, uint256 amount) external;
    function roll(uint256 blockNumber) external;
    function warp(uint256 timestamp) external;
    function setBlockhash(uint256 blockNumber, bytes32 blockHash) external;
    function expectRevert(bytes calldata revertData) external;
    function expectEmit(bool t1, bool t2, bool t3, bool data) external;
}

contract FlipTest {
    Vm constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    event Settled(uint256 indexed round, address indexed winner, uint256 pot);
    event Matched(uint256 indexed round, address player1, address player2);

    Flip flip;
    address constant A = address(0xA11CE);
    address constant B = address(0xB0B);
    address constant C = address(0xC0C);
    uint256 constant PAS = 1e18;
    uint256 constant STAKE = PAS / 2;

    function setUp() public {
        flip = new Flip();
        vm.deal(A, 10 * PAS);
        vm.deal(B, 10 * PAS);
        vm.deal(C, 10 * PAS);
        vm.roll(100);
        vm.warp(1_000_000);
    }

    function assertEq(uint256 a, uint256 b, string memory what) internal pure {
        require(a == b, what);
    }

    function stake(address who) internal {
        vm.prank(who);
        flip.stake{value: STAKE}();
    }

    // The same rule as the contract, so a test can set up either outcome.
    function winnerFor(bytes32 prevHash, address p1, address p2) internal pure returns (address) {
        return uint256(keccak256(abi.encode(prevHash, p1, p2))) & 1 == 0 ? p1 : p2;
    }

    // Find a previous-block hash that makes `wanted` win, and set it.
    function forceWinner(address p1, address p2, address wanted) internal {
        for (uint256 i = 0; i < 64; i++) {
            bytes32 h = keccak256(abi.encode(i));
            if (winnerFor(h, p1, p2) == wanted) {
                vm.setBlockhash(block.number - 1, h);
                return;
            }
        }
        revert("no hash found");
    }

    // Only exactly 0.5 PAS is a stake: the pot must always be 1 PAS.
    function test_stakeNeedsExactValue() public {
        vm.expectRevert(abi.encodeWithSignature("Error(string)", "stake is 0.5 PAS"));
        vm.prank(A);
        flip.stake{value: STAKE - 1}();
        vm.expectRevert(abi.encodeWithSignature("Error(string)", "stake is 0.5 PAS"));
        vm.prank(A);
        flip.stake{value: PAS}();
    }

    // The first stake opens a round; the header shows "your stake: 0.5 PAS".
    function test_firstStakeOpensARound() public {
        stake(A);
        require(flip.pending() == A, "A waits");
        assertEq(flip.stakeOf(A), STAKE, "A's open stake");
        assertEq(flip.stakeOf(B), 0, "B has no stake");
        assertEq(flip.stakeOf(address(0)), 0, "zero address never has a stake");
        assertEq(address(flip).balance, STAKE, "stake held");
    }

    // A player cannot play against themself.
    function test_sameAccountCannotCloseItsOwnRound() public {
        stake(A);
        vm.expectRevert(abi.encodeWithSignature("Error(string)", "already staked"));
        stake(A);
    }

    // The second stake settles in the same call: the winner gets the whole
    // pot, stakes go back to 0, and the next round starts empty.
    function test_secondStakeSettlesAndPaysTheWinner() public {
        _settleWith(A);
        _settleWith(B);
    }

    function _settleWith(address wanted) internal {
        uint256 r = flip.round();
        stake(A);
        forceWinner(A, B, wanted);
        uint256 before = wanted.balance;
        vm.expectEmit(true, false, false, true);
        emit Matched(r, A, B);
        vm.expectEmit(true, true, false, true);
        emit Settled(r, wanted, 2 * STAKE);
        stake(B);
        uint256 gained = wanted.balance - before + (wanted == B ? STAKE : 0);
        assertEq(gained, 2 * STAKE, "winner gets the pot");
        assertEq(address(flip).balance, 0, "nothing left in the contract");
        require(flip.pending() == address(0), "round closed");
        assertEq(flip.stakeOf(A), 0, "A stake cleared");
        assertEq(flip.stakeOf(B), 0, "B stake cleared");
        assertEq(flip.round(), r + 1, "next round");
    }

    // A third player opens the next round after a settlement.
    function test_nextRoundAfterSettlement() public {
        stake(A);
        stake(B);
        stake(C);
        require(flip.pending() == C, "C waits in round 2");
        assertEq(flip.round(), 2, "round 2");
    }

    // A round nobody joins can be refunded by the owner, only after an hour.
    function test_ownerRefundsAStaleRound() public {
        stake(A);
        vm.expectRevert(abi.encodeWithSignature("Error(string)", "round too recent"));
        flip.refund();
        vm.warp(block.timestamp + 1 hours);
        vm.expectRevert(abi.encodeWithSignature("Error(string)", "not owner"));
        vm.prank(A);
        flip.refund();
        uint256 before = A.balance;
        flip.refund();
        assertEq(A.balance - before, STAKE, "stake returned");
        assertEq(flip.stakeOf(A), 0, "no open stake");
        assertEq(flip.round(), 2, "refunded round is closed");
        vm.expectRevert(abi.encodeWithSignature("Error(string)", "no open round"));
        flip.refund();
    }
}
