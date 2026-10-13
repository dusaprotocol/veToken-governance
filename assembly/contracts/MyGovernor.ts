import {
  Args,
  Result,
  Serializable,
  byteToU8,
  bytesToU256,
  bytesToU32,
  stringToBytes,
  u256ToBytes,
  u32ToBytes,
  u8toByte,
} from '@massalabs/as-types';
import {
  Address,
  Context,
  Storage,
  createEvent,
  generateEvent,
} from '@massalabs/massa-as-sdk';
import { IERC20, PersistentMap } from '@dusalabs/core';
import {
  setOwner,
  onlyOwner,
} from '@massalabs/sc-standards/assembly/contracts/utils/ownership';
import { IVotingEscrow } from '../interfaces';
import { _locked } from '../libraries/Storage';
import { argsDelimiter, DAY, parseSlot } from '../utils';
import { LockedBalance } from '../libraries';
import { i128, u256 } from 'as-bignum/assembly/index';
import { _setOwner } from '@massalabs/sc-standards/assembly/contracts/utils/ownership-internal';

// STORAGE

class Proposal implements Serializable {
  constructor(
    public proposer: string = '',
    public title: string = '',
    public description: string = '',
    public startBlock: u64 = 0,
    public endBlock: u64 = 0,
    public forVotes: u256 = u256.Zero,
    public abstainVotes: u256 = u256.Zero,
    public againstVotes: u256 = u256.Zero,
  ) {}

  serialize(): StaticArray<u8> {
    return new Args()
      .add(this.proposer)
      .add(this.title)
      .add(this.description)
      .add(this.startBlock)
      .add(this.endBlock)
      .add(this.forVotes)
      .add(this.abstainVotes)
      .add(this.againstVotes)
      .serialize();
  }

  deserialize(data: StaticArray<u8>, offset: i32): Result<i32> {
    const args = new Args(data, offset);
    this.proposer = args.nextString().unwrap();
    this.title = args.nextString().unwrap();
    this.description = args.nextString().unwrap();
    this.startBlock = args.nextU64().unwrap();
    this.endBlock = args.nextU64().unwrap();
    this.forVotes = args.nextU256().unwrap();
    this.abstainVotes = args.nextU256().unwrap();
    this.againstVotes = args.nextU256().unwrap();
    return new Result(args.offset);
  }
}

export const PROPOSALS = new PersistentMap<u32, Proposal>('p');
export const PROPOSAL_COUNT = stringToBytes('PROPOSAL_COUNT');
export const VOTE_TOKEN = 'VOTE_TOKEN';
export const PAY_TOKEN = 'PAY_TOKEN';
export const COST_TO_PROPOSE = stringToBytes('COST_TO_PROPOSE');
export const QUORUM = stringToBytes('QUORUM');
/// @dev Receipts of ballots for the entire voting period
/// key is a combination of proposalId-lockId
export const HAS_VOTED = new PersistentMap<string, bool>('v');

// CONSTRUCTOR

export function constructor(bs: StaticArray<u8>): void {
  assert(Context.isDeployingContract(), 'already init');

  const args = new Args(bs);
  const voteToken = args.nextString().unwrap();
  const payToken = args.nextString().unwrap();

  Storage.set(VOTE_TOKEN, voteToken);
  Storage.set(PAY_TOKEN, payToken);
  const ONE_TOKEN: u256 = u256.from(u64(10 ** 18));
  Storage.set(
    COST_TO_PROPOSE,
    u256ToBytes(u256.mul(u256.from(1500), ONE_TOKEN)),
  );
  Storage.set(QUORUM, u8toByte(10)); // 10%
  Storage.set(PROPOSAL_COUNT, u32ToBytes(0));

  _setOwner(Context.transactionCreator().toString());
}

// OWNER

export function updateCostToPropose(bs: StaticArray<u8>): void {
  onlyOwner();

  const newCost = new Args(bs).nextU256().unwrap();
  Storage.set(COST_TO_PROPOSE, u256ToBytes(newCost));
}

export function updateQuorum(bs: StaticArray<u8>): void {
  onlyOwner();

  const newQuorum = new Args(bs).nextU8().unwrap();
  assert(newQuorum < 100, 'invalid quorum');
  Storage.set(QUORUM, u8toByte(newQuorum));
}

export function withdrawFees(bs: StaticArray<u8>): void {
  onlyOwner();

  payToken().transfer(Context.caller(), payToken().balanceOf(Context.callee()));
}

