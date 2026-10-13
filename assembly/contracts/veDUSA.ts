import {
  Args,
  boolToByte,
  bytesToU256,
  bytesToU64,
  stringToBytes,
  u256ToBytes,
  u64ToBytes,
  u8toByte,
} from '@massalabs/as-types';
import {
  Address,
  Context,
  generateEvent,
  isAddressEoa,
  isDeployingContract,
  keccak256,
  Storage,
} from '@massalabs/massa-as-sdk';
import { PersistentMap } from '../libraries/persistentMap';
import { argsDelimiter, DAY, u256ToString, WEEK, zeroAddress } from '../utils';
import { u256 } from 'as-bignum/assembly/integer/u256';
import { i128 } from 'as-bignum/assembly/integer';
import { IERC20 } from '../interfaces';
import {
  checkpointKey,
  DelegationLogicLibrary,
} from '../libraries/DelegationLogicLibrary';
import {
  Checkpoint,
  GetLocksReturn,
  GlobalPoint,
  LockedBalance,
  UserPoint,
} from '../libraries/Structs';
import { BalanceLogicLibrary } from '../libraries/BalanceLogicLibrary';
import {
  ReentrancyGuardUpgradeable,
  SafeMath,
  SafeMath256,
  createEvent,
} from '@dusalabs/core';
import {
  _checkpoints,
  _locked,
  _pointHistory,
  _userPointHistory,
  slopeChanges,
  userPointEpoch,
  _delegates,
  userPointHistoryKey,
} from '../libraries/Storage';

// TODO: necesssary?
export * from '@massalabs/sc-standards/assembly/contracts/MRC721';

/// @title Voting Escrow V2
/// @notice veNFT implementation that escrows ERC-20 tokens in the form of an ERC-721 NFT
/// @notice Votes have a weight depending on time, so that users are committed to the future of (whatever they are voting for)
/// @author Modified from Solidly (https://github.com/solidlyexchange/solidly/blob/master/contracts/ve.sol)
/// @author Modified from Curve (https://github.com/curvefi/curve-dao-contracts/blob/master/contracts/VotingEscrow.vy)
/// @author velodrome.finance, @figs999, @pegahcarter
/// @dev Vote weight decays linearly over time. Lock time cannot be more than `MAXTIME` (4 years).

enum DepositType {
  DEPOSIT_FOR_TYPE,
  CREATE_LOCK_TYPE,
  INCREASE_LOCK_AMOUNT,
  INCREASE_UNLOCK_TIME,
}

/*//////////////////////////////////////////////////////////////
                               CONSTRUCTOR
//////////////////////////////////////////////////////////////*/

/// @param _token `Dusa` token address
export function constructor(bs: StaticArray<u8>): void {
  assert(isDeployingContract(), 'Contract is already deployed');
  ReentrancyGuardUpgradeable.__ReentrancyGuard_init();

  const caller = Context.caller().toString();
  const args = new Args(bs);
  const _token = args.nextString().unwrap();

  Storage.set(__token, _token);
  Storage.set(__team, caller);
  Storage.set(__voter, caller);
  Storage.set(__epoch, u64ToBytes(0));
  Storage.set(__tokenId, u64ToBytes(0));
  Storage.set(__supply, u256ToBytes(u256.Zero));
  Storage.set(__permanentLockBalance, u256ToBytes(u256.Zero));

  Storage.set(__artProxy, zeroAddress.toString());

  const pointHistory0 = new GlobalPoint();
  pointHistory0.blk = Context.currentPeriod();
  pointHistory0.ts = Context.timestamp();
  _pointHistory.set(0, pointHistory0);

  Transfer(zeroAddress, Context.callee(), tokenId());
  Transfer(Context.callee(), zeroAddress, tokenId());
}

/*//////////////////////////////////////////////////////////////
                               EVENTS
//////////////////////////////////////////////////////////////*/

function Transfer(from: Address, to: Address, tokenId: u64): void {
  const event = createEvent('Transfer', [
    from.toString(),
    to.toString(),
    tokenId.toString(),
  ]);
  generateEvent(event);
}

function Deposit(
  from: Address,
  tokenId: u64,
  depositType: u32,
  value: u256,
  unlockTime: u64,
  timestamp: u64,
): void {
  const event = createEvent('Deposit', [
    from.toString(),
    tokenId.toString(),
    depositType.toString(),
    u256ToString(value),
    unlockTime.toString(),
    timestamp.toString(),
  ]);
  generateEvent(event);
}

function Supply(before: u256, after: u256): void {
  const event = createEvent('Supply', [
    u256ToString(before),
    u256ToString(after),
  ]);
  generateEvent(event);
}

function Approval(owner: Address, approved: Address, tokenId: u64): void {
  const event = createEvent('Approval', [
    owner.toString(),
    approved.toString(),
    tokenId.toString(),
  ]);
  generateEvent(event);
}

function ApprovalForAll(
  owner: Address,
  operator: Address,
  approved: bool,
): void {
  const event = createEvent('ApprovalForAll', [
    owner.toString(),
    operator.toString(),
    approved.toString(),
  ]);
  generateEvent(event);
}

function MetadataUpdate(tokenId: u64): void {
  const event = createEvent('MetadataUpdate', [tokenId.toString()]);
  generateEvent(event);
}
function BatchMetadataUpdate(fromTokenId: u64, toTokenId: u64): void {
  const event = createEvent('BatchMetadataUpdate', [
    fromTokenId.toString(),
    toTokenId.toString(),
  ]);
  generateEvent(event);
}

function Withdraw(
  sender: Address,
  tokenId: u64,
  value: u256,
  timestamp: u64,
): void {
  const event = createEvent('Withdraw', [
    sender.toString(),
    tokenId.toString(),
    u256ToString(value),
    timestamp.toString(),
  ]);
  generateEvent(event);
}

function LockPermanent(
  sender: Address,
  tokenId: u64,
  amount: u256,
  timestamp: u64,
): void {
  const event = createEvent('LockPermanent', [
    sender.toString(),
    tokenId.toString(),
    u256ToString(amount),
    timestamp.toString(),
  ]);
  generateEvent(event);
}

function UnlockPermanent(
  sender: Address,
  tokenId: u64,
  amount: u256,
  timestamp: u64,
): void {
  const event = createEvent('UnlockPermanent', [
    sender.toString(),
    tokenId.toString(),
    u256ToString(amount),
    timestamp.toString(),
  ]);
  generateEvent(event);
}

