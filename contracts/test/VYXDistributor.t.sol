// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {VYXToken} from "../src/VYXToken.sol";
import {VYXDistributor} from "../src/VYXDistributor.sol";

/// The Merkle fixture below was produced by server/merkle.js (see test/merkle.test.mjs),
/// so these tests also prove the server and the contract hash claims the same way.
contract VYXDistributorTest is Test {
    address constant ALICE = address(0xa11ce);
    address constant BOB = address(0xb0b);
    address constant CAROL = address(0xca401);
    bytes32 constant ROOT = 0x1ae7c8f931ee5bcb699b3b8cda7fd352b8a738b239cbe3d6e7bc91bceb44d717;
    uint256 constant A = 1000 ether;
    uint256 constant B = 2000 ether;
    uint256 constant C = 3000 ether;
    uint256 constant FEE = 0.00002 ether;

    address treasury = makeAddr("treasury");
    address owner = makeAddr("owner");
    address fees = makeAddr("fees");
    VYXToken token;
    VYXDistributor dist;

    function setUp() public {
        token = new VYXToken("VYX", "VYX", treasury);
        dist = new VYXDistributor(IERC20(address(token)), owner, fees, FEE);
        vm.prank(treasury);
        token.transfer(address(dist), 10_000 ether);
        vm.deal(ALICE, 1 ether);
        vm.deal(BOB, 1 ether);
        vm.deal(CAROL, 1 ether);
        vm.warp(1_800_000_000);
    }

    function proofA() internal pure returns (bytes32[] memory p) {
        p = new bytes32[](2);
        p[0] = 0x1ffd36cce091e06d3228f3c63bbd1e312ce8c448ae06b36d83945d6a4cec1d8e;
        p[1] = 0x742071670ef3f9fd572d50bd3209fbec74ea881bb937d66cc7bdf7fa58d5ca90;
    }

    function proofB() internal pure returns (bytes32[] memory p) {
        p = new bytes32[](2);
        p[0] = 0x9be6c8aabb1131a3c543aeea246b1a9f4783e05f25909566efdde721f9be4b0e;
        p[1] = 0x742071670ef3f9fd572d50bd3209fbec74ea881bb937d66cc7bdf7fa58d5ca90;
    }

    function proofC() internal pure returns (bytes32[] memory p) {
        p = new bytes32[](1);
        p[0] = 0x9145b34b1837fc1913ff81a550952a5d4fc1e2cf1c317474712dcc50481e92a5;
    }

    function one(uint256 id, uint256 allocation, bytes32[] memory proof)
        internal
        pure
        returns (uint256[] memory ids, uint256[] memory allocations, bytes32[][] memory proofs)
    {
        ids = new uint256[](1);
        allocations = new uint256[](1);
        proofs = new bytes32[][](1);
        ids[0] = id;
        allocations[0] = allocation;
        proofs[0] = proof;
    }

    function addSeason(uint16 tranches, uint32 interval) internal returns (uint256 id) {
        vm.prank(owner);
        id = dist.addSeason(ROOT, uint128(A + B + C), uint64(block.timestamp), tranches, interval);
    }

    function claimAs(address who, uint256 id, uint256 allocation, bytes32[] memory proof) internal returns (uint256) {
        (uint256[] memory i, uint256[] memory a, bytes32[][] memory p) = one(id, allocation, proof);
        vm.prank(who);
        return dist.claim{value: FEE}(i, a, p);
    }

    function test_TokenSupplyIsFixedAtTreasury() public view {
        assertEq(token.totalSupply(), 100_000_000 ether);
        assertEq(token.balanceOf(treasury), 100_000_000 ether - 10_000 ether);
    }

    function test_ServerTreeClaimsInFull() public {
        uint256 id = addSeason(1, 0);
        assertEq(claimAs(ALICE, id, A, proofA()), A);
        assertEq(claimAs(BOB, id, B, proofB()), B);
        assertEq(claimAs(CAROL, id, C, proofC()), C);
        assertEq(token.balanceOf(ALICE), A);
        assertEq(dist.outstanding(), 0);
        assertEq(address(dist).balance, 3 * FEE);
        dist.withdrawFees();
        assertEq(fees.balance, 3 * FEE);
    }

    function test_VestingUnlocksQuarterlyTranches() public {
        uint256 id = addSeason(4, 30 days);
        assertEq(claimAs(ALICE, id, A, proofA()), A / 4);
        (uint256[] memory i, uint256[] memory a, bytes32[][] memory p) = one(id, A, proofA());
        vm.prank(ALICE);
        vm.expectRevert(VYXDistributor.NothingToClaim.selector);
        dist.claim{value: FEE}(i, a, p);
        vm.warp(block.timestamp + 60 days);
        assertEq(claimAs(ALICE, id, A, proofA()), A / 2);
        vm.warp(block.timestamp + 365 days);
        assertEq(claimAs(ALICE, id, A, proofA()), A / 4);
        assertEq(token.balanceOf(ALICE), A);
    }

    function test_RejectsWrongProofAmountSenderAndFee() public {
        uint256 id = addSeason(1, 0);
        (uint256[] memory i, uint256[] memory a, bytes32[][] memory p) = one(id, A + 1, proofA());
        vm.prank(ALICE);
        vm.expectRevert(abi.encodeWithSelector(VYXDistributor.InvalidProof.selector, id));
        dist.claim{value: FEE}(i, a, p);
        (i, a, p) = one(id, A, proofA());
        vm.prank(BOB);
        vm.expectRevert(abi.encodeWithSelector(VYXDistributor.InvalidProof.selector, id));
        dist.claim{value: FEE}(i, a, p);
        vm.prank(ALICE);
        vm.expectRevert(VYXDistributor.WrongFee.selector);
        dist.claim{value: 0}(i, a, p);
        vm.prank(ALICE);
        vm.expectRevert(VYXDistributor.WrongFee.selector);
        dist.claim{value: FEE + 1}(i, a, p);
    }

    function test_OneFeeForSeveralSeasons() public {
        uint256 s1 = addSeason(1, 0);
        vm.prank(treasury);
        token.transfer(address(dist), 6000 ether);
        uint256 s2 = addSeason(1, 0);
        uint256[] memory i = new uint256[](2);
        uint256[] memory a = new uint256[](2);
        bytes32[][] memory p = new bytes32[][](2);
        i[0] = s1;
        i[1] = s2;
        a[0] = A;
        a[1] = A;
        p[0] = proofA();
        p[1] = proofA();
        vm.prank(ALICE);
        assertEq(dist.claim{value: FEE}(i, a, p), 2 * A);
        assertEq(address(dist).balance, FEE);
    }

    function test_OwnerCannotTakeAllocatedTokensOrOverchargeFee() public {
        addSeason(1, 0);
        vm.startPrank(owner);
        vm.expectRevert(VYXDistributor.ReservedTokens.selector);
        dist.withdrawExcess(owner, 4001 ether);
        dist.withdrawExcess(owner, 4000 ether);
        vm.expectRevert(VYXDistributor.FeeTooHigh.selector);
        dist.setClaimFee(0.0001 ether + 1);
        dist.setClaimFee(0);
        vm.expectRevert(VYXDistributor.Unfunded.selector);
        dist.addSeason(ROOT, 1, uint64(block.timestamp), 1, 0);
        vm.stopPrank();
        (uint256[] memory i, uint256[] memory a, bytes32[][] memory p) = one(0, A, proofA());
        vm.prank(ALICE);
        assertEq(dist.claim{value: 0}(i, a, p), A);
    }

    function test_OnlyOwnerManagesSeasons() public {
        vm.prank(ALICE);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, ALICE));
        dist.addSeason(ROOT, 1, 0, 1, 0);
    }

    function test_SeasonTotalCapsClaims() public {
        vm.prank(owner);
        uint256 id = dist.addSeason(ROOT, uint128(A), uint64(block.timestamp), 1, 0);
        claimAs(ALICE, id, A, proofA());
        (uint256[] memory i, uint256[] memory a, bytes32[][] memory p) = one(id, B, proofB());
        vm.prank(BOB);
        vm.expectRevert(abi.encodeWithSelector(VYXDistributor.SeasonExhausted.selector, id));
        dist.claim{value: FEE}(i, a, p);
    }
}
