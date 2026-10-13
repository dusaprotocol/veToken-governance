- createLock
    - _createLock
        - _mint
            - _addTokenTo
                update `idToOwner` PM (tokenId to owner)
                - _addTokenToOwnerList
                    update `ownerToNFTokenIdList` PM (owner + index to tokenId)
                    update `tokenToOwnerIndex` PM (tokenId to owner's index)
                increment `ownerToNFTokenCount` PM (owner to count)
            - _checkpointDelegator
                - DelegationLogicLibrary.checkpointDelegator
                    - DelegationLogicLibrary.checkpointDelegatee
                        update `_numCheckpoints` PM (tokenId to count) OR update & delete `_checkpoints` PM (tokenId + count to checkpoint) 
                    update `_numCheckpoints` PM (tokenId to count) OR update & delete `_checkpoints` PM (tokenId + count to checkpoint) 
                    update `_delegates` PM (tokenId to tokenId)
        - _depositFor
            update `_locked` PM (tokenId to locked balance)
            - _checkpoint
                update `_pointHistory` PM (epoch to global point)
                update `__epoch` storage key
                update `_pointHistory` PM again
                update `slopeChanges` PM (idk)
                update `_userPointHistory` PM (tokenId + user epoch to user point)
            - IERC20.transferFrom
- vote
    - _vote
        - _reset
            - delete `votes` PM (tokenId+pool -> 0)
            - decrease `weights` PM (pool -> weight - votes)
            - delete `poolVote` PM (tokenId -> [])
            - set `usedWeights` PM (tokenId -> 0)
            - update `__totalWeight` storage key (total -= votes)
            - update IVotingEscrow voting state (tokenId -> false)
            - update IReward fee state (withdraw votes)
            - update IReward bribe state (withdraw votes)

        - for each new pool vote:
            - append to `poolVote` PM (tokenId -> pools)
            - increase `weights` PM (pool -> weight + poolWeight)
            - increase `votes` PM (tokenId+pool -> poolWeight)
            - update IReward fee state (deposit poolWeight)
            - update IReward bribe state (deposit poolWeight)

        - update `__totalWeight` storage key (total += totalWeight)
        - set `usedWeights` PM (tokenId -> usedWeight)
        - set `lastVoted` PM (tokenId -> timestamp)
        - update IVotingEscrow voting state (tokenId -> true)

***u256***
`node_modules/as-bignum/assembly/integer/u256.ts`

```
@inline
static from<T>(value: T): u256 {
...
else if (value instanceof u128) return u256.fromU128(<u128>value);
...
}
```

```
@inline
static fromI128(value: i128): u256 {
  // If positive, just copy the bits and zero extend
  if (value.isPos()) {
    return new u256(value.lo, value.hi);
  }
  // If negative, we need to extend the sign bit to all higher bits
  // -1 in two's complement is represented as all 1s
  return new u256(value.lo, value.hi, -1, -1);
}
```