// SPDX-License-Identifier: MIT

pragma solidity ^0.6.0;

interface ISacredTrees {
  function registerDeposit(address instance, bytes32 commitment) external;

  function registerWithdrawal(address instance, bytes32 nullifier) external;
}