// PUBLIC

export function propose(bs: StaticArray<u8>): void {
  const cost = bytesToU256(Storage.get(COST_TO_PROPOSE));
  payToken().transferFrom(Context.caller(), Context.callee(), cost);

  const args = new Args(bs);
  const title = args.nextString().unwrap();
  const description = args.nextString().unwrap();
  const startBlock = Context.currentPeriod(); // args.nextU64().unwrap();
  const startTimestamp = Context.timestamp(); // parseSlot(0, startBlock);
  const endBlock = args.nextU64().unwrap();
  const endTimestamp = parseSlot(0, endBlock);
  const duration = endTimestamp - startTimestamp;
  // assert(startTimestamp > Context.now(), 'START_IN_PAST');
  assert(endTimestamp > startTimestamp, 'END_BEFORE_START');
  assert(duration >= 3 * DAY && duration <= 15 * DAY, 'INVALID_DURATION');

  const proposer = Context.caller().toString();
  const currProposalCount = proposalCount();
  const proposal = new Proposal(
    proposer,
    title,
    description,
    startBlock,
    endBlock,
  );
  PROPOSALS.set(currProposalCount, proposal);
  Storage.set(PROPOSAL_COUNT, u32ToBytes(currProposalCount + 1));

  const event = createEvent('PROPOSE', [
    currProposalCount.toString(),
    proposer,
  ]);
  generateEvent(event);
}

export function vote(bs: StaticArray<u8>): void {
  const args = new Args(bs);
  const proposalId = args.nextU32().unwrap();
  const support = args.nextU8().unwrap();
  const lockIds = args.nextFixedSizeArray<u64>().unwrap();
  assert(support < 3, 'INVALID_VOTE_TYPE');
  const proposal = PROPOSALS.get(proposalId, new Proposal());

  assert(proposal.startBlock <= Context.currentPeriod(), 'NOT STARTED');
  assert(proposal.endBlock >= Context.currentPeriod(), 'ENDED');

  const ve = voteToken();

  let totalVotingPower = u256.Zero;
  for (let i = 0; i < lockIds.length; i++) {
    const lockId = lockIds[i];
    assert(
      ve.isApprovedOrOwner(Context.caller(), lockId),
      'LOCK_NOT_OWNED: ' + lockId.toString(),
    );
    assert(
      !hasVoted(proposalId, lockId),
      'ALREADY_VOTED: ' + lockId.toString(),
    );
    const lock = _locked.getOf(
      ve._origin,
      lockId,
      new LockedBalance(i128.Zero, 0),
    );
    assert(
      lock.end === 0 || lock.end > parseSlot(0, proposal.endBlock),
      'LOCK_EXPIRES_TOO_SOON: ' + lockId.toString(),
    );
    HAS_VOTED.set(createHasVotedKey(proposalId, lockId), true);
    totalVotingPower += ve.balanceOfNFT(lockId);
  }

  const voter = Context.caller();
  //   const votes = voteToken().balanceOf(voter);
  //   const tokenDecimals = u64(voteToken().decimals());
  const _votingPower = totalVotingPower;
  if (support === 0) {
    proposal.forVotes += _votingPower;
  } else if (support === 1) {
    proposal.againstVotes += _votingPower;
  } else if (support === 2) {
    proposal.abstainVotes += _votingPower;
  }
  PROPOSALS.set(proposalId, proposal);

  const event = createEvent('VOTE', [
    proposalId.toString(),
    voter.toString(),
    support.toString(),
  ]);
  generateEvent(event);
}

// HELPERS

function createHasVotedKey(proposalId: u32, lockId: u64): string {
  return proposalId.toString() + argsDelimiter + lockId.toString();
}

function hasVoted(proposalId: u32, lockId: u64): bool {
  const key = createHasVotedKey(proposalId, lockId);
  return HAS_VOTED.contains(key) ? true : false;
}

function voteToken(): IVotingEscrow {
  return new IVotingEscrow(new Address(Storage.get(VOTE_TOKEN)));
}

function payToken(): IERC20 {
  return new IERC20(new Address(Storage.get(PAY_TOKEN)));
}

function proposalCount(): u32 {
  return bytesToU32(Storage.get(PROPOSAL_COUNT));
}

function votingPower(voter: Address): u256 {
  throw new Error('Not implemented');
}