function DelegateChanged(
  delegator: Address,
  fromDelegate: u64,
  toDelegate: u64,
): void {
  const event = createEvent('DelegateChanged', [
    delegator.toString(),
    fromDelegate.toString(),
    toDelegate.toString(),
  ]);
  generateEvent(event);
}

/*//////////////////////////////////////////////////////////////
                               STORAGE
//////////////////////////////////////////////////////////////*/

/// @notice Address of token (DUSA) used to create a veNFT
const __token = 'token';
/// @notice Address of Voter.ts
const __voter = 'voter';
/// @notice Address of Protocol Team multisig
const __team = 'team';
/// @notice Address of art proxy used for on-chain art generation
const __artProxy = 'artProxy';

function token(): string {
  return Storage.get(__token);
}
function voter(): string {
  return Storage.get(__voter);
}
function team(): string {
  return Storage.get(__team);
}
function artProxy(): string {
  return Storage.get(__artProxy);
}

/// @dev Current count of token
const __tokenId = stringToBytes('tokenId');
function tokenId(): u64 {
  return bytesToU64(Storage.get(__tokenId));
}

/*///////////////////////////////////////////////////////////////
                             METADATA STORAGE
//////////////////////////////////////////////////////////////*/

const __name = 'veNFT';
export function name(_: StaticArray<u8>): StaticArray<u8> {
  return stringToBytes(__name);
}
const __symbol = 'veNFT';
export function symbol(_: StaticArray<u8>): StaticArray<u8> {
  return stringToBytes(__symbol);
}
const __version = '2.0.0';
export function version(_: StaticArray<u8>): StaticArray<u8> {
  return stringToBytes(__version);
}

const __decimals: u8 = 18;
export function decimals(_: StaticArray<u8>): StaticArray<u8> {
  return u8toByte(__decimals);
}

export function setTeam(bs: StaticArray<u8>): void {
  const _team = new Address(new Args(bs).nextString().unwrap());
  if (Context.caller().toString() != team()) assert(false, 'NotTeam');
  if (_team == zeroAddress) assert(false, 'ZeroAddress');
  Storage.set(__team, _team.toString());
}

export function setArtProxy(_proxy: Address): void {
  if (Context.caller().toString() != team()) assert(false, 'NotTeam');
  Storage.set(__artProxy, _proxy.toString());
  BatchMetadataUpdate(0, u64.MAX_VALUE);
}

/// @inheritdoc IVotingEscrow
export function tokenURI(bs: StaticArray<u8>): StaticArray<u8> {
  const _tokenId = new Args(bs).nextU64().unwrap();
  if (_ownerOf(_tokenId) == zeroAddress) assert(false, 'NonExistentToken');
  return stringToBytes('');
  // return IVeArtProxy(artProxy).tokenURI(_tokenId);
}

/*//////////////////////////////////////////////////////////////
                      ERC721 BALANCE/OWNER STORAGE
//////////////////////////////////////////////////////////////*/

/// @dev Mapping from NFT ID to the address that owns it.
const idToOwner = new PersistentMap<u64, Address>('idToOwner');

/// @dev Mapping from owner address to count of his tokens.
const ownerToNFTokenCount = new PersistentMap<Address, u64>(
  'ownerToNFTokenCount',
);

function _ownerOf(_tokenId: u64): Address {
  return idToOwner.get(_tokenId, zeroAddress);
}

/// @inheritdoc IVotingEscrow
export function ownerOf(bs: StaticArray<u8>): StaticArray<u8> {
  const _tokenId = new Args(bs).nextU64().unwrap();
  return stringToBytes(_ownerOf(_tokenId).toString());
}

/// @inheritdoc IVotingEscrow
export function balanceOf(bs: StaticArray<u8>): StaticArray<u8> {
  const _owner = new Address(new Args(bs).nextString().unwrap());
  return u64ToBytes(ownerToNFTokenCount.get(_owner, 0));
}

/*//////////////////////////////////////////////////////////////
                         ERC721 APPROVAL STORAGE
//////////////////////////////////////////////////////////////*/

/// @dev Mapping from NFT ID to approved address.
const idToApprovals = new PersistentMap<u64, Address>('idToApprovals');

/// @dev Mapping from owner address to mapping of operator addresses.
/// @dev key is combined address and address
const ownerToOperators = new PersistentMap<string, bool>('ownerToOperators');

const ownershipChange = new PersistentMap<u64, u64>('ownershipChange');

/// @inheritdoc IVotingEscrow
export function getApproved(bs: StaticArray<u8>): StaticArray<u8> {
  const _tokenId = new Args(bs).nextU64().unwrap();
  return stringToBytes(idToApprovals.get(_tokenId, zeroAddress).toString());
}

/// @inheritdoc IVotingEscrow
export function isApprovedForAll(bs: StaticArray<u8>): StaticArray<u8> {
  const args = new Args(bs);
  const _owner = new Address(args.nextString().unwrap());
  const _operator = new Address(args.nextString().unwrap());
  return boolToByte(_isApprovedForAll(_owner, _operator));
}

function _isApprovedForAll(_owner: Address, _operator: Address): bool {
  return ownerToOperators.get(_owner.toString() + _operator.toString(), false);
}

/// @inheritdoc IVotingEscrow
export function isApprovedOrOwner(bs: StaticArray<u8>): StaticArray<u8> {
  const args = new Args(bs);
  const _spender = new Address(args.nextString().unwrap());
  const _tokenId = args.nextU64().unwrap();
  return boolToByte(_isApprovedOrOwner(_spender, _tokenId));
}

function _isApprovedOrOwner(_spender: Address, _tokenId: u64): bool {
  const owner = _ownerOf(_tokenId);
  const spenderIsOwner = owner == _spender;
  const spenderIsApproved =
    _spender == idToApprovals.get(_tokenId, zeroAddress);
  const spenderIsApprovedForAll = _isApprovedForAll(owner, _spender);
  return spenderIsOwner || spenderIsApproved || spenderIsApprovedForAll;
}

/*//////////////////////////////////////////////////////////////
                              ERC721 LOGIC
//////////////////////////////////////////////////////////////*/

