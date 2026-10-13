import { Args } from '@massalabs/as-types';
import { i128 } from 'as-bignum/assembly/integer/i128';
import { u256 } from 'as-bignum/assembly/integer/u256';
import { LockedBalance } from '../libraries/Structs';

// veDUSA stores lock amounts as i128 and converts them with u256.from().
// These tests guard the patched as-bignum (patches/as-bignum+0.2.40.patch):
// without the patch, u256.from<i128> throws "Unsupported generic type".

describe('u256.from(i128)', () => {
  test('zero', () => {
    expect(u256.from(i128.Zero)).toStrictEqual(u256.Zero);
  });

  test('small positive value', () => {
    expect(u256.from(i128.fromI64(100))).toStrictEqual(u256.fromU64(100));
  });

  test('1 DUSA (18 decimals)', () => {
    const oneDusa = i128.fromI64(1_000_000_000_000_000_000);
    expect(u256.from(oneDusa)).toStrictEqual(
      u256.fromU64(1_000_000_000_000_000_000),
    );
  });

  test('value using the high 64 bits', () => {
    // 2^64 + 5
    const v = new i128(5, 1);
    expect(u256.from(v)).toStrictEqual(new u256(5, 1, 0, 0));
  });

  test('i128.Max keeps all 127 bits and zero-extends', () => {
    const r = u256.from(i128.Max);
    expect(r.lo1).toBe(u64.MAX_VALUE);
    expect(r.lo2).toBe(<u64>i64.MAX_VALUE);
    expect(r.hi1).toBe(0);
    expect(r.hi2).toBe(0);
  });

  test('round-trips through toI128 for lock-sized amounts', () => {
    // 100M DUSA, the order of magnitude of the total supply
    const amount = i128.mul(
      i128.fromI64(100_000_000),
      i128.fromI64(1_000_000_000_000_000_000),
    );
    expect(u256.from(amount).toI128()).toStrictEqual(amount);
  });

  test("negative values are sign-extended (two's complement)", () => {
    const r = u256.from(i128.fromI64(-1));
    expect(r.lo1).toBe(u64.MAX_VALUE);
    expect(r.lo2).toBe(u64.MAX_VALUE);
    expect(r.hi1).toBe(u64.MAX_VALUE);
    expect(r.hi2).toBe(u64.MAX_VALUE);
  });
});

describe('LockedBalance amount', () => {
  test('serialize/deserialize keeps the i128 amount convertible to u256', () => {
    const amount = i128.fromI64(42_000_000_000_000_000);
    const lock = new LockedBalance(amount, 1_700_000_000_000, false);
    const decoded = new Args(lock.serialize())
      .nextSerializable<LockedBalance>()
      .unwrap();

    expect(decoded.end).toBe(1_700_000_000_000);
    expect(decoded.isPermanent).toBe(false);
    expect(u256.from(decoded.amount)).toStrictEqual(
      u256.fromU64(42_000_000_000_000_000),
    );
  });

  test('default (empty) lock converts to zero', () => {
    expect(u256.from(new LockedBalance().amount)).toStrictEqual(u256.Zero);
  });
});
