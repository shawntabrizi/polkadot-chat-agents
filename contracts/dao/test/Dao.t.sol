// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Dao} from "../src/Dao.sol";

// The few Foundry cheatcodes these tests use (no forge-std dependency).
interface Vm {
    function prank(address sender) external;
    function startPrank(address sender) external;
    function deal(address who, uint256 amount) external;
    function warp(uint256 timestamp) external;
    function expectRevert(bytes calldata revertData) external;
}

contract DaoTest {
    Vm constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    Dao dao;
    address constant BOT = address(0xB07);
    address constant A = address(0xA11CE);
    address constant B = address(0xB0B);
    address constant C = address(0xC0C);
    address constant OUTSIDER = address(0x0DD);
    address constant PAYEE = address(0xFEE);
    bytes32 constant G = keccak256("group-1");
    uint256 constant PAS = 1e18;
    uint256 constant STAKE = PAS / 10;
    uint64 constant T0 = 1_000_000;

    function setUp() public {
        dao = new Dao();
        vm.deal(A, 10 * PAS);
        vm.deal(B, 10 * PAS);
        vm.deal(C, 10 * PAS);
        vm.deal(OUTSIDER, 10 * PAS);
        vm.warp(T0);
        address[] memory add = new address[](3);
        add[0] = A;
        add[1] = B;
        add[2] = C;
        vm.prank(BOT);
        dao.setMembers(G, add, new address[](0));
        vm.prank(OUTSIDER);
        dao.fund{value: PAS}(G);
    }

    function assertEq(uint256 a, uint256 b, string memory what) internal pure {
        require(a == b, what);
    }

    function err(string memory reason) internal pure returns (bytes memory) {
        return abi.encodeWithSignature("Error(string)", reason);
    }

    function propose(uint256 value) internal returns (uint256 id) {
        vm.prank(BOT);
        id = dao.propose(G, "Pay the designer", PAYEE, value, "", T0 + 90);
    }

    function vote(address who, uint256 id, bool support) internal {
        vm.prank(who);
        dao.vote{value: STAKE}(id, support);
    }

    // The first setMembers claims the group; nobody else can change it or propose for it.
    function test_onlyTheGroupAdminManagesAndProposes() public {
        require(dao.groupAdmin(G) == BOT, "the bot claimed the group");
        vm.expectRevert(err("not group admin"));
        vm.prank(A);
        dao.setMembers(G, new address[](0), new address[](0));
        vm.expectRevert(err("not group admin"));
        vm.prank(A);
        dao.propose(G, "Pay me", A, PAS, "", T0 + 90);
    }

    // A vote needs membership, the minimum stake, an open vote, and only one per account.
    function test_voteRules() public {
        uint256 id = propose(PAS / 5);
        vm.expectRevert(err("not a member"));
        vm.prank(OUTSIDER);
        dao.vote{value: STAKE}(id, true);
        vm.expectRevert(err("stake at least 0.1 PAS"));
        vm.prank(A);
        dao.vote{value: STAKE - 1}(id, true);
        vote(A, id, true);
        vm.expectRevert(err("already voted"));
        vote(A, id, false);
        vm.warp(T0 + 90);
        vm.expectRevert(err("voting closed"));
        vote(B, id, true);
    }

    // A removed member can no longer vote.
    function test_removedMemberCannotVote() public {
        address[] memory gone = new address[](1);
        gone[0] = C;
        vm.prank(BOT);
        dao.setMembers(G, new address[](0), gone);
        uint256 id = propose(PAS / 5);
        vm.expectRevert(err("not a member"));
        vote(C, id, true);
    }

    // The stake is the weight: two yes stakes beat one no stake, and the
    // passed proposal pays from the treasury exactly once, only after the deadline.
    function test_passedProposalExecutesOnce() public {
        uint256 id = propose(PAS / 5);
        vote(A, id, true);
        vote(B, id, true);
        vote(C, id, false);
        (,,,,, uint256 yes, uint256 no,) = dao.proposal(id);
        assertEq(yes, 2 * STAKE, "yes weight");
        assertEq(no, STAKE, "no weight");
        vm.expectRevert(err("voting open"));
        dao.execute(id);
        vm.warp(T0 + 90);
        uint256 before = PAYEE.balance;
        dao.execute(id);
        assertEq(PAYEE.balance - before, PAS / 5, "payee paid");
        assertEq(dao.treasury(G), PAS - PAS / 5, "treasury debited");
        vm.expectRevert(err("already executed"));
        dao.execute(id);
    }

    // A tie or a no majority does not pass.
    function test_rejectedProposalDoesNotExecute() public {
        uint256 id = propose(PAS / 5);
        vote(A, id, true);
        vote(B, id, false);
        vm.warp(T0 + 90);
        vm.expectRevert(err("not passed"));
        dao.execute(id);
    }

    // Stakes are never spent by an execution: the treasury pays, stakes come back.
    function test_treasuryTooLowKeepsStakesSafe() public {
        uint256 id = propose(2 * PAS);
        vote(A, id, true);
        vm.warp(T0 + 90);
        vm.expectRevert(err("treasury too low"));
        dao.execute(id);
    }

    // Every voter gets its stake back after the deadline, once.
    function test_withdrawAfterDeadline() public {
        uint256 id = propose(PAS / 5);
        vote(B, id, true);
        vm.expectRevert(err("voting open"));
        vm.prank(B);
        dao.withdraw(id);
        vm.warp(T0 + 90);
        dao.execute(id);
        uint256 before = B.balance;
        vm.prank(B);
        dao.withdraw(id);
        assertEq(B.balance - before, STAKE, "stake back");
        (bool voted, bool support, uint256 stake) = dao.voteOf(id, B);
        require(voted && support, "the vote stays recorded");
        assertEq(stake, 0, "no stake left");
        vm.expectRevert(err("no stake"));
        vm.prank(B);
        dao.withdraw(id);
    }

    function test_proposeBounds() public {
        vm.startPrank(BOT);
        vm.expectRevert(err("deadline passed"));
        dao.propose(G, "Late", PAYEE, 1, "", T0);
        vm.expectRevert(err("bad target"));
        dao.propose(G, "Self", address(dao), 1, "", T0 + 90);
        vm.expectRevert(err("title is 1 to 80 bytes"));
        dao.propose(G, "", PAYEE, 1, "", T0 + 90);
    }
}