/// @inheritdoc IVotingEscrow
export function approve(bs: StaticArray<u8>): void {
  const args = new Args(bs);
  const _approved = new Address(args.nextString().unwrap());
  const _tokenId = args.nextU64().unwrap();
  const sender = Context.caller();
  const owner = _ownerOf(_tokenId);
  // Throws if `_tokenId` is not a valid NFT
  if (owner == zeroAddress) assert(false, 'ZeroAddress');
  // Throws if `_approved` is the current owner
  if (owner == _approved) assert(false, 'SameAddress');
  // Check requirements
  const senderIsOwner = _ownerOf(_tokenId) == sender;
  const senderIsApprovedForAll = _isApprovedForAll(owner, sender);
  if (!senderIsOwner && !senderIsApprovedForAll)
    assert(false, 'NotApprovedOrOwner');
  // Set the approval
  idToApprovals.set(_tokenId, _approved);
  Approval(owner, _approved, _tokenId);
}

/// @inheritdoc IVotingEscrow
export function setApprovalForAll(bs: StaticArray<u8>): void {
  const args = new Args(bs);
  const _operator = new Address(args.nextString().unwrap());
  const _approved = args.nextBool().unwrap();
  const sender = Context.caller();
  // Throws if `_operator` is the `msg.sender`
  if (_operator == sender) assert(false, 'SameAddress');
  ownerToOperators.set(sender.toString() + _operator.toString(), _approved);
  ApprovalForAll(sender, _operator, _approved);
}

/* TRANSFER export FUNCTIONS */

function _transferFrom(
  _from: Address,
  _to: Address,
  _tokenId: u64,
  _sender: Address,
): void {
  // Check requirements
  if (!_isApprovedOrOwner(_sender, _tokenId))
    assert(false, 'NotApprovedOrOwner');
  // Clear approval. Throws if `_from` is not the current owner
  if (_ownerOf(_tokenId) != _from) assert(false, 'NotOwner');
  if (idToApprovals.contains(_tokenId)) idToApprovals.delete(_tokenId);
  // Remove NFT. Throws if `_tokenId` is not a valid NFT
  _removeTokenFrom(_from, _tokenId);
  // Update voting checkpoints
  _checkpointDelegator(_tokenId, 0, _to);
  // Add NFT
  _addTokenTo(_to, _tokenId);
  // Set the block of ownership transfer (for Flash NFT protection)
  ownershipChange.set(_tokenId, Context.currentPeriod());
  // Log the transfer
  Transfer(_from, _to, _tokenId);
}

/// @inheritdoc IVotingEscrow
export function transferFrom(bs: StaticArray<u8>): void {
  const args = new Args(bs);
  const _from = new Address(args.nextString().unwrap());
  const _to = new Address(args.nextString().unwrap());
  const _tokenId = args.nextU64().unwrap();
  _transferFrom(_from, _to, _tokenId, Context.caller());
}

/// @inheritdoc IVotingEscrow
// export function safeTransferFrom( _from: Address,  _to: Address,  _tokenId: u64): void {
//     safeTransferFrom(_from, _to, _tokenId, "");
// }

/// @inheritdoc IVotingEscrow
export function safeTransferFrom(bs: StaticArray<u8>): void {
  const args = new Args(bs);
  const _from = new Address(args.nextString().unwrap());
  const _to = new Address(args.nextString().unwrap());
  const _tokenId = args.nextU64().unwrap();
  const _data = args.nextBytes().unwrap();
  const sender = Context.caller();
  _transferFrom(_from, _to, _tokenId, sender);

  if (!isAddressEoa(_to.toString())) {
    // Throws if transfer destination is a contract which does not implement 'onERC721Received'
    // TODO:
    // const response = new IERC721Receiver(_to).onERC721Received(
    //   sender,
    //   _from,
    //   _tokenId,
    //   _data,
    // );
    // if (response != new IERC721Receiver(_to).onERC721Received.selector) {
    //   assert(false, 'ERC721ReceiverRejectedTokens');
  }
}

/*//////////////////////////////////////////////////////////////
                        INTERNAL MINT/BURN LOGIC
//////////////////////////////////////////////////////////////*/

/// @inheritdoc IVotingEscrow
/// @dev key is combined address and tokenId
const ownerToNFTokenIdList = new PersistentMap<string, u64>(
  'ownerToNFTokenIdList',
);
function ownerToNFTokenIdListKey(owner: Address, count: u64): string {
  return [owner.toString(), count.toString()].join(argsDelimiter);
}

/// @dev Mapping from NFT ID to index of owner
const tokenToOwnerIndex = new PersistentMap<u64, u64>('tokenToOwnerIndex');

/// @dev Add a NFT to an index mapping to a given address
/// @param _to address of the receiver
/// @param _tokenId uint ID Of the token to be added
function _addTokenToOwnerList(_to: Address, _tokenId: u64): void {
  const currentCount = ownerToNFTokenCount.get(_to, 0);

  const key = ownerToNFTokenIdListKey(_to, currentCount);
  ownerToNFTokenIdList.set(key, _tokenId);
  tokenToOwnerIndex.set(_tokenId, currentCount);
}

/// @dev Add a NFT to a given address
///      Throws if `_tokenId` is owned by someone.
function _addTokenTo(_to: Address, _tokenId: u64): void {
  // Throws if `_tokenId` is owned by someone
  assert(_ownerOf(_tokenId) == zeroAddress, 'ZeroAddress');
  // Change the owner
  idToOwner.set(_tokenId, _to);
  // Update owner token index tracking
  _addTokenToOwnerList(_to, _tokenId);
  // Change count tracking
  ownerToNFTokenCount.set(_to, ownerToNFTokenCount.get(_to, 0) + 1);
}

/**
 * @dev Function to mint tokens
 * Throws if `_to` is zero address.
 * Throws if `_tokenId` is owned by someone.
 * @param _to - The address that will receive the minted tokens.
 * @param _tokenId - The token id to mint.
 * @returns bool that indicates if the operation was successful.
 */
function _mint(_to: Address, _tokenId: u64): bool {
  // Throws if `_to` is zero address
  assert(_to != zeroAddress, 'ZeroAddress');
  // Add NFT. Throws if `_tokenId` is owned by someone
  _addTokenTo(_to, _tokenId);
  // Update voting checkpoints
  _checkpointDelegator(_tokenId, 0, _to);
  Transfer(zeroAddress, _to, _tokenId);
  return true;
}

