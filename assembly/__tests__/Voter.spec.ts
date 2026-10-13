import {
  Args,
  boolToByte,
  bytesToU256,
  stringToBytes,
  u256ToBytes,
} from '@massalabs/as-types';
import {
  Address,
  mockScCall,
  mockTimestamp,
  resetStorage,
  setDeployContext,
  Storage,
} from '@massalabs/massa-as-sdk';
import { u256 } from 'as-bignum/assembly/integer/u256';
import {
  constructor,
  poke,
  reset,
  vote,
  whitelistPool,
} from '../contracts/Voter';
import { PersistentMap } from '../libraries/persistentMap';
import { argsDelimiter, WEEK } from '../utils';

// Same prefixes as Voter.ts, to read its storage
const votes = new PersistentMap<string, u256>('votes');
const weights = new PersistentMap<Address, u256>('weights');
const usedWeights = new PersistentMap<u64, u256>('usedWeights');

const VE = 'AS12srBZgYYwPyb9CYbDs9XAmTG4TBzmMaDw8mkAmrETEj8ZeV5pV';
const POOL_A = new Address(
  'AS1MH6eJ4XGvw4Lsq7qS8UDjVzAgcHBSSTdc6z3odppM9Q134UzT',
);
const POOL_B = new Address(
  'AS1UxmVYxof8cKDhjjALpJTSY3ZWviV1NquZg4ovXU5ycrkpQogD',
);
const TOKEN_ID: u64 = 1;
const ONE_DUSA = u256.fromU64(1_000_000_000_000_000_000);

// a timestamp inside the voting window of an epoch (after the first hour)
const EPOCH = 2_900 * WEEK;
const IN_WINDOW = EPOCH + 2 * 60 * 60 * 1000;

function totalWeight(): u256 {
  return bytesToU256(Storage.get(stringToBytes('totalWeight')));
}

function voteKey(pool: Address): string {
  return TOKEN_ID.toString() + argsDelimiter + pool.toString();
}

/// Queue the veDUSA answers for one `vote` call:
/// isApprovedOrOwner, balanceOfNFT, voting(false) in _reset, voting(true)
function mockVeForVote(power: u256): void {
  mockScCall(boolToByte(true));
  mockScCall(u256ToBytes(power));
  mockScCall([]);
  mockScCall([]);
}

function voteArgs(pools: Address[], w: u256[]): StaticArray<u8> {
  return new Args()
    .add(TOKEN_ID)
    .addSerializableObjectArray(pools)
    .add(w)
    .serialize();
}

function whitelistArgs(pool: string, allowed: bool): StaticArray<u8> {
  return new Args().add(pool).add(allowed).serialize();
}

// AssemblyScript closures can't capture locals: arguments for toThrow() tests
let pendingVote: StaticArray<u8> = [];
function callPendingVote(): void {
  vote(pendingVote);
}
let pendingWhitelist: StaticArray<u8> = [];
function callPendingWhitelist(): void {
  whitelistPool(pendingWhitelist);
}
function callPoke(): void {
  poke(new Args().add(TOKEN_ID).serialize());
}

/// Fresh Voter, deployed by the default caller (the governor), both pools allowed
function deployVoter(): void {
  resetStorage();
  setDeployContext();
  constructor(new Args().add(VE).serialize());
  whitelistPool(whitelistArgs(POOL_A.toString(), true));
  whitelistPool(whitelistArgs(POOL_B.toString(), true));
  mockTimestamp(IN_WINDOW);
}

