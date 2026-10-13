import { u256 } from 'as-bignum/assembly/integer/u256';
import { UserPoint, GlobalPoint } from './Structs';
import { i128 } from 'as-bignum/assembly/integer/i128';
import { WEEK } from '../utils';
import {
  _pointHistory,
  _userPointHistory,
  slopeChanges,
  userPointEpoch,
  userPointHistoryKey,
} from './Storage';

export class BalanceLogicLibrary {
  // u256 internal constant WEEK = 1 weeks;

  /// @notice Binary search to get the user point index for a token id at or prior to a given timestamp
  /// @dev If a user point does not exist prior to the timestamp, this will return 0.
  /// @param _tokenId .
  /// @param _timestamp .
  /// @return User point index
  static getPastUserPointIndex(_tokenId: u64, _timestamp: u64): u64 {
    let _userEpoch = userPointEpoch.get(_tokenId, 0);
    if (_userEpoch == 0) return 0;
    // First check most recent balance
    if (
      _userPointHistory.get(
        userPointHistoryKey(_tokenId, _userEpoch),
        new UserPoint(),
      ).ts <= _timestamp
    )
      return _userEpoch;
    // Next check implicit zero balance
    if (
      _userPointHistory.get(userPointHistoryKey(_tokenId, 1), new UserPoint())
        .ts > _timestamp
    )
      return 0;

    let lower: u64 = 0;
    let upper = _userEpoch;
    while (upper > lower) {
      const center: u64 = upper - (upper - lower) / 2; // ceil, avoiding overflow
      let userPoint = _userPointHistory.get(
        userPointHistoryKey(_tokenId, center),
        new UserPoint(),
      );
      if (userPoint.ts == _timestamp) return center;
      else if (userPoint.ts < _timestamp) lower = center;
      else upper = center - 1;
    }
    return lower;
  }

  /// @notice Binary search to get the global point index at or prior to a given timestamp
  /// @dev If a checkpoint does not exist prior to the timestamp, this will return 0.
  /// @param _epoch Current global point epoch
  /// @param _timestamp .
  /// @return Global point index
  static getPastGlobalPointIndex(_epoch: u64, _timestamp: u64): u64 {
    if (_epoch == 0) return 0;
    // First check most recent balance
    if (_pointHistory.get(_epoch, new GlobalPoint()).ts <= _timestamp)
      return _epoch;
    // Next check implicit zero balance
    if (_pointHistory.get(1, new GlobalPoint()).ts > _timestamp) return 0;

    let lower: u64 = 0;
    let upper = _epoch;
    while (upper > lower) {
      let center: u64 = upper - (upper - lower) / 2; // ceil, avoiding overflow
      const globalPoint = _pointHistory.get(center, new GlobalPoint());
      if (globalPoint.ts == _timestamp) return center;
      else if (globalPoint.ts < _timestamp) lower = center;
      else upper = center - 1;
    }
    return lower;
  }

  /// @notice Get the current voting power for `_tokenId`
  /// @dev Adheres to the ERC20 `balanceOf` interface for Aragon compatibility
  ///      Fetches last user point prior to a certain timestamp, then walks forward to timestamp.
  /// @param _tokenId NFT for lock
  /// @param _t Epoch time to return voting power at
  /// @return User voting power
  static balanceOfNFTAt(_tokenId: u64, _t: u64): u256 {
    const _epoch = this.getPastUserPointIndex(_tokenId, _t);
    // epoch 0 is an empty point
    if (_epoch == 0) return u256.Zero;
    const key = userPointHistoryKey(_tokenId, _epoch);
    const lastPoint = _userPointHistory.get(key, new UserPoint());
    if (lastPoint.permanent != u256.Zero) return lastPoint.permanent;
    else {
      // @ts-ignore
      lastPoint.bias -= lastPoint.slope * i128.from(_t - lastPoint.ts);
      if (lastPoint.bias < i128.Zero) lastPoint.bias = i128.Zero;

      return u256.from(lastPoint.bias);
    }
  }

  /// @notice Calculate total voting power at some point in the past
  /// @param _epoch The epoch to start search from
  /// @param _t Time to calculate the total voting power at
  /// @return Total voting power at that time
  static supplyAt(_epoch: u64, _t: u64): u256 {
    const epoch_ = this.getPastGlobalPointIndex(_epoch, _t);
    // epoch 0 is an empty point
    if (epoch_ == 0) return u256.Zero;
    const _point = _pointHistory.get(epoch_, new GlobalPoint());
    let bias = _point.bias;
    let slope = _point.slope;
    let ts = _point.ts;
    let t_i: u64 = (ts / WEEK) * WEEK;
    for (let i = 0; i < 255; ++i) {
      t_i += WEEK;
      let dSlope = i128.Zero;
      if (t_i > _t) t_i = _t;
      else dSlope = slopeChanges.get(t_i, i128.Zero);

      // @ts-ignore
      bias -= slope * i128.from(t_i - ts);
      if (t_i == _t) break;

      // @ts-ignore
      slope += dSlope;
      ts = t_i;
    }

    if (bias < i128.Zero) bias = i128.Zero;

    // @ts-ignore
    return u256.from(bias) + _point.permanentLockBalance;
  }
}
