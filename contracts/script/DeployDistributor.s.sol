// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {VYXDistributor} from "../src/VYXDistributor.sol";

/// Deploys a new VYXDistributor for an existing jVYX token.
/// Environment: TOKEN, OWNER, FEE_RECIPIENT, optional CLAIM_FEE_WEI (default 0.00002 ETH).
contract DeployDistributor is Script {
    function run() external {
        IERC20 token = IERC20(vm.envAddress("TOKEN"));
        address owner = vm.envAddress("OWNER");
        address feeRecipient = vm.envAddress("FEE_RECIPIENT");
        uint256 fee = vm.envOr("CLAIM_FEE_WEI", uint256(0.00002 ether));
        require(token.totalSupply() == 100_000_000 ether, "TOKEN is not jVYX");

        vm.startBroadcast();
        VYXDistributor distributor = new VYXDistributor(token, owner, feeRecipient, fee);
        vm.stopBroadcast();

        require(distributor.MAX_TRANCHES() == 365, "old distributor source");
        console.log("VYXDistributor", address(distributor));
    }
}
