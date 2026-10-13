import { Args } from '@massalabs/as-types';
import { Address, call, Storage } from '@massalabs/massa-as-sdk';
import { u256 } from 'as-bignum/assembly/integer/u256';

export class IVoter {
  constructor(public _origin: Address) {}

  init(_ve_: Address): void {
    const args = new Args().add(_ve_);
    call(this._origin, 'constructor', args, 0);
  }

  governor(): Address {
    return new Address(Storage.getOf(this._origin, 'governor'));
  }

  ve(): Address {
    return new Address(Storage.getOf(this._origin, 've'));
  }

  isAlive(_: Address): bool {
    throw new Error('Not implemented');
  }

  vote(_tokenId: u64, _poolVote: Address[], _weights: u256[]): void {
    const args = new Args()
      .add(_tokenId)
      .addSerializableObjectArray(_poolVote)
      .add(_weights);
    call(this._origin, 'vote', args, 0);
  }

  poke(_tokenId: u64): void {
    call(this._origin, 'poke', new Args().add(_tokenId), 0);
  }
}
