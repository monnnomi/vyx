// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {VYXToken} from "../src/VYXToken.sol";
import {VYXDistributor} from "../src/VYXDistributor.sol";

/// Environment:
///   TOKEN_NAME, TOKEN_SYMBOL  token metadata (permanent)
///   TREASURY                  receives all 100,000,000 tokens (use a multisig on mainnet)
///   OWNER                     controls seasons and the fee (use a multisig on mainnet)
///   FEE_RECIPIENT             receives the claim service fees
///   CLAIM_FEE_WEI             optional fee override in wei; default is $0.03 at $1,500/ETH
contract Deploy is Script {
    function run() external {
        string memory name = vm.envString("TOKEN_NAME");
        string memory symbol = vm.envString("TOKEN_SYMBOL");
        address treasury = vm.envAddress("TREASURY");
        address owner = vm.envAddress("OWNER");
        address feeRecipient = vm.envAddress("FEE_RECIPIENT");
        uint256 fee = vm.envOr("CLAIM_FEE_WEI", uint256(0.00002 ether));

        vm.startBroadcast();
        VYXToken token = new VYXToken(name, symbol, treasury);
        VYXDistributor distributor = new VYXDistributor(IERC20(address(token)), owner, feeRecipient, fee);
        vm.stopBroadcast();

        console.log("VYXToken", address(token));
        console.log("VYXDistributor", address(distributor));
    }
}
