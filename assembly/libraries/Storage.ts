import { PersistentMap } from './persistentMap';
import { Checkpoint, GlobalPoint, LockedBalance, UserPoint } from './Structs';
import { i128 } from 'as-bignum/assembly/integer/i128';
import { argsDelimiter } from '../utils';

export const userPointEpoch = new PersistentMap<u64, u64>('userPointEpoch');
export const _userPointHistory = new PersistentMap<string, UserPoint>(
  'userPointHistory',
);
export const userPointHistoryKey = (tokenId: u64, index: u64): string =>
  tokenId.toString() + argsDelimiter + index.toString();
export const _pointHistory = new PersistentMap<u64, GlobalPoint>(
  'pointHistory',
); // epoch -> unsigned global point
export const slopeChanges = new PersistentMap<u64, i128>('slopeChanges');
export const _locked = new PersistentMap<u64, LockedBalance>('locked');
/// @notice A record of delegated token checkpoints for each tokenId, by index
/// @dev key is combination of tokenId and index
export const _checkpoints = new PersistentMap<string, Checkpoint>(
  '_checkpoints',
);
/// @inheritdoc IVotingEscrow
export const numCheckpoints = new PersistentMap<u64, u64>('numCheckpoints');
/// @notice A record of each accounts delegate
export const _delegates = new PersistentMap<u64, u64>('_delegates');
