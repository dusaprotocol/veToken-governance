import {
  Args,
  bytesToU256,
  bytesToU64,
  byteToBool,
  NoArg,
} from '@massalabs/as-types';
import { Address, call, Storage } from '@massalabs/massa-as-sdk';
import { u256 } from 'as-bignum/assembly/integer/u256';

export class IVotingEscrow {
  constructor(public _origin: Address) {}

  init(_token: Address): void {
    const args = new Args().add(_token);
    call(this._origin, 'constructor', args, 0);
  }

  totalSupply(): u256 {
    const res = call(this._origin, 'totalSupply', NoArg, 0);
    return bytesToU256(res);
  }

  totalSupplyAt(_t: u64): u256 {
    const args = new Args().add(_t);
    const res = call(this._origin, 'totalSupplyAt', args, 0);
    return bytesToU256(res);
  }

  balanceOfNFT(_tokenId: u64): u256 {
    const args = new Args().add(_tokenId);
    const res = call(this._origin, 'balanceOfNFT', args, 0);
    return bytesToU256(res);
  }

  balanceOfNFTAt(_tokenId: u64, _t: u64): u256 {
    const args = new Args().add(_tokenId).add(_t);
    const res = call(this._origin, 'balanceOfNFTAt', args, 0);
    return bytesToU256(res);
  }

  isApprovedOrOwner(_owner: Address, _tokenId: u64): bool {
    const args = new Args().add(_owner).add(_tokenId);
    const res = call(this._origin, 'isApprovedOrOwner', args, 0);
    return byteToBool(res);
  }

  voting(_tokenId: u64, x: bool): void {
    const args = new Args().add(_tokenId).add(x);
    call(this._origin, 'voting', args, 0);
  }

  token(): Address {
    const res = Storage.getOf(this._origin, 'token');
    return new Address(res);
  }

  team(): Address {
    const res = Storage.getOf(this._origin, 'team');
    return new Address(res);
  }

  createLock(_value: u256, _lockDuration: u256): u64 {
    const args = new Args().add(_value).add(_lockDuration);
    const res = call(this._origin, 'createLock', args, 0);
    return bytesToU64(res);
  }

  setVoter(_voter: Address): void {
    const args = new Args().add(_voter);
    call(this._origin, 'setVoter', args, 0);
  }
}