/// @dev Remove a NFT from an index mapping to a given address
/// @param _from address of the sender
/// @param _tokenId uint ID Of the token to be removed
function _removeTokenFromOwnerList(_from: Address, _tokenId: u64): void {
  // Delete
  const currentCount = SafeMath.sub(ownerToNFTokenCount.get(_from, 0), 1);
  const currentIndex = tokenToOwnerIndex.getSome(_tokenId);

  const key1 = ownerToNFTokenIdListKey(_from, currentCount);
  const key2 = ownerToNFTokenIdListKey(_from, currentIndex);
  if (currentCount == currentIndex) {
    // update ownerToNFTokenIdList
    ownerToNFTokenIdList.set(key1, 0);
    // update tokenToOwnerIndex
    tokenToOwnerIndex.set(_tokenId, 0);
  } else {
    const lastTokenId = ownerToNFTokenIdList.get(key1, 0);

    // Add
    // update ownerToNFTokenIdList
    ownerToNFTokenIdList.set(key2, lastTokenId);
    // update tokenToOwnerIndex
    tokenToOwnerIndex.set(lastTokenId, currentIndex);

    // Delete
    // update ownerToNFTokenIdList
    ownerToNFTokenIdList.set(key1, 0);
    // update tokenToOwnerIndex
    tokenToOwnerIndex.set(_tokenId, 0);
  }
}

/// @dev Remove a NFT from a given address
///      Throws if `_from` is not the current owner.
function _removeTokenFrom(_from: Address, _tokenId: u64): void {
  // Throws if `_from` is not the current owner
  assert(_ownerOf(_tokenId) == _from, 'NotOwner');
  // Change the owner
  idToOwner.set(_tokenId, zeroAddress);
  // Update owner token index tracking
  _removeTokenFromOwnerList(_from, _tokenId);
  // Change count tracking
  ownerToNFTokenCount.set(_from, ownerToNFTokenCount.get(_from, 0) - 1);
}

/// @dev Must be called prior to updating `LockedBalance`
function _burn(_tokenId: u64): void {
  const sender = Context.caller();
  if (!_isApprovedOrOwner(sender, _tokenId))
    assert(false, 'NotApprovedOrOwner');
  const owner = _ownerOf(_tokenId);

  // Clear approval
  if (idToApprovals.contains(_tokenId)) idToApprovals.delete(_tokenId);
  // Update voting checkpoints
  _checkpointDelegator(_tokenId, 0, zeroAddress);
  // Remove token
  _removeTokenFrom(owner, _tokenId);
  Transfer(owner, zeroAddress, _tokenId);
}

/*//////////////////////////////////////////////////////////////
                             ESCROW STORAGE
//////////////////////////////////////////////////////////////*/

const MAXTIME: u64 = 4 * 365 * DAY;
const iMAXTIME: i64 = 4 * 365 * DAY;
const MULTIPLIER: u64 = 1 * 10 ** 9;

/// @inheritdoc IVotingEscrow
const __epoch = stringToBytes('epoch');
function epoch(): u64 {
  return bytesToU64(Storage.get(__epoch));
}
/// @inheritdoc IVotingEscrow
const __supply = stringToBytes('supply');
function supply(): u256 {
  return bytesToU256(Storage.get(__supply));
}

/// @inheritdoc IVotingEscrow
const __permanentLockBalance = stringToBytes('permanentLockBalance');
function permanentLockBalance(): u256 {
  return bytesToU256(Storage.get(__permanentLockBalance));
}

/// @inheritdoc IVotingEscrow
export function locked(bs: StaticArray<u8>): StaticArray<u8> {
  const _tokenId = new Args(bs).nextU64().unwrap();
  return _locked.get(_tokenId, new LockedBalance()).serialize();
}

/// @inheritdoc IVotingEscrow
export function userPointHistory(bs: StaticArray<u8>): StaticArray<u8> {
  const args = new Args(bs);
  const _tokenId = args.nextU64().unwrap();
  const _loc = args.nextU64().unwrap();
  const key = userPointHistoryKey(_tokenId, _loc);
  return _userPointHistory.get(key, new UserPoint()).serialize();
}

/// @inheritdoc IVotingEscrow
export function pointHistory(bs: StaticArray<u8>): StaticArray<u8> {
  const _loc = new Args(bs).nextU64().unwrap();
  return _pointHistory.get(_loc, new GlobalPoint()).serialize();
}

/*//////////////////////////////////////////////////////////////
                              ESCROW LOGIC
//////////////////////////////////////////////////////////////*/

