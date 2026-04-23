pragma solidity ^0.8.0;

contract CTLCMultipleEdges {
    address payable party;
    address payable counterparty;
    uint[] timelock;
    bytes32[][][] conditions;
    uint height;
    bool closed;

    constructor(
        address payable _party,
        address payable _counterparty,
        uint[] memory _timelock,
        bytes32[][][] memory _conditions
    ) payable {
        require(_timelock.length == _conditions.length, "len mismatch");
        require(_timelock.length > 0, "empty");
        for (uint i = 1; i < _timelock.length; i++) {
            require(_timelock[i] > _timelock[i - 1], "timelocks must increase");
        }
        party = _party;
        counterparty = _counterparty;
        timelock = _timelock;
        conditions = _conditions;
        height = 0;
    }

    function disableSubcontract(uint i) public {
        require(!closed, "closed");
        require(msg.sender == party, "only party");
        require(i == height, "not current");
        require(i < timelock.length - 1, "last => refund");
        require(block.number >= timelock[i], "too early");
        height++;
    }

    function claim(uint i, uint j, bytes[] memory secrets) public {
        require(!closed, "closed");
        require(msg.sender == counterparty, "only counterparty");
        require(i == height, "not current");
        require(secrets.length == conditions[i][j].length, "arity mismatch");
        for (uint k = 0; k < secrets.length; k++) {
            require(keccak256(secrets[k]) == conditions[i][j][k], "bad secret");
        }
        closed = true;
        counterparty.transfer(address(this).balance);
    }

    function refund() public {
        require(!closed, "closed");
        require(msg.sender == party, "only party");
        require(height == timelock.length - 1, "not last subcontract");
        require(block.number >= timelock[height], "too early");
        closed = true;
        party.transfer(address(this).balance);
    }

    receive() external payable {}
}
