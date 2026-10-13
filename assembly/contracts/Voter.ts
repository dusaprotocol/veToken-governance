import {
  Args,
  bytesToU256,
  bytesToU64,
  stringToBytes,
  u256ToBytes,
  u64ToBytes,
} from '@massalabs/as-types';
import {
  Address,
  Context,
  generateEvent,
  isDeployingContract,
  Storage,
} from '@massalabs/massa-as-sdk';
import { PersistentMap } from '../libraries/persistentMap';
import { u256 } from 'as-bignum/assembly/integer/u256';
import { ProtocolTimeLibrary } from '../libraries/ProtocolTimeLibrary';
import { IERC20, IVotingEscrow } from '../interfaces';
import { argsDelimiter, u256ToString, zeroAddress } from '../utils';
import {
  ReentrancyGuardUpgradeable,
  SafeMath256,
  createEvent,
} from '@dusalabs/core';

/// @title Protocol Voter
/// @notice Manage votes, and emission distribution within the Protocol's ecosystem.

/// immutable

/// @inheritdoc IVoter
const __ve = 've';
function ve(): Address {
  return new Address(Storage.get(__ve));
}
function _ve(): IVotingEscrow {
  return new IVotingEscrow(ve());
}
/// @inheritdoc IVoter
const __governor = 'governor';
function governor(): Address {
  return new Address(Storage.get(__governor));
}
/// @inheritdoc IVoter
const __totalWeight = stringToBytes('totalWeight');
function totalWeight(): u256 {
  return bytesToU256(Storage.get(__totalWeight));
}
/// @inheritdoc IVoter
const __maxVotingNum = stringToBytes('maxVotingNum');
function maxVotingNum(): u64 {
  return bytesToU64(Storage.get(__maxVotingNum));
}
const MIN_MAXVOTINGNUM: u64 = 10;

const bribes = new PersistentMap<string, u256>('bribes');
function bribeKey(
  _pool: Address,
  _epoch: u64,
  _token: Address,
  _user: Address,
): string {
  return [
    _pool.toString(),
    _epoch.toString(),
    _token.toString(),
    _user.toString(),
  ].join(argsDelimiter);
}

/// @inheritdoc IVoter
const weights = new PersistentMap<Address, u256>('weights');
/// @inheritdoc IVoter
const votes = new PersistentMap<string, u256>('votes');
function votesKey(_tokenId: u64, _pool: Address): string {
  return _tokenId.toString() + argsDelimiter + _pool.toString();
}
/// @dev NFT => List of pools voted for by NFT
const poolVote = new PersistentMap<u64, string>('poolVote');
/// @inheritdoc IVoter
const usedWeights = new PersistentMap<u64, u256>('usedWeights');
/// @inheritdoc IVoter
const lastVoted = new PersistentMap<u64, u64>('lastVoted');
/// @inheritdoc IVoter
const isWhitelistedNFT = new PersistentMap<u64, bool>('isWhitelistedNFT');
/// @dev Pools that can receive votes, managed by the governor
const isWhitelistedPool = new PersistentMap<Address, bool>('isWhitelistedPool');

export function constructor(bs: StaticArray<u8>): void {
  assert(isDeployingContract(), 'Contract is already deployed');
  ReentrancyGuardUpgradeable.__ReentrancyGuard_init();

  const _sender = Context.caller().toString();
  const args = new Args(bs);
  const _ve_ = args.nextString().unwrap();

  Storage.set(__ve, _ve_);
  Storage.set(__governor, _sender);
  Storage.set(__maxVotingNum, u64ToBytes(30));
  Storage.set(__totalWeight, u256ToBytes(u256.Zero));
}

function onlyNewEpoch(_tokenId: u64): void {
  // ensure new epoch since last vote
  if (
    ProtocolTimeLibrary.epochStart(Context.timestamp()) <=
    lastVoted.get(_tokenId, 0)
  )
    assert(false, 'AlreadyVotedOrDeposited');
  if (
    Context.timestamp() <=
    ProtocolTimeLibrary.epochVoteStart(Context.timestamp())
  )
    assert(false, 'DistributeWindow');
}

/// @inheritdoc IVoter
export function setGovernor(bs: StaticArray<u8>): void {
  const _governor = new Address(new Args(bs).nextString().unwrap());
  if (Context.caller() != governor()) assert(false, 'NotGovernor');
  if (_governor == zeroAddress) assert(false, 'ZeroAddress');
  Storage.set(__governor, _governor.toString());
}

/// @inheritdoc IVoter
export function setMaxVotingNum(bs: StaticArray<u8>): void {
  const _maxVotingNum = new Args(bs).nextU64().unwrap();
  if (Context.caller() != governor()) assert(false, 'NotGovernor');
  if (_maxVotingNum < MIN_MAXVOTINGNUM)
    assert(false, 'MaximumVotingNumberTooLow');
  if (_maxVotingNum == maxVotingNum()) assert(false, 'SameValue');
  Storage.set(__maxVotingNum, u64ToBytes(_maxVotingNum));
}

