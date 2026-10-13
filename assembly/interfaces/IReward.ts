import { Args, bytesToU256 } from '@massalabs/as-types';
import { Address, call } from '@massalabs/massa-as-sdk';
import { u256 } from 'as-bignum/assembly/integer/u256';

export class IReward {
  constructor(public _origin: Address) {}

  _deposit(amount: u256, tokenId: u64): void {
    const args = new Args().add(amount).add(tokenId);
    call(this._origin, 'deposit', args, 0);
  }

  getReward(tokenId: u64, tokens: Address[]): void {
    const args = new Args().add(tokenId).addSerializableObjectArray(tokens);
    call(this._origin, 'getReward', args, 0);
  }

  earned(token: Address, tokenId: u64): u256 {
    const args = new Args().add(tokenId);
    const res = call(this._origin, 'earned', args, 0);
    return bytesToU256(res);
  }

  _withdraw(amount: u256, tokenId: u64): void {
    const args = new Args().add(amount).add(tokenId);
    call(this._origin, 'withdraw', args, 0);
  }
}
