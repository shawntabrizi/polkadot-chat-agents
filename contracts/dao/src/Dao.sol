// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title Dao
/// @notice Proposals, staked votes and execution for chat groups (M14).
/// A chat group (spec 0011) is known here by `groupId` = keccak256 of its
/// group id string. The group's admin bot claims the group with its first
/// `setMembers` call and is from then on the only account that changes the
/// member list or proposes for that group. Members vote with a stake (at
/// least MIN_STAKE); the stake is the vote's weight and comes back with
/// `withdraw` after the deadline. After the deadline anyone may `execute` a
/// proposal whose yes weight is larger than its no weight: the contract then
/// makes the proposal's call with `value` from the group's treasury (in v1 a
/// plain transfer: empty `data`). Anyone may add to a treasury with `fund`.
///
/// Amounts are in the contract's value units: on pallet-revive that is the
/// native balance times the runtime's native-to-EVM ratio (1 PAS = 1e18).
/// `block.timestamp` is in seconds on this runtime.
contract Dao {
    uint256 public constant MIN_STAKE = 0.1 ether; // 0.1 PAS
    uint256 public constant MAX_TITLE_BYTES = 80;
    uint256 public constant MAX_DATA_BYTES = 256;

    struct Proposal {
        bytes32 groupId;
        address target;
        uint64 deadline;
        bool executed;
        address proposer;
        uint256 value;
        uint256 yes;
        uint256 no;
        string title;
        bytes data;
    }

    /// One slot per voter and proposal: the stake still held, and the side.
    struct Vote {
        uint128 stake;
        bool voted;
        bool support;
    }

    mapping(bytes32 => address) public groupAdmin;
    mapping(bytes32 => mapping(address => bool)) public isMember;
    mapping(bytes32 => uint256) public treasury;
    /// Proposal ids start at 1; `count` is the last one given.
    uint256 public count;
    mapping(uint256 => Proposal) private proposals;
    mapping(uint256 => mapping(address => Vote)) private votes;

    event GroupClaimed(bytes32 indexed groupId, address indexed admin);
    event MemberSet(bytes32 indexed groupId, address indexed account, bool member);
    event Funded(bytes32 indexed groupId, address indexed from, uint256 amount);
    event Proposed(uint256 indexed id, bytes32 indexed groupId, address indexed proposer, address target, uint256 value, uint64 deadline, string title);
    /// `yes` and `no` are the totals after this vote, so a watcher needs no read.
    event Voted(uint256 indexed id, address indexed voter, bool support, uint256 stake, uint256 yes, uint256 no);
    event Executed(uint256 indexed id, address indexed target, uint256 value);
    event Withdrawn(uint256 indexed id, address indexed voter, uint256 amount);

    /// Adds and removes members of a group. The first call for a group id
    /// makes the caller its admin.
    function setMembers(bytes32 groupId, address[] calldata add, address[] calldata remove) external {
        address admin = groupAdmin[groupId];
        if (admin == address(0)) {
            groupAdmin[groupId] = msg.sender;
            emit GroupClaimed(groupId, msg.sender);
        } else {
            require(admin == msg.sender, "not group admin");
        }
        for (uint256 i = 0; i < add.length; i++) {
            if (isMember[groupId][add[i]]) continue;
            isMember[groupId][add[i]] = true;
            emit MemberSet(groupId, add[i], true);
        }
        for (uint256 i = 0; i < remove.length; i++) {
            if (!isMember[groupId][remove[i]]) continue;
            isMember[groupId][remove[i]] = false;
            emit MemberSet(groupId, remove[i], false);
        }
    }

    function fund(bytes32 groupId) external payable {
        require(msg.value > 0, "no value");
        treasury[groupId] += msg.value;
        emit Funded(groupId, msg.sender, msg.value);
    }

    function propose(bytes32 groupId, string calldata title, address target, uint256 value, bytes calldata data, uint64 deadline)
        external
        returns (uint256 id)
    {
        require(groupAdmin[groupId] == msg.sender, "not group admin");
        require(bytes(title).length > 0 && bytes(title).length <= MAX_TITLE_BYTES, "title is 1 to 80 bytes");
        require(data.length <= MAX_DATA_BYTES, "data too long");
        require(target != address(0) && target != address(this), "bad target");
        require(deadline > block.timestamp, "deadline passed");
        id = ++count;
        Proposal storage p = proposals[id];
        p.groupId = groupId;
        p.target = target;
        p.deadline = deadline;
        p.proposer = msg.sender;
        p.value = value;
        p.title = title;
        p.data = data;
        emit Proposed(id, groupId, msg.sender, target, value, deadline, title);
    }

    function vote(uint256 id, bool support) external payable {
        Proposal storage p = proposals[id];
        require(p.deadline != 0, "no proposal");
        require(block.timestamp < p.deadline, "voting closed");
        require(isMember[p.groupId][msg.sender], "not a member");
        require(msg.value >= MIN_STAKE, "stake at least 0.1 PAS");
        Vote storage v = votes[id][msg.sender];
        require(!v.voted, "already voted");
        v.voted = true;
        v.support = support;
        v.stake = uint128(msg.value);
        if (support) p.yes += msg.value;
        else p.no += msg.value;
        emit Voted(id, msg.sender, support, msg.value, p.yes, p.no);
    }

    function execute(uint256 id) external {
        Proposal storage p = proposals[id];
        require(p.deadline != 0, "no proposal");
        require(block.timestamp >= p.deadline, "voting open");
        require(!p.executed, "already executed");
        require(p.yes > p.no, "not passed");
        uint256 value = p.value;
        require(treasury[p.groupId] >= value, "treasury too low");
        // State first: the call cannot run the proposal twice.
        p.executed = true;
        treasury[p.groupId] -= value;
        (bool ok,) = p.target.call{value: value}(p.data);
        require(ok, "call failed");
        emit Executed(id, p.target, value);
    }

    function withdraw(uint256 id) external {
        Proposal storage p = proposals[id];
        require(p.deadline != 0, "no proposal");
        require(block.timestamp >= p.deadline, "voting open");
        Vote storage v = votes[id][msg.sender];
        uint256 amount = v.stake;
        require(amount > 0, "no stake");
        v.stake = 0;
        (bool ok,) = msg.sender.call{value: amount}("");
        require(ok, "withdraw failed");
        emit Withdrawn(id, msg.sender, amount);
    }

    function proposal(uint256 id)
        external
        view
        returns (bytes32 groupId, address target, uint256 value, uint64 deadline, bool executed, uint256 yes, uint256 no, string memory title)
    {
        Proposal storage p = proposals[id];
        return (p.groupId, p.target, p.value, p.deadline, p.executed, p.yes, p.no, p.title);
    }

    /// The stake the voter still holds in a proposal, and whether it voted yes.
    function voteOf(uint256 id, address voter) external view returns (bool voted, bool support, uint256 stake) {
        Vote storage v = votes[id][voter];
        return (v.voted, v.support, v.stake);
    }
}
