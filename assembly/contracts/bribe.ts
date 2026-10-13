import { Args } from '@massalabs/as-types';
import {
  Address,
  balance,
  Context,
  generateEvent,
  isDeployingContract,
  transferredCoins,
} from '@massalabs/massa-as-sdk';
import { PersistentMap } from '../libraries/persistentMap';
import { u256 } from 'as-bignum/assembly/integer/u256';
import { IERC20 } from '../interfaces';
import {
  ReentrancyGuardUpgradeable,
  SafeMath256,
  transferRemaining,
  createEvent,
} from '@dusalabs/core';
import {
  _onlyOwner,
  _setOwner,
} from '@massalabs/sc-standards/assembly/contracts/utils/ownership-internal';
import { getBalanceEntryCost } from '@massalabs/sc-standards/assembly/contracts/MRC20/MRC20-external';
import { Bribe } from '../libraries/Structs';

export * from '@massalabs/sc-standards/assembly/contracts/utils/ownership';

const epochToBribe = new PersistentMap<u64, Bribe>('epochToBribe');

export function constructor(_: StaticArray<u8>): void {
  assert(isDeployingContract(), 'Contract is already deployed');
  ReentrancyGuardUpgradeable.__ReentrancyGuard_init();

  _setOwner(Context.caller().toString());
}

export function addReward(bs: StaticArray<u8>): void {
  const args = new Args(bs);
  const token = args.nextString().unwrap();
  const amounts = args.nextFixedSizeArray<u256>().unwrap();
  const epochs = args.nextFixedSizeArray<u64>().unwrap();
  const SCBalance = balance();
  const sent = transferredCoins();

  assert(amounts.length == epochs.length, 'lenght missmatch');

  _addReward(token, amounts, epochs);
  transferRemaining(SCBalance, balance(), sent, Context.caller());
}

function _addReward(token: string, amounts: u256[], epochs: u64[]): void {
  ReentrancyGuardUpgradeable.nonReentrant();

  let totalAmount = u256.Zero;

  for (let i = 0; i < amounts.length; i++) {
    assert(amounts[i] > u256.Zero, 'AmountZero');

    const bribe = epochToBribe.get(epochs[i], new Bribe());

    if (bribe.tokenAddresses.includes(token)) {
      const index = bribe.tokenAddresses.indexOf(token);
      bribe.amounts[index] = SafeMath256.add(bribe.amounts[index], amounts[i]);
    } else {
      bribe.tokenAddresses.push(token);
      bribe.amounts.push(amounts[i]);
    }

    totalAmount = SafeMath256.add(totalAmount, amounts[i]);
    epochToBribe.set(epochs[i], bribe);
  }

  new IERC20(new Address(token)).transferFrom(
    Context.caller(),
    Context.callee(),
    totalAmount,
    getBalanceEntryCost(token, Context.callee().toString()),
  );

  ReentrancyGuardUpgradeable.endNonReentrant();
}

export function recoverReward(bs: StaticArray<u8>): void {
  _onlyOwner();
  const epoch = new Args(bs).nextU64().unwrap();
  const bribe = epochToBribe.getSome(epoch, 'No bribe');

  for (let i = 0; i < bribe.tokenAddresses.length; i++) {
    new IERC20(new Address(bribe.tokenAddresses[i])).transfer(
      Context.caller(),
      bribe.amounts[i],
    );
  }

  generateEvent(createEvent('BribeClaimed', [epoch.toString()]));
}

export function recoverSpecificReward(bs: StaticArray<u8>): void {
  _onlyOwner();
  const args = new Args(bs);
  const epoch = args.nextU64().unwrap();
  const tokens = args.nextStringArray().unwrap();
  const amounts = args.nextFixedSizeArray<u256>().unwrap();

  for (let i = 0; i < tokens.length; i++) {
    new IERC20(new Address(tokens[i])).transfer(Context.caller(), amounts[i]);
  }

  generateEvent(createEvent('BribeClaimed', [epoch.toString()]));
}
