// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {VYXTournamentEntry} from "../src/VYXTournamentEntry.sol";

contract TournamentToken is ERC20 {
    constructor(address participant) ERC20("VYX Junior", "jVYX") {
        _mint(participant, 20_000 ether);
    }
}

contract VYXTournamentEntryTest is Test {
    address constant PARTICIPANT = address(0x1111);
    address constant TREASURY = address(0x2222);
    address payable constant RECIPIENT = payable(address(0x3333));
    uint256 constant FEE = 0.00002 ether;
    VYXTournamentEntry entry;
    TournamentToken token;

    function setUp() external {
        token = new TournamentToken(PARTICIPANT);
        entry = new VYXTournamentEntry(token, TREASURY, RECIPIENT, uint64(block.timestamp + 1 days));
        vm.deal(PARTICIPANT, 1 ether);
    }

    function testEntryCollectsBothAmountsOnce() external {
        vm.startPrank(PARTICIPANT);
        token.approve(address(entry), 20_000 ether);
        entry.enter{value: FEE}();
        assertEq(token.balanceOf(TREASURY), 10_000 ether);
        assertEq(RECIPIENT.balance, FEE);
        assertTrue(entry.entered(PARTICIPANT));
        vm.expectRevert(VYXTournamentEntry.AlreadyEntered.selector);
        entry.enter{value: FEE}();
        vm.stopPrank();
    }

    function test_RevertWhenTokenTransferFails() external {
        vm.prank(PARTICIPANT);
        vm.expectRevert();
        entry.enter{value: FEE}();
        assertEq(RECIPIENT.balance, 0);
        assertFalse(entry.entered(PARTICIPANT));
    }

    function testWrongFeeAndClosedEntryRevert() external {
        vm.startPrank(PARTICIPANT);
        token.approve(address(entry), 10_000 ether);
        vm.expectRevert(VYXTournamentEntry.WrongFee.selector);
        entry.enter();
        vm.warp(entry.closesAt());
        vm.expectRevert(VYXTournamentEntry.EntryClosed.selector);
        entry.enter{value: FEE}();
        assertEq(token.balanceOf(TREASURY), 0);
        vm.stopPrank();
    }
}
