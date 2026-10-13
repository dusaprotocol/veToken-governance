import { Args, Result, Serializable } from '@massalabs/as-types';
import { Address } from '@massalabs/massa-as-sdk';
import { i128 } from 'as-bignum/assembly/integer/i128';
import { u256 } from 'as-bignum/assembly/integer/u256';
import { zeroAddress } from '../utils';

export class Checkpoint implements Serializable {
  constructor(
    public fromTimestamp: u64 = 0,
    public owner: Address = zeroAddress,
    public delegatedBalance: u256 = u256.Zero,
    public delegatee: u64 = 0,
  ) {}

  serialize(): StaticArray<u8> {
    return new Args()
      .add(this.fromTimestamp)
      .add(this.owner)
      .add(this.delegatedBalance)
      .add(this.delegatee)
      .serialize();
  }

  deserialize(data: StaticArray<u8>, offset: i32): Result<i32> {
    const args = new Args(data, offset);
    this.fromTimestamp = args.nextU64().expect('fromTimestamp is missing');
    this.owner = new Address(args.nextString().expect('owner is missing'));
    this.delegatedBalance = args
      .nextU256()
      .expect('delegatedBalance is missing');
    this.delegatee = args.nextU64().expect('delegatee is missing');
    return new Result(args.offset);
  }
}

export class LockedBalance implements Serializable {
  constructor(
    public amount: i128 = i128.Zero,
    public end: u64 = 0,
    public isPermanent: bool = false,
  ) {}

  serialize(): StaticArray<u8> {
    return new Args()
      .add(this.amount)
      .add(this.end)
      .add(this.isPermanent)
      .serialize();
  }

  deserialize(data: StaticArray<u8>, offset: i32): Result<i32> {
    const args = new Args(data, offset);
    this.amount = args.nextI128().expect('amount is missing');
    this.end = args.nextU64().expect('end is missing');
    this.isPermanent = args.nextBool().expect('isPermanent is missing');
    return new Result(args.offset);
  }
}

export class UserPoint implements Serializable {
  constructor(
    public bias: i128 = i128.Zero,
    public slope: i128 = i128.Zero, // # -dweight / dt
    public ts: u64 = 0,
    public blk: u64 = 0, // block
    public permanent: u256 = u256.Zero,
  ) {}

  serialize(): StaticArray<u8> {
    return new Args()
      .add(this.bias)
      .add(this.slope)
      .add(this.ts)
      .add(this.blk)
      .add(this.permanent)
      .serialize();
  }

  deserialize(data: StaticArray<u8>, offset: i32): Result<i32> {
    const args = new Args(data, offset);
    this.bias = args.nextI128().expect('bias is missing');
    this.slope = args.nextI128().expect('slope is missing');
    this.ts = args.nextU64().expect('ts is missing');
    this.blk = args.nextU64().expect('blk is missing');
    this.permanent = args.nextU256().expect('permanent is missing');
    return new Result(args.offset);
  }
}

export class GlobalPoint implements Serializable {
  constructor(
    public bias: i128 = i128.Zero,
    public slope: i128 = i128.Zero, // # -dweight / dt
    public ts: u64 = 0,
    public blk: u64 = 0, // block
    public permanentLockBalance: u256 = u256.Zero,
  ) {}

  serialize(): StaticArray<u8> {
    return new Args()
      .add(this.bias)
      .add(this.slope)
      .add(this.ts)
      .add(this.blk)
      .add(this.permanentLockBalance)
      .serialize();
  }

  deserialize(data: StaticArray<u8>, offset: i32): Result<i32> {
    const args = new Args(data, offset);
    this.bias = args.nextI128().expect('bias is missing');
    this.slope = args.nextI128().expect('slope is missing');
    this.ts = args.nextU64().expect('ts is missing');
    this.blk = args.nextU64().expect('blk is missing');
    this.permanentLockBalance = args
      .nextU256()
      .expect('permanentLockBalance is missing');
    return new Result(args.offset);
  }
}

export class GetLocksReturn implements Serializable {
  constructor(public tokenId: u64 = 0, public votingPower: u256 = u256.Zero) {}

  serialize(): StaticArray<u8> {
    return new Args().add(this.tokenId).add(this.votingPower).serialize();
  }

  deserialize(data: StaticArray<u8>, offset: i32): Result<i32> {
    const args = new Args(data, offset);
    this.tokenId = args.nextU64().expect('tokenId is missing');
    this.votingPower = args.nextU256().expect('votingPower is missing');
    return new Result(args.offset);
  }
}

export class Bribe implements Serializable {
  constructor(
    public tokenAddresses: string[] = [],
    public amounts: u256[] = [],
  ) {}

  serialize(): StaticArray<u8> {
    return new Args().add(this.tokenAddresses).add(this.amounts).serialize();
  }

  deserialize(data: StaticArray<u8>, offset: i32): Result<i32> {
    const args = new Args(data, offset);
    this.tokenAddresses = args
      .nextStringArray()
      .expect('tokenAddresses is missing');
    this.amounts = args.nextFixedSizeArray<u256>().expect('amounts is missing');
    return new Result(args.offset);
  }
}