/// @notice Record global and per-user data to checkpoints. Used by VotingEscrow system.
/// @param _tokenId NFT token ID. No user checkpoint if 0
/// @param _oldLocked Previous locked amount / end lock time for the user
/// @param _newLocked New locked amount / end lock time for the user
function _checkpoint(
  _tokenId: u64,
  _oldLocked: LockedBalance,
  _newLocked: LockedBalance,
): void {
  let uOld = new UserPoint();
  let uNew = new UserPoint();
  let oldDslope = i128.Zero;
  let newDslope = i128.Zero;
  let _epoch = epoch();
  const _timestamp = Context.timestamp();

  if (_tokenId != 0) {
    uNew.permanent = _newLocked.isPermanent
      ? u256.from(_newLocked.amount)
      : u256.Zero;
    // Calculate slopes and biases
    // Kept at zero when they have to
    if (_oldLocked.end > _timestamp && _oldLocked.amount > i128.Zero) {
      // @ts-ignore
      uOld.slope = i128.div(_oldLocked.amount, i128.from(iMAXTIME));
      // @ts-ignore
      uOld.bias = uOld.slope * i128.from(_oldLocked.end - _timestamp);
    }
    if (_newLocked.end > _timestamp && _newLocked.amount > i128.Zero) {
      // @ts-ignore
      uNew.slope = i128.div(_newLocked.amount, i128.from(iMAXTIME));
      // @ts-ignore
      uNew.bias = uNew.slope * i128.from(_newLocked.end - _timestamp);
    }

    // Read values of scheduled changes in the slope
    // _oldLocked.end can be in the past and in the future
    // _newLocked.end can ONLY by in the FUTURE unless everything expired: than zeros
    oldDslope = slopeChanges.get(_oldLocked.end, i128.Zero);
    if (_newLocked.end != 0) {
      if (_newLocked.end == _oldLocked.end) newDslope = oldDslope;
      else newDslope = slopeChanges.get(_newLocked.end, i128.Zero);
    }
  }

  let lastPoint = new GlobalPoint();
  lastPoint.ts = _timestamp;
  lastPoint.blk = Context.currentPeriod();
  if (_epoch > 0) lastPoint = _pointHistory.get(_epoch, new GlobalPoint());

  let lastCheckpoint = lastPoint.ts;
  // initialLastPoint is used for extrapolation to calculate block number
  // (approximately, for *At methods) and save them
  // as we cannot figure that out exactly from inside the contract
  const initialLastPoint = new GlobalPoint(
    lastPoint.bias,
    lastPoint.slope,
    lastPoint.ts,
    lastPoint.blk,
    lastPoint.permanentLockBalance,
  );
  let blockSlope: u64 = 0; // dblock/dt
  if (_timestamp > lastPoint.ts) {
    blockSlope =
      (MULTIPLIER * (Context.currentPeriod() - lastPoint.blk)) /
      (_timestamp - lastPoint.ts);
  }
  // If last point is already recorded in this block, slope=0
  // But that's ok b/c we know the block in such case

  // Go over weeks to fill history and calculate what the current point is
  {
    let t_i = (lastCheckpoint / WEEK) * WEEK;
    for (let i = 0; i < 255; ++i) {
      // Hopefully it won't happen that this won't get used in 5 years!
      // If it does, users will be able to withdraw but vote weight will be broken
      t_i += WEEK; // Initial value of t_i is always larger than the ts of the last point
      let d_slope = i128.Zero;
      if (t_i > _timestamp) t_i = _timestamp;
      else d_slope = slopeChanges.get(t_i, i128.Zero);

      // @ts-ignore
      lastPoint.bias -= i128.mul(
        lastPoint.slope,
        i128.from(SafeMath.sub(t_i, lastCheckpoint)),
      );
      // @ts-ignore
      lastPoint.slope += d_slope;
      if (lastPoint.bias < i128.Zero) lastPoint.bias = i128.Zero; // This can happen
      if (lastPoint.slope < i128.Zero) lastPoint.slope = i128.Zero; // This cannot happen - just in case

      lastCheckpoint = t_i;
      lastPoint.ts = t_i;
      lastPoint.blk =
        (initialLastPoint.blk + blockSlope * (t_i - initialLastPoint.ts)) /
        MULTIPLIER;

      _epoch += 1;
      if (t_i == _timestamp) {
        lastPoint.blk = Context.currentPeriod();
        break;
      } else _pointHistory.set(_epoch, lastPoint);
    }
  }

  if (_tokenId != 0) {
    // If last point was in this block, the slope change has been applied already
    // But in such case we have 0 slope(s)
    // @ts-ignore
    lastPoint.slope += uNew.slope - uOld.slope;
    // @ts-ignore
    lastPoint.bias += uNew.bias - uOld.bias;
    if (lastPoint.slope < i128.Zero) lastPoint.slope = i128.Zero;
    if (lastPoint.bias < i128.Zero) lastPoint.bias = i128.Zero;

    lastPoint.permanentLockBalance = permanentLockBalance();
  }

  // If timestamp of last global point is the same, overwrite the last global point
  // Else record the new global point into history
  // Exclude epoch 0 (note: _epoch is always >= 1, see above)
  // Two possible outcomes:
  // Missing global checkpoints in prior weeks. In this case, _epoch = epoch + x, where x > 1
  // No missing global checkpoints, but timestamp != Context.timestamp(). Create new checkpoint.
  // No missing global checkpoints, but timestamp == Context.timestamp(). Overwrite last checkpoint.
  const k = SafeMath.sub(_epoch, 1);
  if (_epoch != 1 && _pointHistory.get(k, new GlobalPoint()).ts == _timestamp) {
    // _epoch = epoch + 1, so we do not increment epoch
    _pointHistory.set(k, lastPoint);
  } else {
    // more than one global point may have been written, so we update epoch
    Storage.set(__epoch, u64ToBytes(_epoch));
    _pointHistory.set(_epoch, lastPoint);
  }

  if (_tokenId != 0) {
    // Schedule the slope changes (slope is going down)
    // We subtract new_user_slope from [_newLocked.end]
    // and add old_user_slope to [_oldLocked.end]
    if (_oldLocked.end > _timestamp) {
      // oldDslope was <something> - uOld.slope, so we cancel that
      // @ts-ignore
      oldDslope += uOld.slope;
      if (_newLocked.end == _oldLocked.end)
        // @ts-ignore
        oldDslope -= uNew.slope; // It was a new deposit, not extension

      slopeChanges.set(_oldLocked.end, oldDslope);
    }

    if (_newLocked.end > _timestamp) {
      // update slope if new lock is greater than old lock and is not permanent or if old lock is permanent
      if (_newLocked.end > _oldLocked.end) {
        // @ts-ignore
        newDslope -= uNew.slope; // old slope disappeared at this point
        slopeChanges.set(_newLocked.end, newDslope);
      }
      // else: we recorded it already in oldDslope
    }
    // If timestamp of last user point is the same, overwrite the last user point
    // Else record the new user point into history
    // Exclude epoch 0
    uNew.ts = _timestamp;
    uNew.blk = Context.currentPeriod();
    let userEpoch = userPointEpoch.get(_tokenId, 0);
    const pointHistoryKey = userPointHistoryKey(_tokenId, userEpoch);
    if (
      userEpoch != 0 &&
      _userPointHistory.get(pointHistoryKey, new UserPoint()).ts == _timestamp
    )
      _userPointHistory.set(pointHistoryKey, uNew);
    else {
      userEpoch += 1;
      userPointEpoch.set(_tokenId, userEpoch);
      const newKey = userPointHistoryKey(_tokenId, userEpoch);
      _userPointHistory.set(newKey, uNew);
    }
  }
}

