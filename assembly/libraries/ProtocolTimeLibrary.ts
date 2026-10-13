import { WEEK } from '../utils';
const HOURS = 60 * 60 * 1000;

export class ProtocolTimeLibrary {
  /// @dev Returns start of epoch based on current timestamp
  static epochStart(timestamp: u64): u64 {
    return timestamp - (timestamp % WEEK);
  }

  /// @dev Returns start of next epoch / end of current epoch
  static epochNext(timestamp: u64): u64 {
    return timestamp - (timestamp % WEEK) + WEEK;
  }

  /// @dev Returns start of voting window
  static epochVoteStart(timestamp: u64): u64 {
    return timestamp - (timestamp % WEEK) + HOURS;
  }

  /// @dev Returns end of voting window / beginning of unrestricted voting window
  static epochVoteEnd(timestamp: u64): u64 {
    return timestamp - (timestamp % WEEK) + WEEK - HOURS;
  }
}
