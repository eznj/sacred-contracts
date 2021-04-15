// SPDX-License-Identifier: GPL-3.0

pragma solidity ^0.6.0;
pragma experimental ABIEncoderV2;

import "./Sacred.sol";

contract ETHSacred is Sacred {
  constructor(
    IVerifier _verifier,
    IHasher _hasher,
    ISacredTrees _logger,
    uint256 _denomination,
    uint32 _merkleTreeHeight,
    address _operator
  ) public Sacred(_verifier, _hasher, _logger, _denomination, _merkleTreeHeight, _operator) {}

  function _processDeposit() internal virtual override {
    require(msg.value == denomination, "Please send `mixDenomination` ETH along with transaction");
  }

  function _processWithdraw(
    address payable _recipient,
    address payable _relayer,
    uint256 _fee,
    uint256 _refund
  ) internal virtual override {
    // sanity checks
    require(msg.value == 0, "Message value is supposed to be zero for ETH instance");
    require(_refund == 0, "Refund value is supposed to be zero for ETH instance");

    (bool success, ) = _recipient.call{ value: denomination - _fee }("");
    require(success, "payment to _recipient did not go thru");
    if (_fee > 0) {
      (success, ) = _relayer.call{ value: _fee }("");
      require(success, "payment to _relayer did not go thru");
    }
  }
}