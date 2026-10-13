import { Address, Context } from '@massalabs/massa-as-sdk';
import { u256 } from 'as-bignum/assembly/integer/u256';
import { Checkpoint, LockedBalance } from './Structs';
import { argsDelimiter } from '../utils';
import { IVotingEscrow } from '../interfaces';
import { _checkpoints, _delegates, _locked, numCheckpoints } from './Storage';

export class DelegationLogicLibrary {
  /// @notice Used by `_mint`, `_transferFrom`, `_burn` and `delegate`
  ///         to update delegator voting checkpoints.
  ///         Automatically dedelegates, then updates checkpoint.
  /// @dev This function depends on `_locked` and must be called prior to token state changes.
  ///      If you wish to dedelegate only, use `_delegate(tokenId, 0)` instead.
  /// @param _delegator The delegator to update checkpoints for
  /// @param _delegatee The new delegatee for the delegator. Cannot be equal to `_delegator` (use 0 instead).
  /// @param _owner The new (or current) owner for the delegator
  static checkpointDelegator(
    _delegator: u64,
    _delegatee: u64,
    _owner: Address,
  ): void {
    const _delegatorLocked = _locked.get(_delegator, new LockedBalance());
    const delegatedBalance = u256.from(_delegatorLocked.amount);

    const numCheckpoint = numCheckpoints.get(_delegator, 0);
    const cpOld =
      numCheckpoint > 0
        ? _checkpoints_(_delegator, numCheckpoint - 1)
        : _checkpoints_(_delegator, 0);
    // Dedelegate from delegatee if delegated
    this.checkpointDelegatee(cpOld.delegatee, delegatedBalance, false);
    const cp = _checkpoints_(_delegator, numCheckpoint);
    cp.fromTimestamp = Context.timestamp();
    cp.delegatedBalance = cpOld.delegatedBalance;
    cp.delegatee = _delegatee;
    cp.owner = _owner;

    if (this._isCheckpointInNewBlock(_delegator)) {
      const tmp = numCheckpoints.get(_delegator, 0);
      numCheckpoints.set(_delegator, tmp + 1);
    } else {
      _checkpoints.set(checkpointKey(_delegator, numCheckpoint - 1), cp);
      _checkpoints.delete(checkpointKey(_delegator, numCheckpoint));
    }

    _delegates.set(_delegator, _delegatee);
  }

  /// @notice Update delegatee's `delegatedBalance` by `balance`.
  ///         Only updates if delegating to a new delegatee.
  /// @dev If used with `balance` == `_locked[_tokenId].amount`, then this is the same as
  ///      delegating or dedelegating from `_tokenId`
  ///      If used with `balance` < `_locked[_tokenId].amount`, then this is used to adjust
  ///      `delegatedBalance` when a user's balance is modified (e.g. `increaseAmount`, `merge` etc).
  ///      If `delegatee` is 0 (i.e. user is not delegating), then do nothing.
  /// @param _delegatee The delegatee's tokenId
  /// @param balance_ The delta in balance change
  /// @param _increase True if balance is increasing, false if decreasing
  static checkpointDelegatee(
    _delegatee: u64,
    balance_: u256,
    _increase: bool,
  ): void {
    if (_delegatee == 0) return;
    const numCheckpoint = numCheckpoints.get(_delegatee, 0);
    const cpOld =
      numCheckpoint > 0
        ? _checkpoints_(_delegatee, numCheckpoint - 1)
        : _checkpoints_(_delegatee, 0);
    const cp = _checkpoints_(_delegatee, numCheckpoint);
    cp.fromTimestamp = Context.timestamp();
    cp.owner = cpOld.owner;
    // do not expect balance_ > cpOld.delegatedBalance when decrementing but just in case
    cp.delegatedBalance = _increase
      ? // @ts-ignore
        cpOld.delegatedBalance + balance_
      : balance_ < cpOld.delegatedBalance
      ? // @ts-ignore
        cpOld.delegatedBalance - balance_
      : u256.Zero;
    cp.delegatee = cpOld.delegatee;

    if (this._isCheckpointInNewBlock(_delegatee)) {
      numCheckpoints.set(_delegatee, numCheckpoint + 1);
    } else {
      const keyP = checkpointKey(_delegatee, numCheckpoint - 1);
      _checkpoints.set(keyP, cp);
      const key = checkpointKey(_delegatee, numCheckpoint);
      _checkpoints.delete(key);
    }
  }

  static _isCheckpointInNewBlock(_tokenId: u64): bool {
    const _nCheckPoints = numCheckpoints.get(_tokenId, 0);
    if (
      _nCheckPoints > 0 &&
      _checkpoints_(_tokenId, _nCheckPoints - 1).fromTimestamp ==
        Context.timestamp()
    )
      return false;
    else return true;
  }

  /// @notice Binary search to get the voting checkpoint for a token id at or prior to a given timestamp.
  /// @dev If a checkpoint does not exist prior to the timestamp, this will return 0.
  /// @param _tokenId .
  /// @param _timestamp .
  /// @return The index of the checkpoint.
  static getPastVotesIndex(_tokenId: u64, _timestamp: u64): u64 {
    const nCheckpoints = numCheckpoints.get(_tokenId, 0);
    if (nCheckpoints == 0) return 0;
    // First check most recent balance
    if (_checkpoints_(_tokenId, nCheckpoints - 1).fromTimestamp <= _timestamp)
      return nCheckpoints - 1;
    // Next check implicit zero balance
    if (_checkpoints_(_tokenId, 0).fromTimestamp > _timestamp) return 0;

    let lower: u64 = 0;
    let upper: u64 = nCheckpoints - 1;
    while (upper > lower) {
      const center = upper - (upper - lower) / 2; // ceil, avoiding overflow
      const cp = _checkpoints_(_tokenId, center);
      if (cp.fromTimestamp == _timestamp) {
        return center;
      } else if (cp.fromTimestamp < _timestamp) {
        lower = center;
      } else {
        upper = center - 1;
      }
    }
    return lower;
  }

  /// @notice Retrieves historical voting balance for a token id at a given timestamp.
  /// @dev If a checkpoint does not exist prior to the timestamp, this will return 0.
  ///      The user must also own the token at the time in order to receive a voting balance.
  /// @param _account .
  /// @param _tokenId .
  /// @param _timestamp .
  /// @return Total voting balance including delegations at a given timestamp.
  static getPastVotes(_account: Address, _tokenId: u64, _timestamp: u64): u256 {
    const _checkIndex = this.getPastVotesIndex(_tokenId, _timestamp);
    const lastCheckpoint = _checkpoints_(_tokenId, _checkIndex);
    // If no point exists prior to the given timestamp, return 0
    if (lastCheckpoint.fromTimestamp > _timestamp) return u256.Zero;
    // Check ownership
    if (_account != lastCheckpoint.owner) return u256.Zero;
    const votes = lastCheckpoint.delegatedBalance;
    return lastCheckpoint.delegatee == 0
      ? // @ts-ignore
        votes +
          new IVotingEscrow(Context.callee()).balanceOfNFTAt(
            _tokenId,
            _timestamp,
          )
      : votes;
  }
}

// HELPERS

export const checkpointKey = (x: u64, y: u64): string => {
  return x.toString() + argsDelimiter + y.toString();
};

const _checkpoints_ = (x: u64, y: u64): Checkpoint => {
  const key = checkpointKey(x, y);
  return _checkpoints.get(key, new Checkpoint());
};
