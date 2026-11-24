// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

contract VYXTournamentEntry {
    using SafeERC20 for IERC20;

    uint256 public constant ENTRY_AMOUNT = 10_000 ether;
    uint256 public constant SERVICE_FEE = 0.00002 ether;
    IERC20 public immutable token;
    address public immutable treasury;
    address payable public immutable feeRecipient;
    uint64 public immutable closesAt;
    mapping(address => bool) public entered;

    error InvalidConfiguration();
    error EntryClosed();
    error AlreadyEntered();
    error WrongFee();
    error FeeTransferFailed();

    event Entered(address indexed participant, uint256 amount, uint256 serviceFee);

    constructor(IERC20 token_, address treasury_, address payable feeRecipient_, uint64 closesAt_) {
        if (address(token_).code.length == 0 || treasury_ == address(0) ||
            feeRecipient_ == address(0) || closesAt_ <= block.timestamp) revert InvalidConfiguration();
        token = token_;
        treasury = treasury_;
        feeRecipient = feeRecipient_;
        closesAt = closesAt_;
    }

    function enter() external payable {
        if (block.timestamp >= closesAt) revert EntryClosed();
        if (entered[msg.sender]) revert AlreadyEntered();
        if (msg.value != SERVICE_FEE) revert WrongFee();

        entered[msg.sender] = true;
        token.safeTransferFrom(msg.sender, treasury, ENTRY_AMOUNT);
        (bool sent,) = feeRecipient.call{value: msg.value}("");
        if (!sent) revert FeeTransferFailed();
        emit Entered(msg.sender, ENTRY_AMOUNT, msg.value);
    }
}