/// @notice Deposit and lock tokens for a user
/// @param _tokenId NFT that holds lock
/// @param _value Amount to deposit
/// @param _unlockTime New time when to unlock the tokens, or 0 if unchanged
/// @param _oldLocked Previous locked amount / timestamp
/// @param _depositType The type of deposit
function _depositFor(
  _tokenId: u64,
  _value: u256,
  _unlockTime: u64,
  _oldLocked: LockedBalance,
  _depositType: DepositType,
): void {
  let supplyBefore = supply();
  Storage.set(__supply, u256ToBytes(SafeMath256.add(supplyBefore, _value)));

  const newLocked = new LockedBalance();
  newLocked.amount = _oldLocked.amount;
  newLocked.end = _oldLocked.end;
  newLocked.isPermanent = _oldLocked.isPermanent;

  // Adding to existing lock, or if a lock is expired - creating a new one
  // @ts-ignore
  newLocked.amount = newLocked.amount + _value.toI128();
  if (_unlockTime != 0) newLocked.end = _unlockTime;

  _locked.set(_tokenId, newLocked);

  // Possibilities:
  // Both _oldLocked.end could be current or expired (>/< Context.timestamp())
  // or if the lock is a permanent lock, then _oldLocked.end == 0
  // value == 0 (extend lock) or value > 0 (add to lock or extend lock)
  // newLocked.end > Context.timestamp() (always)
  _checkpoint(_tokenId, _oldLocked, newLocked);

  const from = Context.caller();
  if (_value != u256.Zero) {
    new IERC20(new Address(token())).transferFrom(
      from,
      Context.callee(),
      _value,
    );
  }

  Deposit(
    from,
    _tokenId,
    _depositType,
    _value,
    newLocked.end,
    Context.timestamp(),
  );
  // @ts-ignore
  Supply(supplyBefore, supplyBefore + _value);
}

/// @inheritdoc IVotingEscrow
export function checkpoint(_: StaticArray<u8>): void {
  ReentrancyGuardUpgradeable.nonReentrant();
  _checkpoint(0, new LockedBalance(), new LockedBalance());
  ReentrancyGuardUpgradeable.endNonReentrant();
}

/// @inheritdoc IVotingEscrow
export function depositFor(bs: StaticArray<u8>): void {
  ReentrancyGuardUpgradeable.nonReentrant();
  const args = new Args(bs);
  const _tokenId = args.nextU64().unwrap();
  const _value = args.nextU256().unwrap();

  _increaseAmountFor(_tokenId, _value, DepositType.DEPOSIT_FOR_TYPE);
  ReentrancyGuardUpgradeable.endNonReentrant();
}

/** @dev Deposit `_value` tokens for `_to` and lock for `_lockDuration`
 * @param _value Amount to deposit
 * @param _lockDuration Number of seconds to lock tokens for (rounded down to nearest week)
 * @param _to Address to deposit
 */
function _createLock(_value: u256, _lockDuration: u64, _to: Address): u64 {
  const _timestamp = Context.timestamp();
  const unlockTimestampRaw = SafeMath.add(_timestamp, _lockDuration);
  const unlockTime = (unlockTimestampRaw / WEEK) * WEEK; // Locktime is rounded down to weeks

  if (_value == u256.Zero) assert(false, 'ZeroAmount');
  if (unlockTime <= _timestamp) assert(false, 'LockDurationNotInFuture');
  if (unlockTime > _timestamp + MAXTIME) assert(false, 'LockDurationTooLong');

  let _tokenId = tokenId() + 1;
  Storage.set(__tokenId, u64ToBytes(_tokenId));
  _mint(_to, _tokenId);

  _depositFor(
    _tokenId,
    _value,
    unlockTime,
    new LockedBalance(),
    DepositType.CREATE_LOCK_TYPE,
  );
  return _tokenId;
}

/// @inheritdoc IVotingEscrow
export function createLock(bs: StaticArray<u8>): StaticArray<u8> {
  ReentrancyGuardUpgradeable.nonReentrant();
  const args = new Args(bs);
  const _value = args.nextU256().unwrap();
  const _lockDuration = args.nextU64().unwrap();
  const tokenId = _createLock(_value, _lockDuration, Context.caller());
  ReentrancyGuardUpgradeable.endNonReentrant();
  return u64ToBytes(tokenId);
}

/// @inheritdoc IVotingEscrow
export function createLockFor(bs: StaticArray<u8>): StaticArray<u8> {
  ReentrancyGuardUpgradeable.nonReentrant();
  const args = new Args(bs);
  const _value = args.nextU256().unwrap();
  const _lockDuration = args.nextU64().unwrap();
  const _to = new Address(args.nextString().unwrap());
  const tokenId = _createLock(_value, _lockDuration, _to);
  ReentrancyGuardUpgradeable.endNonReentrant();
  return u64ToBytes(tokenId);
}

function _increaseAmountFor(
  _tokenId: u64,
  _value: u256,
  _depositType: DepositType,
): void {
  const oldLocked = _locked.get(_tokenId, new LockedBalance());

  if (_value == u256.Zero) assert(false, 'ZeroAmount');
  if (u256.from(oldLocked.amount) <= u256.Zero) assert(false, 'NoLockFound');
  if (oldLocked.end <= Context.timestamp() && !oldLocked.isPermanent)
    assert(false, 'LockExpired');

  // @ts-ignore
  if (oldLocked.isPermanent)
    // @ts-ignore
    Storage.set(
      __permanentLockBalance,
      u256ToBytes(permanentLockBalance() + _value),
    );
  _checkpointDelegatee(_delegates.get(_tokenId, 0), _value, true);
  _depositFor(_tokenId, _value, 0, oldLocked, _depositType);

  MetadataUpdate(_tokenId);
}

/// @inheritdoc IVotingEscrow
export function increaseAmount(bs: StaticArray<u8>): void {
  ReentrancyGuardUpgradeable.nonReentrant();
  const args = new Args(bs);
  const _tokenId = args.nextU64().unwrap();
  const _value = args.nextU256().unwrap();
  if (!_isApprovedOrOwner(Context.caller(), _tokenId))
    assert(false, 'NotApprovedOrOwner');
  _increaseAmountFor(_tokenId, _value, DepositType.INCREASE_LOCK_AMOUNT);
  ReentrancyGuardUpgradeable.endNonReentrant();
}

