// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";

/// @title VYX junior token
/// @notice Fixed supply of 100,000,000 tokens minted once to the treasury.
///         No owner, no further minting, no transfer fees.
contract VYXToken is ERC20, ERC20Permit {
    uint256 public constant MAX_SUPPLY = 100_000_000 ether;

    error ZeroTreasury();

    constructor(string memory name_, string memory symbol_, address treasury)
        ERC20(name_, symbol_)
        ERC20Permit(name_)
    {
        if (treasury == address(0)) revert ZeroTreasury();
        _mint(treasury, MAX_SUPPLY);
    }
}