/// @inheritdoc IVoter
export function reset(bs: StaticArray<u8>): void {
  const _tokenId = new Args(bs).nextU64().unwrap();
  onlyNewEpoch(_tokenId);
  ReentrancyGuardUpgradeable.nonReentrant();
  if (!_ve().isApprovedOrOwner(Context.caller(), _tokenId))
    assert(false, 'NotApprovedOrOwner');
  _reset(_tokenId);
  ReentrancyGuardUpgradeable.endNonReentrant();
}

function _reset(_tokenId: u64): void {
  const _poolVote = poolVotes(_tokenId);
  const _poolVoteCnt = _poolVote.length;
  let _totalWeight = u256.Zero;

  for (let i = 0; i < _poolVoteCnt; i++) {
    const _pool = _poolVote[i];
    const key = votesKey(_tokenId, _pool);
    const _votes = votes.get(key, u256.Zero);

    if (_votes != u256.Zero) {
      if (weights.contains(_pool))
        weights.set(_pool, SafeMath256.sub(weights.getSome(_pool), _votes));
      votes.delete(key);
      // new IReward(gaugeToFees.getSome(gauge))._withdraw(_votes, _tokenId);
      // new IReward(gaugeToBribe.getSome(gauge))._withdraw(_votes, _tokenId);
      _totalWeight = SafeMath256.add(_totalWeight, _votes);
      const event = createEvent('Abstained', [
        Context.caller().toString(),
        _pool.toString(),
        _tokenId.toString(),
        u256ToString(_votes),
        u256ToString(weights.getSome(_pool)),
        Context.timestamp().toString(),
      ]);
      generateEvent(event);
    }
  }
  _ve().voting(_tokenId, false);
  Storage.set(
    __totalWeight,
    u256ToBytes(SafeMath256.sub(totalWeight(), _totalWeight)),
  );
  usedWeights.set(_tokenId, u256.Zero);
  if (poolVote.contains(_tokenId)) poolVote.delete(_tokenId);
}

/// @inheritdoc IVoter
export function poke(bs: StaticArray<u8>): void {
  const _tokenId = new Args(bs).nextU64().unwrap();
  ReentrancyGuardUpgradeable.nonReentrant();
  if (
    Context.timestamp() <=
    ProtocolTimeLibrary.epochVoteStart(Context.timestamp())
  )
    assert(false, 'DistributeWindow');
  const _weight = _ve().balanceOfNFT(_tokenId);
  _poke(_tokenId, _weight);
  ReentrancyGuardUpgradeable.endNonReentrant();
}

const poolVotes = (_tokenId: u64): Address[] => {
  const bs = poolVote.get(_tokenId, '');
  if (bs == '') return [];
  return bs.split(',').map<Address>((b) => new Address(b));
};

function _poke(_tokenId: u64, _weight: u256): void {
  const _poolVote = poolVotes(_tokenId);
  const _poolCnt = _poolVote.length;
  const _weights: u256[] = new Array<u256>(_poolCnt).fill(u256.Zero);

  for (let i = 0; i < _poolCnt; i++) {
    _weights[i] = votes.get(votesKey(_tokenId, _poolVote[i]), u256.Zero);
  }
  _vote(_tokenId, _weight, _poolVote, _weights);
}

function _vote(
  _tokenId: u64,
  _weight: u256,
  _poolVoteAddress: Address[],
  _weights: u256[],
): void {
  _reset(_tokenId);
  const _poolCnt = _poolVoteAddress.length;
  let _totalVoteWeight = u256.Zero;
  let _totalWeight = u256.Zero;
  let _usedWeight = u256.Zero;

  // SafeMath: the weights are caller-supplied, a wrapping sum or product
  // would credit a pool more than the lock's voting power
  for (let i = 0; i < _poolCnt; i++) {
    _totalVoteWeight = SafeMath256.add(_totalVoteWeight, _weights[i]);
  }
  if (_poolCnt > 0 && _totalVoteWeight.isZero()) assert(false, 'ZeroWeights');

  for (let i = 0; i < _poolCnt; i++) {
    const _pool = _poolVoteAddress[i];

    // only whitelisted pools: an arbitrary string (e.g. containing the ','
    // separator of poolVote) would leave votes that _reset never removes
    if (!isWhitelistedPool.get(_pool, false))
      assert(false, 'PoolNotWhitelisted');

    const voteKey = _tokenId.toString() + argsDelimiter + _pool.toString();
    const _poolWeight: u256 = SafeMath256.div(
      SafeMath256.mul(_weights[i], _weight),
      _totalVoteWeight,
    );
    assert(votes.get(voteKey, u256.Zero).isZero(), 'NonZeroVotes');
    assert(!_poolWeight.isZero(), 'ZeroBalance');

    const _poolVote = poolVotes(_tokenId);
    _poolVote.push(_pool);
    poolVote.set(
      _tokenId,
      _poolVote.map<string>((pv) => pv.toString()).join(','),
    );

    weights.set(
      _pool,
      SafeMath256.add(weights.get(_pool, u256.Zero), _poolWeight),
    );
    votes.set(voteKey, _poolWeight);
    // new IReward(gaugeToFees.getSome(_gauge))._deposit(_poolWeight, _tokenId);
    // new IReward(gaugeToBribe.getSome(_gauge))._deposit(_poolWeight, _tokenId);
    _usedWeight = SafeMath256.add(_usedWeight, _poolWeight);
    _totalWeight = SafeMath256.add(_totalWeight, _poolWeight);
    const event = createEvent('Voted', [
      Context.caller().toString(),
      _pool.toString(),
      _tokenId.toString(),
      u256ToString(_poolWeight),
      u256ToString(weights.getSome(_pool)),
      Context.timestamp().toString(),
    ]);
    generateEvent(event);
  }
  if (_usedWeight > u256.Zero) _ve().voting(_tokenId, true);

  Storage.set(
    __totalWeight,
    u256ToBytes(SafeMath256.add(totalWeight(), _totalWeight)),
  );
  usedWeights.set(_tokenId, _usedWeight);
}

