// SPDX-License-Identifier: MIT
pragma solidity ^0.8.13;

contract HTLCBaseline {
    address payable public sender;
    address payable public receiver;
    bytes32 public hashlock;
    uint256 public timelock;

    bool public withdrawn;
    bool public refunded;
    bytes public preimage;

    constructor(
        address payable _receiver,
        bytes32 _hashlock,
        uint256 _timelock
    ) payable {
        sender = payable(msg.sender);
        receiver = _receiver;
        hashlock = _hashlock;
        timelock = _timelock;
    }

    function claim(bytes calldata _preimage) external {
        require(msg.sender == receiver, "only receiver");
        require(!withdrawn && !refunded, "closed");
        require(keccak256(_preimage) == hashlock, "bad preimage");

        withdrawn = true;
        preimage = _preimage;
        receiver.transfer(address(this).balance);
    }

    function refund() external {
        require(msg.sender == sender, "only sender");
        require(!withdrawn && !refunded, "closed");
        require(block.number >= timelock, "too early");

        refunded = true;
        sender.transfer(address(this).balance);
    }

    receive() external payable {}
}