/// @inheritdoc IVotingEscrow
export function increaseUnlockTime(bs: StaticArray<u8>): void {
  ReentrancyGuardUpgradeable.nonReentrant();
  const args = new Args(bs);
  const _tokenId = args.nextU64().unwrap();
  const _lockDuration = args.nextU64().unwrap();
  if (!_isApprovedOrOwner(Context.caller(), _tokenId))
    assert(false, 'NotApprovedOrOwner');

  const oldLocked = _locked.get(_tokenId, new LockedBalance());
  if (oldLocked.isPermanent) assert(false, 'PermanentLock');

  const _timestamp = Context.timestamp();
  const left = SafeMath.add(_timestamp, _lockDuration);
  const unlockTime = (left / WEEK) * WEEK; // Locktime is rounded down to weeks

  if (oldLocked.end <= _timestamp) assert(false, 'LockExpired');
  if (oldLocked.amount <= i128.Zero) assert(false, 'NoLockFound');
  if (unlockTime <= oldLocked.end) assert(false, 'LockDurationNotInFuture');
  if (unlockTime > _timestamp + MAXTIME) assert(false, 'LockDurationTooLong');

  _depositFor(
    _tokenId,
    u256.Zero,
    unlockTime,
    oldLocked,
    DepositType.INCREASE_UNLOCK_TIME,
  );

  MetadataUpdate(_tokenId);

  ReentrancyGuardUpgradeable.endNonReentrant();
}

/// @inheritdoc IVotingEscrow
export function withdraw(bs: StaticArray<u8>): void {
  ReentrancyGuardUpgradeable.nonReentrant();
  const _tokenId = new Args(bs).nextU64().unwrap();
  const sender = Context.caller();
  if (!_isApprovedOrOwner(sender, _tokenId))
    assert(false, 'NotApprovedOrOwner');
  if (voted.get(_tokenId, false)) assert(false, 'AlreadyVoted');

  const oldLocked = _locked.get(_tokenId, new LockedBalance());
  if (oldLocked.isPermanent) assert(false, 'PermanentLock');
  if (Context.timestamp() < oldLocked.end) assert(false, 'LockNotExpired');
  const value = u256.from(oldLocked.amount);

  // Burn the NFT
  _burn(_tokenId);
  _locked.set(_tokenId, new LockedBalance());
  const supplyBefore = supply();
  // @ts-ignore
  Storage.set(__supply, u256ToBytes(supplyBefore - value));

  // oldLocked can have either expired <= timestamp or zero end
  // oldLocked has only 0 end
  // Both can have >= 0 amount
  _checkpoint(_tokenId, oldLocked, new LockedBalance());

  new IERC20(new Address(token())).transfer(sender, value);

  Withdraw(sender, _tokenId, value, Context.timestamp());
  Supply(supplyBefore, supply());

  ReentrancyGuardUpgradeable.endNonReentrant();
}

/// @inheritdoc IVotingEscrow
export function lockPermanent(bs: StaticArray<u8>): void {
  const _tokenId = new Args(bs).nextU64().unwrap();
  const sender = Context.caller();
  if (!_isApprovedOrOwner(sender, _tokenId))
    assert(false, 'NotApprovedOrOwner');
  const _newLocked = _locked.get(_tokenId, new LockedBalance());
  if (_newLocked.isPermanent) assert(false, 'PermanentLock');
  if (_newLocked.end <= Context.timestamp()) assert(false, 'LockExpired');
  if (_newLocked.amount <= i128.Zero) assert(false, 'NoLockFound');

  const _amount = u256.from(_newLocked.amount);
  Storage.set(
    __permanentLockBalance,
    // @ts-ignore
    u256ToBytes(permanentLockBalance() + _amount),
  );
  _newLocked.end = 0;
  _newLocked.isPermanent = true;
  _checkpoint(_tokenId, _locked.get(_tokenId, new LockedBalance()), _newLocked);
  _locked.set(_tokenId, _newLocked);

  LockPermanent(sender, _tokenId, _amount, Context.timestamp());
  MetadataUpdate(_tokenId);
}

/// @inheritdoc IVotingEscrow
export function unlockPermanent(bs: StaticArray<u8>): void {
  const _tokenId = new Args(bs).nextU64().unwrap();
  const sender = Context.caller();
  if (!_isApprovedOrOwner(sender, _tokenId))
    assert(false, 'NotApprovedOrOwner');
  if (voted.get(_tokenId, false)) assert(false, 'AlreadyVoted');
  const _newLocked = _locked.get(_tokenId, new LockedBalance());
  if (!_newLocked.isPermanent) assert(false, 'NotPermanentLock');

  const _amount = u256.from(_newLocked.amount);
  Storage.set(
    __permanentLockBalance,
    // @ts-ignore
    u256ToBytes(permanentLockBalance() - _amount),
  );

  _newLocked.end = ((Context.timestamp() + MAXTIME) / WEEK) * WEEK;
  _newLocked.isPermanent = false;
  _delegate(_tokenId, 0);
  _checkpoint(_tokenId, _locked.get(_tokenId, new LockedBalance()), _newLocked);
  _locked.set(_tokenId, _newLocked);

  UnlockPermanent(sender, _tokenId, _amount, Context.timestamp());
  MetadataUpdate(_tokenId);
}

/*///////////////////////////////////////////////////////////////
                           GAUGE VOTING STORAGE
//////////////////////////////////////////////////////////////*/

function _balanceOfNFTAt(_tokenId: u64, _t: u64): u256 {
  return BalanceLogicLibrary.balanceOfNFTAt(_tokenId, _t);
}

function _supplyAt(_timestamp: u64): u256 {
  return BalanceLogicLibrary.supplyAt(epoch(), _timestamp);
}

/// @inheritdoc IVotingEscrow
export function balanceOfNFT(bs: StaticArray<u8>): StaticArray<u8> {
  const _tokenId = new Args(bs).nextU64().unwrap();
  if (ownershipChange.get(_tokenId, 0) == Context.currentPeriod())
    return u256ToBytes(u256.Zero);
  return u256ToBytes(_balanceOfNFTAt(_tokenId, Context.timestamp()));
}

/// @inheritdoc IVotingEscrow
export function balanceOfNFTAt(bs: StaticArray<u8>): StaticArray<u8> {
  const args = new Args(bs);
  const _tokenId = args.nextU64().unwrap();
  const _t = args.nextU64().unwrap();
  return u256ToBytes(_balanceOfNFTAt(_tokenId, _t));
}

/// @inheritdoc IVotingEscrow
export function totalSupply(_: StaticArray<u8>): StaticArray<u8> {
  return u256ToBytes(_supplyAt(Context.timestamp()));
}