describe('Voter._vote', () => {
  beforeEach(() => {
    deployVoter();
  });

  test('splits the lock power pro rata to the weights', () => {
    mockVeForVote(ONE_DUSA);
    vote(voteArgs([POOL_A, POOL_B], [u256.fromU64(1), u256.fromU64(3)]));

    const quarter = u256.div(ONE_DUSA, u256.fromU64(4));
    expect(votes.getSome(voteKey(POOL_A))).toStrictEqual(quarter);
    expect(votes.getSome(voteKey(POOL_B))).toStrictEqual(
      u256.sub(ONE_DUSA, quarter),
    );
    expect(usedWeights.getSome(TOKEN_ID)).toStrictEqual(ONE_DUSA);
    expect(totalWeight()).toStrictEqual(ONE_DUSA);
  });

  test('a pool never gets more than the lock power', () => {
    mockVeForVote(ONE_DUSA);
    vote(voteArgs([POOL_A], [u256.fromU64(1_000_000_000)]));

    expect(votes.getSome(voteKey(POOL_A))).toStrictEqual(ONE_DUSA);
    expect(weights.getSome(POOL_A)).toStrictEqual(ONE_DUSA);
  });

  test('rejects weights whose sum overflows (forged vote, audit C-2)', () => {
    // a + b = 2^256 + 1: the sum wraps to 1 without SafeMath, and pool A
    // would be credited a × the lock power
    const a = u256.fromU64(1_000_000_000);
    // b = 2^256 + 1 - a = (2^256 - 1) - a + 2
    const b = u256.add(u256.sub(u256.Max, a), u256.fromU64(2));

    mockVeForVote(ONE_DUSA);
    pendingVote = voteArgs([POOL_A, POOL_B], [a, b]);
    expect(callPendingVote).toThrow();
  });

  test('rejects a weight whose product with the power overflows', () => {
    mockVeForVote(ONE_DUSA);
    pendingVote = voteArgs([POOL_A], [u256.Max]);
    expect(callPendingVote).toThrow();
  });

  test('rejects all-zero weights', () => {
    mockVeForVote(ONE_DUSA);
    pendingVote = voteArgs([POOL_A, POOL_B], [u256.Zero, u256.Zero]);
    expect(callPendingVote).toThrow();
  });

  test('reset removes the votes from the totals', () => {
    mockVeForVote(ONE_DUSA);
    vote(voteArgs([POOL_A, POOL_B], [u256.fromU64(1), u256.fromU64(1)]));

    // next epoch, inside the voting window
    mockTimestamp(IN_WINDOW + WEEK);
    mockScCall(boolToByte(true)); // isApprovedOrOwner
    mockScCall([]); // voting(false)
    reset(new Args().add(TOKEN_ID).serialize());

    expect(totalWeight()).toStrictEqual(u256.Zero);
    expect(weights.getSome(POOL_A)).toStrictEqual(u256.Zero);
    expect(weights.getSome(POOL_B)).toStrictEqual(u256.Zero);
    expect(usedWeights.getSome(TOKEN_ID)).toStrictEqual(u256.Zero);
  });

  test('poke recomputes the votes with the new power', () => {
    mockVeForVote(ONE_DUSA);
    vote(voteArgs([POOL_A, POOL_B], [u256.fromU64(1), u256.fromU64(1)]));

    const half = u256.div(ONE_DUSA, u256.fromU64(2));
    mockScCall(u256ToBytes(half)); // balanceOfNFT
    mockScCall([]); // voting(false)
    mockScCall([]); // voting(true)
    poke(new Args().add(TOKEN_ID).serialize());

    const quarter = u256.div(ONE_DUSA, u256.fromU64(4));
    expect(votes.getSome(voteKey(POOL_A))).toStrictEqual(quarter);
    expect(votes.getSome(voteKey(POOL_B))).toStrictEqual(quarter);
    expect(totalWeight()).toStrictEqual(half);
  });
});

describe('Voter pool whitelist', () => {
  beforeEach(() => {
    deployVoter();
  });

  test('rejects a vote for a pool that is not whitelisted', () => {
    const other = new Address(
      'AS12WBfwEXfV5WQ41cBcwL6EzDZgWt7QdaBQ6ENoshXigKLJrJ7WS',
    );
    mockVeForVote(ONE_DUSA);
    pendingVote = voteArgs([POOL_A, other], [u256.One, u256.One]);
    expect(callPendingVote).toThrow();
  });

  test("rejects a pool name containing ',' (votes reset could never clear)", () => {
    mockVeForVote(ONE_DUSA);
    pendingVote = voteArgs(
      [new Address(POOL_A.toString() + ',' + POOL_B.toString())],
      [u256.One],
    );
    expect(callPendingVote).toThrow();

    pendingWhitelist = whitelistArgs('JUNK1,JUNK2', true);
    expect(callPendingWhitelist).toThrow();
  });

  test('rejects an empty pool name', () => {
    pendingWhitelist = whitelistArgs('', true);
    expect(callPendingWhitelist).toThrow();
  });

  test('only the governor can whitelist pools', () => {
    setDeployContext('AU1qDAxGJ387ETi9JRQzZWSPKYq4YPXrFvdiE4VoXUaiAt38JFEC');
    pendingWhitelist = whitelistArgs(
      'AS12WBfwEXfV5WQ41cBcwL6EzDZgWt7QdaBQ6ENoshXigKLJrJ7WS',
      true,
    );
    expect(callPendingWhitelist).toThrow();
  });

  // the vm-mock doesn't roll back storage on revert (the reentrancy flag would
  // stay set), so nothing runs after an expected revert in the same test
  test('a de-whitelisted pool cannot be poked', () => {
    mockVeForVote(ONE_DUSA);
    vote(voteArgs([POOL_A, POOL_B], [u256.One, u256.One]));

    whitelistPool(whitelistArgs(POOL_B.toString(), false));

    // poke re-votes for the stored pools: POOL_B is no longer allowed
    mockScCall(u256ToBytes(ONE_DUSA)); // balanceOfNFT
    mockScCall([]); // voting(false)
    expect(callPoke).toThrow();
  });

  test('a de-whitelisted pool can still be reset', () => {
    mockVeForVote(ONE_DUSA);
    vote(voteArgs([POOL_A, POOL_B], [u256.One, u256.One]));

    whitelistPool(whitelistArgs(POOL_B.toString(), false));

    // reset doesn't check the whitelist: the lock can always exit
    mockTimestamp(IN_WINDOW + WEEK);
    mockScCall(boolToByte(true)); // isApprovedOrOwner
    mockScCall([]); // voting(false)
    reset(new Args().add(TOKEN_ID).serialize());
    expect(totalWeight()).toStrictEqual(u256.Zero);
    expect(weights.getSome(POOL_B)).toStrictEqual(u256.Zero);
  });
});