/// @inheritdoc IVoter
export function vote(bs: StaticArray<u8>): void {
  const args = new Args(bs);
  const _tokenId = args.nextU64().unwrap();
  const _poolVote: Address[] = args
    .nextSerializableObjectArray<Address>()
    .unwrap();
  const _weights: u256[] = args.nextFixedSizeArray<u256>().unwrap();

  onlyNewEpoch(_tokenId);
  ReentrancyGuardUpgradeable.nonReentrant();

  const _sender = Context.caller();
  if (!_ve().isApprovedOrOwner(_sender, _tokenId))
    assert(false, 'NotApprovedOrOwner');
  if (_poolVote.length != _weights.length) assert(false, 'UnequalLengths');
  if (u64(_poolVote.length) > maxVotingNum()) assert(false, 'TooManyPools');
  const _timestamp = Context.timestamp();
  if (
    _timestamp > ProtocolTimeLibrary.epochVoteEnd(_timestamp) &&
    !isWhitelistedNFT.get(_tokenId, false)
  )
    assert(false, 'NotWhitelistedNFT');
  lastVoted.set(_tokenId, _timestamp);
  const _weight = _ve().balanceOfNFT(_tokenId);
  _vote(_tokenId, _weight, _poolVote, _weights);

  ReentrancyGuardUpgradeable.endNonReentrant();
}
/// @inheritdoc IVoter
export function whitelistNFT(bs: StaticArray<u8>): void {
  const args = new Args(bs);
  const _tokenId = args.nextU64().unwrap();
  const _bool = args.nextBool().unwrap();

  const _sender = Context.caller();
  if (_sender != governor()) assert(false, 'NotGovernor');
  isWhitelistedNFT.set(_tokenId, _bool);
  const event = createEvent('WhitelistNFT', [
    _sender.toString(),
    _tokenId.toString(),
    _bool.toString(),
  ]);
  generateEvent(event);
}

/// @notice Allow or disallow votes for a pool
/// @dev Disallowing a pool doesn't remove existing votes: reset still works,
/// but voting or poking with that pool reverts
export function whitelistPool(bs: StaticArray<u8>): void {
  const args = new Args(bs);
  const _pool = args.nextString().unwrap();
  const _bool = args.nextBool().unwrap();

  const _sender = Context.caller();
  if (_sender != governor()) assert(false, 'NotGovernor');
  // ',' is the separator of the poolVote list
  if (_pool == '' || _pool.includes(',')) assert(false, 'InvalidPool');
  isWhitelistedPool.set(new Address(_pool), _bool);
  const event = createEvent('WhitelistPool', [
    _sender.toString(),
    _pool,
    _bool.toString(),
  ]);
  generateEvent(event);
}

//

export function depositBribes(bs: StaticArray<u8>): void {
  const args = new Args(bs);
  const _pool = new Address(args.nextString().unwrap());
  const _token = new Address(args.nextString().unwrap());
  const _amount = args.nextU256().unwrap();
  const _epoch = args.nextU64().unwrap();

  new IERC20(_token).transferFrom(Context.caller(), governor(), _amount);

  const key = bribeKey(_pool, _epoch, _token, Context.caller());
  bribes.set(key, SafeMath256.add(bribes.get(key, u256.Zero), _amount));

  const event = createEvent('DepositBribe', [
    Context.caller().toString(),
    _pool.toString(),
    _token.toString(),
    u256ToString(_amount),
    _epoch.toString(),
  ]);
  generateEvent(event);
}
