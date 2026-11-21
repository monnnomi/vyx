// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {MerkleProof} from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import {Ownable, Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title VYX season distributor
/// @notice Each season publishes a Merkle root of (account, allocation) pairs computed
///         by the VYX server (server/merkle.js). Allocations unlock in equal tranches.
///         Members claim with one transaction for any number of seasons and pay a small
///         fixed service fee in ETH per transaction, capped by MAX_CLAIM_FEE.
///         Allocated tokens can never be withdrawn by the owner.
contract VYXDistributor is Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;

    struct Season {
        bytes32 root;
        uint128 total;
        uint128 claimed;
        uint64 start;
        uint32 interval;
        uint16 tranches;
    }

    /// Hard ceiling on the per-transaction service fee, denominated in ETH.
    uint256 public constant MAX_CLAIM_FEE = 0.0001 ether;
    /// Up to one tranche per day for a year (e.g. 90 tranches, 1 day apart = daily unlocks).
    uint16 public constant MAX_TRANCHES = 365;

    IERC20 public immutable token;
    uint256 public claimFee;
    address public feeRecipient;
    uint256 public seasonCount;
    /// Tokens allocated to seasons and not yet claimed.
    uint256 public outstanding;

    mapping(uint256 => Season) public seasons;
    mapping(uint256 => mapping(address => uint256)) public claimed;

    event SeasonAdded(uint256 indexed id, bytes32 root, uint256 total, uint64 start, uint16 tranches, uint32 interval);
    event Claimed(uint256 indexed season, address indexed account, uint256 amount);
    event ClaimFeeChanged(uint256 fee);
    event FeeRecipientChanged(address recipient);
    event FeesWithdrawn(address recipient, uint256 amount);
    event ExcessWithdrawn(address to, uint256 amount);

    error InvalidSeason();
    error Unfunded();
    error WrongFee();
    error FeeTooHigh();
    error ZeroAddress();
    error LengthMismatch();
    error InvalidProof(uint256 season);
    error NothingToClaim();
    error ReservedTokens();
    error TransferFailed();
    error SeasonExhausted(uint256 season);

    constructor(IERC20 token_, address owner_, address feeRecipient_, uint256 claimFee_) Ownable(owner_) {
        if (address(token_) == address(0) || feeRecipient_ == address(0)) revert ZeroAddress();
        if (claimFee_ > MAX_CLAIM_FEE) revert FeeTooHigh();
        token = token_;
        feeRecipient = feeRecipient_;
        claimFee = claimFee_;
        emit ClaimFeeChanged(claimFee_);
        emit FeeRecipientChanged(feeRecipient_);
    }

    // ---- owner ----

    /// @notice Publish a season. The contract must already hold enough unallocated tokens.
    /// @param tranches 1 = everything unlocks at `start`; 4 with a 30-day interval = 25% monthly;
    ///        90 with a 1-day interval = daily unlocks over 90 days.
    function addSeason(bytes32 root, uint128 total, uint64 start, uint16 tranches, uint32 interval)
        external
        onlyOwner
        returns (uint256 id)
    {
        if (root == bytes32(0) || total == 0 || tranches == 0 || tranches > MAX_TRANCHES) revert InvalidSeason();
        if (tranches > 1 && interval == 0) revert InvalidSeason();
        if (token.balanceOf(address(this)) < outstanding + total) revert Unfunded();
        id = seasonCount++;
        seasons[id] = Season(root, total, 0, start, interval, tranches);
        outstanding += total;
        emit SeasonAdded(id, root, total, start, tranches, interval);
    }

    function setClaimFee(uint256 fee) external onlyOwner {
        if (fee > MAX_CLAIM_FEE) revert FeeTooHigh();
        claimFee = fee;
        emit ClaimFeeChanged(fee);
    }

    function setFeeRecipient(address recipient) external onlyOwner {
        if (recipient == address(0)) revert ZeroAddress();
        feeRecipient = recipient;
        emit FeeRecipientChanged(recipient);
    }

    /// @notice Return tokens that are not allocated to any season (e.g. over-funding).
    function withdrawExcess(address to, uint256 amount) external onlyOwner {
        if (to == address(0)) revert ZeroAddress();
        if (token.balanceOf(address(this)) < outstanding + amount) revert ReservedTokens();
        token.safeTransfer(to, amount);
        emit ExcessWithdrawn(to, amount);
    }

    /// @notice Send collected service fees to the fee recipient. Anyone may call it.
    function withdrawFees() external nonReentrant {
        uint256 amount = address(this).balance;
        (bool ok,) = feeRecipient.call{value: amount}("");
        if (!ok) revert TransferFailed();
        emit FeesWithdrawn(feeRecipient, amount);
    }

    // ---- members ----

    /// @notice Unlocked part of `allocation` in season `id` at the current time.
    function unlocked(uint256 id, uint256 allocation) public view returns (uint256) {
        Season storage s = seasons[id];
        if (s.root == bytes32(0) || block.timestamp < s.start) return 0;
        if (s.tranches == 1) return allocation;
        uint256 steps = 1 + (block.timestamp - s.start) / s.interval;
        if (steps >= s.tranches) return allocation;
        return allocation * steps / s.tranches;
    }

    /// @notice Tokens `account` could claim now in season `id` with a valid proof.
    function claimable(uint256 id, address account, uint256 allocation) external view returns (uint256) {
        return unlocked(id, allocation) - claimed[id][account];
    }

    /// @notice Claim unlocked tokens from one or more seasons in a single transaction.
    /// @dev msg.value must equal claimFee exactly; the fee is charged once per call.
    function claim(uint256[] calldata ids, uint256[] calldata allocations, bytes32[][] calldata proofs)
        external
        payable
        nonReentrant
        returns (uint256 amount)
    {
        if (msg.value != claimFee) revert WrongFee();
        if (ids.length == 0 || ids.length != allocations.length || ids.length != proofs.length) revert LengthMismatch();
        for (uint256 i; i < ids.length; ++i) {
            uint256 id = ids[i];
            Season storage s = seasons[id];
            if (s.root == bytes32(0)) revert InvalidSeason();
            bytes32 leaf = keccak256(bytes.concat(keccak256(abi.encode(msg.sender, allocations[i]))));
            if (!MerkleProof.verifyCalldata(proofs[i], s.root, leaf)) revert InvalidProof(id);
            uint256 due = unlocked(id, allocations[i]) - claimed[id][msg.sender];
            if (due == 0) continue;
            if (uint256(s.claimed) + due > s.total) revert SeasonExhausted(id);
            claimed[id][msg.sender] += due;
            s.claimed += uint128(due);
            amount += due;
            emit Claimed(id, msg.sender, due);
        }
        if (amount == 0) revert NothingToClaim();
        outstanding -= amount;
        token.safeTransfer(msg.sender, amount);
    }
}
