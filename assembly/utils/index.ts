import { Address, Context } from '@massalabs/massa-as-sdk';
import { u256 } from 'as-bignum/assembly/integer/u256';

export function u256ToString(u: u256): string {
  return String.UTF16.decode(changetype<ArrayBuffer>(u));
}

export const DAY: u64 = 24 * 60 * 60 * 1000;
export const WEEK: u64 = 7 * DAY;

export const PRECISION = u256.from(u64(10 ** 18));

export const zeroAddress = new Address('');

export const argsDelimiter = ';?!';

export function parseSlot(thread: u8, period: u64): u64 {
  const isBuildnet = Context.chainId() === 77658366;
  const genesisTimestamp = isBuildnet ? 1704289800000 : 1705312800000;
  return genesisTimestamp + period * 16_000 + (thread / 2) * 1000;
}