/// @inheritdoc IVotingEscrow
export function totalSupplyAt(bs: StaticArray<u8>): StaticArray<u8> {
  const _timestamp = new Args(bs).nextU64().unwrap();
  return u256ToBytes(_supplyAt(_timestamp));
}

/*///////////////////////////////////////////////////////////////
                            GAUGE VOTING LOGIC
//////////////////////////////////////////////////////////////*/

/// @inheritdoc IVotingEscrow
const voted = new PersistentMap<u64, bool>('voted');

/// @inheritdoc IVotingEscrow
export function setVoter(bs: StaticArray<u8>): void {
  const args = new Args(bs);
  const _voter = new Address(args.nextString().unwrap());
  if (Context.caller().toString() != team()) assert(false, 'NotVoter');
  Storage.set(__voter, _voter.toString());
}

/// @inheritdoc IVotingEscrow
export function voting(bs: StaticArray<u8>): void {
  const args = new Args(bs);
  const _tokenId = args.nextU64().unwrap();
  const _voted = args.nextBool().unwrap();
  if (Context.caller().toString() != voter()) assert(false, 'NotVoter');
  voted.set(_tokenId, _voted);
}

/*///////////////////////////////////////////////////////////////
                            DAO VOTING STORAGE
//////////////////////////////////////////////////////////////*/

/// @notice The EIP-712 typehash for the contract's domain
function DOMAIN_TYPEHASH(): StaticArray<u8> {
  return keccak256(
    stringToBytes(
      'EIP712Domain(string name,u256 chainId,address verifyingContract)',
    ),
  );
}

/// @notice The EIP-712 typehash for the delegation struct used by the contract
function DELEGATION_TYPEHASH(): StaticArray<u8> {
  return keccak256(
    stringToBytes(
      'Delegation(u256 delegator,u256 delegatee,u256 nonce,u256 expiry)',
    ),
  );
}

/// @inheritdoc IVotingEscrow
export function delegates(bs: StaticArray<u8>): StaticArray<u8> {
  const delegator = new Args(bs).nextU64().unwrap();
  return u64ToBytes(_delegates.get(delegator, 0));
}

/// @inheritdoc IVotingEscrow
export function checkpoints(bs: StaticArray<u8>): StaticArray<u8> {
  const args = new Args(bs);
  const _tokenId = args.nextU64().unwrap();
  const _index = args.nextU64().unwrap();
  const key = checkpointKey(_tokenId, _index);
  return _checkpoints.get(key, new Checkpoint()).serialize();
}

/// @inheritdoc IVotingEscrow
export function getPastVotes(bs: StaticArray<u8>): StaticArray<u8> {
  const args = new Args(bs);
  const _account = new Address(args.nextString().unwrap());
  const _tokenId = args.nextU64().unwrap();
  const _timestamp = args.nextU64().unwrap();
  return u256ToBytes(
    DelegationLogicLibrary.getPastVotes(_account, _tokenId, _timestamp),
  );
}

/*///////////////////////////////////////////////////////////////
                             DAO VOTING LOGIC
//////////////////////////////////////////////////////////////*/

function _checkpointDelegator(
  _delegator: u64,
  _delegatee: u64,
  _owner: Address,
): void {
  DelegationLogicLibrary.checkpointDelegator(_delegator, _delegatee, _owner);
}

function _checkpointDelegatee(
  _delegatee: u64,
  balance_: u256,
  _increase: bool,
): void {
  DelegationLogicLibrary.checkpointDelegatee(_delegatee, balance_, _increase);
}

/// @notice Record user delegation checkpoints. Used by voting system.
/// @dev Skips delegation if already delegated to `delegatee`.
function _delegate(_delegator: u64, _delegatee: u64): void {
  let delegateLocked = _locked.get(_delegator, new LockedBalance());
  if (!delegateLocked.isPermanent) assert(false, 'NotPermanentLock');
  if (_delegatee != 0 && _ownerOf(_delegatee) == zeroAddress)
    assert(false, 'NonExistentToken');
  if (ownershipChange.get(_delegator, 0) == Context.currentPeriod())
    assert(false, 'OwnershipChange');
  if (_delegatee == _delegator) _delegatee = 0;
  const currentDelegate = _delegates.get(_delegator, 0);
  if (currentDelegate == _delegatee) return;

  const delegatedBalance = u256.from(delegateLocked.amount);
  _checkpointDelegator(_delegator, _delegatee, _ownerOf(_delegator));
  _checkpointDelegatee(_delegatee, delegatedBalance, true);

  DelegateChanged(Context.caller(), currentDelegate, _delegatee);
}

/// @inheritdoc IVotingEscrow
export function delegate(bs: StaticArray<u8>): void {
  const args = new Args(bs);
  const delegator = args.nextU64().unwrap();
  const delegatee = args.nextU64().unwrap();
  if (!_isApprovedOrOwner(Context.caller(), delegator))
    assert(false, 'NotApprovedOrOwner');
  _delegate(delegator, delegatee);
}

/*//////////////////////////////////////////////////////////////
                              ERC6372 LOGIC
//////////////////////////////////////////////////////////////*/

/// @inheritdoc IVotingEscrow
export function clock(_: StaticArray<u8>): StaticArray<u8> {
  return u64ToBytes(Context.timestamp());
}

/// @inheritdoc IVotingEscrow
export function CLOCK_MODE(_: StaticArray<u8>): StaticArray<u8> {
  return stringToBytes('mode=timestamp');
}

/*//////////////////////////////////////////////////////////////
                              CUSTOM LOGIC
//////////////////////////////////////////////////////////////*/

export function getLocks(bs: StaticArray<u8>): StaticArray<u8> {
  const account = new Address(new Args(bs).nextString().unwrap());

  const res: GetLocksReturn[] = [];
  const accountIndex = ownerToNFTokenCount.get(account, 0);
  for (let i: u64 = 0; i < accountIndex; i++) {
    const key = ownerToNFTokenIdListKey(account, i);
    const tokenId = ownerToNFTokenIdList.getSome(key);
    const votingPower = _balanceOfNFTAt(tokenId, Context.timestamp());
    res.push(new GetLocksReturn(tokenId, votingPower));
  }
  return new Args().addSerializableObjectArray(res).serialize();
}
