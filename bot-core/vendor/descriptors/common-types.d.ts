import { Enum, GetEnum, SizedHex, SS58String, FixedSizeArray, ResultPayload, TxCallData } from "polkadot-api";
type AnonymousEnum<T extends {}> = T & {
    __anonymous: true;
};
type MyTuple<T> = [T, ...T[]];
type SeparateUndefined<T> = undefined extends T ? undefined | Exclude<T, undefined> : T;
type Anonymize<T> = SeparateUndefined<T extends string | number | bigint | boolean | void | undefined | null | symbol | Uint8Array | Enum<any> ? T : T extends AnonymousEnum<infer V> ? Enum<V> : T extends MyTuple<any> ? {
    [K in keyof T]: T[K];
} : T extends [] ? [] : T extends FixedSizeArray<infer L, infer T> ? number extends L ? Array<T> : FixedSizeArray<L, T> : {
    [K in keyof T & string]: T[K];
}>;
export type I5sesotjlssv2d = {
    "nonce": number;
    "consumers": number;
    "providers": number;
    "sufficients": number;
    "data": Anonymize<I1q8tnt1cluu5j>;
};
export type I1q8tnt1cluu5j = {
    "free": bigint;
    "reserved": bigint;
    "frozen": bigint;
    "flags": bigint;
};
export type Iffmde3ekjedi9 = {
    "normal": Anonymize<I4q39t5hn830vp>;
    "operational": Anonymize<I4q39t5hn830vp>;
    "mandatory": Anonymize<I4q39t5hn830vp>;
};
export type I4q39t5hn830vp = {
    "ref_time": bigint;
    "proof_size": bigint;
};
export type I4mddgoa69c0a2 = Array<DigestItem>;
export type DigestItem = Enum<{
    "PreRuntime": Anonymize<I82jm9g7pufuel>;
    "Consensus": Anonymize<I82jm9g7pufuel>;
    "Seal": Anonymize<I82jm9g7pufuel>;
    "Other": Uint8Array;
    "RuntimeEnvironmentUpdated": undefined;
}>;
export declare const DigestItem: GetEnum<DigestItem>;
export type I82jm9g7pufuel = [SizedHex<4>, Uint8Array];
export type I3v2vo485iral6 = Array<{
    "phase": Phase;
    "event": Anonymize<I25kugfe7g1o8d>;
    "topics": Anonymize<Ic5m5lp1oioo8r>;
}>;
export type Phase = Enum<{
    "ApplyExtrinsic": number;
    "Finalization": undefined;
    "Initialization": undefined;
}>;
export declare const Phase: GetEnum<Phase>;
export type I25kugfe7g1o8d = AnonymousEnum<{
    "System": Anonymize<I9502vpcjrqd8>;
    "ParachainSystem": Anonymize<Icbsekf57miplo>;
    "Balances": Anonymize<I4c6hinnlgm6m>;
    "TransactionPayment": TransactionPaymentEvent;
    "SkipFeelessPayment": Anonymize<I8g774vc9t4tf1>;
    "OriginRestriction": Anonymize<I2isv113mtlrp7>;
    "Assets": Anonymize<I4nr69fhfof48s>;
    "AssetsHolder": Anonymize<Ies5dmgt7ichj9>;
    "AssetRate": Anonymize<I51qnoi21es512>;
    "AssetTxPayment": Anonymize<Ie598chmfqlqa>;
    "CollatorSelection": Anonymize<I4srakrmf0fspo>;
    "Session": Anonymize<I6ue0ck5fc3u44>;
    "XcmpQueue": Anonymize<Idsqc7mhp6nnle>;
    "PolkadotXcm": Anonymize<If95hivmqmkiku>;
    "CumulusXcm": Anonymize<I5uv57c3fffoi9>;
    "MessageQueue": Anonymize<I2kosejppk3jon>;
    "Utility": Anonymize<I9t024spkebrtk>;
    "Multisig": Anonymize<Ig5k2529tfkni>;
    "Sudo": Anonymize<Icqpp5h2s0lmjl>;
    "Proxy": Anonymize<Iehol079dtpmsc>;
    "Identity": Anonymize<Idkb7nir4hamvl>;
    "People": Anonymize<Idundv7m4eqe4f>;
    "MobRule": Anonymize<Id02pn4ssbc7gd>;
    "ProofOfInk": Anonymize<I2p1svr0ek31rn>;
    "Game": Anonymize<Iassevcqno9q3q>;
    "Score": Anonymize<Idlsua02m53lrp>;
    "DummyDim": Anonymize<Inci5ucc4j6it>;
    "PeopleLite": Anonymize<I8rnqb4fs2u0s5>;
    "Resources": Anonymize<Ibdjm4ghdk920m>;
    "ChunksManager": Anonymize<I2g1s4krv9s4p2>;
    "Members": Anonymize<If4h4847mmr709>;
    "Coinage": Anonymize<Id7j62tudmp73q>;
    "MembersNotifier": Anonymize<Ieg96uk2l11u40>;
    "Airdrop": Anonymize<Ic05g466md6v74>;
    "Honour": Anonymize<I6kiujajvpvk8a>;
    "StorageInitialization": Anonymize<I7l1gg2sl9pcgr>;
    "MultiBlockMigrations": Anonymize<I94co7vj7h6bo>;
}>;
export type I9502vpcjrqd8 = AnonymousEnum<{
    /**
     * An extrinsic completed successfully.
     */
    "ExtrinsicSuccess": Anonymize<Ia82mnkmeo2rhc>;
    /**
     * An extrinsic failed.
     */
    "ExtrinsicFailed": Anonymize<Ibmkdg0la4lmik>;
    /**
     * `:code` was updated to the code with the given hash.
     */
    "CodeUpdated": Anonymize<I1jm8m1rh9e20v>;
    /**
     * A new account was created.
     */
    "NewAccount": Anonymize<Icbccs0ug47ilf>;
    /**
     * An account was reaped.
     */
    "KilledAccount": Anonymize<Icbccs0ug47ilf>;
    /**
     * On on-chain remark happened.
     */
    "Remarked": Anonymize<I855j4i3kr8ko1>;
    /**
     * An upgrade was authorized.
     */
    "UpgradeAuthorized": Anonymize<Ibgl04rn6nbfm6>;
    /**
     * An invalid authorized upgrade was rejected while trying to apply it.
     */
    "RejectedInvalidAuthorizedUpgrade": Anonymize<I1dfctsnhih1bs>;
}>;
export type Ia82mnkmeo2rhc = {
    "dispatch_info": Anonymize<Ic9s8f85vjtncc>;
};
export type Ic9s8f85vjtncc = {
    "weight": Anonymize<I4q39t5hn830vp>;
    "class": DispatchClass;
    "pays_fee": Anonymize<Iehg04bj71rkd>;
};
export type DispatchClass = Enum<{
    "Normal": undefined;
    "Operational": undefined;
    "Mandatory": undefined;
}>;
export declare const DispatchClass: GetEnum<DispatchClass>;
export type Iehg04bj71rkd = AnonymousEnum<{
    "Yes": undefined;
    "No": undefined;
}>;
export type Ibmkdg0la4lmik = {
    "dispatch_error": Anonymize<I8rjgvnsb8ltnm>;
    "dispatch_info": Anonymize<Ic9s8f85vjtncc>;
};
export type I8rjgvnsb8ltnm = AnonymousEnum<{
    "Other": undefined;
    "CannotLookup": undefined;
    "BadOrigin": undefined;
    "Module": Enum<{
        "System": Anonymize<I5o0s7c8q1cc9b>;
        "ParachainSystem": Anonymize<Icjkr35j4tmg7k>;
        "Timestamp": undefined;
        "ParachainInfo": undefined;
        "WeightReclaim": undefined;
        "Balances": Anonymize<Idj13i7adlomht>;
        "TransactionPayment": undefined;
        "SkipFeelessPayment": undefined;
        "OriginRestriction": Anonymize<I8pd5n1lppndg2>;
        "Assets": Anonymize<I8ktb7n3252jn5>;
        "AssetsHolder": Anonymize<I3rc9953c1unod>;
        "AssetRate": Anonymize<I3qgd61cgli6cp>;
        "AssetTxPayment": undefined;
        "Authorship": undefined;
        "CollatorSelection": Anonymize<I36bcffk2387dv>;
        "Session": Anonymize<I1e07dgbaqd1sq>;
        "Aura": undefined;
        "AuraExt": undefined;
        "XcmpQueue": Anonymize<Idnnbndsjjeqqs>;
        "PolkadotXcm": Anonymize<I4vcvo9od6afmt>;
        "CumulusXcm": undefined;
        "MessageQueue": Anonymize<I5iupade5ag2dp>;
        "Utility": Anonymize<I8dt2g2hcrgh36>;
        "Multisig": Anonymize<Ia76qmhhg4jvb9>;
        "Sudo": Anonymize<Iaug04qjhbli00>;
        "VerifySignature": undefined;
        "Proxy": Anonymize<Iuvt54ei4cehc>;
        "Identity": Anonymize<I6ngmnhrhffg3o>;
        "People": Anonymize<I7crjg7o7jiji6>;
        "MobRule": Anonymize<I940ulmo4j2d84>;
        "ProofOfInk": Anonymize<Icouc1975ac8ae>;
        "Game": Anonymize<Ic64qv46c45g50>;
        "Score": Anonymize<I1e55cbho6hjcq>;
        "DummyDim": Anonymize<I4dumqe8b5q0ce>;
        "PeopleLite": Anonymize<I3tva1ioru4b0>;
        "Resources": Anonymize<I3lcis8epk78u>;
        "ChunksManager": Anonymize<I81gtj1f3ennke>;
        "Members": Anonymize<Idecbp1bqjv3s9>;
        "Coinage": Anonymize<Ic1dr90c79fbnh>;
        "MembersNotifier": Anonymize<Id2ueql1n8r6lh>;
        "Airdrop": Anonymize<I37f79uio94b2l>;
        "Honour": Anonymize<Ib7pa0cea24q4v>;
        "StorageInitialization": undefined;
        "MultiBlockMigrations": Anonymize<Iaaqq5jevtahm8>;
    }>;
    "ConsumerRemaining": undefined;
    "NoProviders": undefined;
    "TooManyConsumers": undefined;
    "Token": TokenError;
    "Arithmetic": ArithmeticError;
    "Transactional": TransactionalError;
    "Exhausted": undefined;
    "Corruption": undefined;
    "Unavailable": undefined;
    "RootNotAllowed": undefined;
    "Trie": Anonymize<Idh4cj79bvroj8>;
}>;
export type I5o0s7c8q1cc9b = AnonymousEnum<{
    /**
     * The name of specification does not match between the current runtime
     * and the new runtime.
     */
    "InvalidSpecName": undefined;
    /**
     * The specification version is not allowed to decrease between the current runtime
     * and the new runtime.
     */
    "SpecVersionNeedsToIncrease": undefined;
    /**
     * Failed to extract the runtime version from the new runtime.
     *
     * Either calling `Core_version` or decoding `RuntimeVersion` failed.
     */
    "FailedToExtractRuntimeVersion": undefined;
    /**
     * Suicide called when the account has non-default composite data.
     */
    "NonDefaultComposite": undefined;
    /**
     * There is a non-zero reference count preventing the account from being purged.
     */
    "NonZeroRefCount": undefined;
    /**
     * The origin filter prevent the call to be dispatched.
     */
    "CallFiltered": undefined;
    /**
     * A multi-block migration is ongoing and prevents the current code from being replaced.
     */
    "MultiBlockMigrationsOngoing": undefined;
    /**
     * No upgrade authorized.
     */
    "NothingAuthorized": undefined;
    /**
     * The submitted code is not authorized.
     */
    "Unauthorized": undefined;
}>;
export type Icjkr35j4tmg7k = AnonymousEnum<{
    /**
     * Attempt to upgrade validation function while existing upgrade pending.
     */
    "OverlappingUpgrades": undefined;
    /**
     * Polkadot currently prohibits this parachain from upgrading its validation function.
     */
    "ProhibitedByPolkadot": undefined;
    /**
     * The supplied validation function has compiled into a blob larger than Polkadot is
     * willing to run.
     */
    "TooBig": undefined;
    /**
     * The inherent which supplies the validation data did not run this block.
     */
    "ValidationDataNotAvailable": undefined;
    /**
     * The inherent which supplies the host configuration did not run this block.
     */
    "HostConfigurationNotAvailable": undefined;
    /**
     * No validation function upgrade is currently scheduled.
     */
    "NotScheduled": undefined;
}>;
export type Idj13i7adlomht = AnonymousEnum<{
    /**
     * Vesting balance too high to send value.
     */
    "VestingBalance": undefined;
    /**
     * Account liquidity restrictions prevent withdrawal.
     */
    "LiquidityRestrictions": undefined;
    /**
     * Balance too low to send value.
     */
    "InsufficientBalance": undefined;
    /**
     * Value too low to create account due to existential deposit.
     */
    "ExistentialDeposit": undefined;
    /**
     * Transfer/payment would kill account.
     */
    "Expendability": undefined;
    /**
     * A vesting schedule already exists for this account.
     */
    "ExistingVestingSchedule": undefined;
    /**
     * Beneficiary account must pre-exist.
     */
    "DeadAccount": undefined;
    /**
     * Number of named reserves exceed `MaxReserves`.
     */
    "TooManyReserves": undefined;
    /**
     * Number of holds exceed `VariantCountOf<T::RuntimeHoldReason>`.
     */
    "TooManyHolds": undefined;
    /**
     * Number of freezes exceed `MaxFreezes`.
     */
    "TooManyFreezes": undefined;
    /**
     * The issuance cannot be modified since it is already deactivated.
     */
    "IssuanceDeactivated": undefined;
    /**
     * The delta cannot be zero.
     */
    "DeltaZero": undefined;
}>;
export type I8pd5n1lppndg2 = AnonymousEnum<{
    /**
     * The origin has no usage tracked.
     */
    "NoUsage": undefined;
    /**
     * The usage is not zero.
     */
    "NotZero": undefined;
}>;
export type I8ktb7n3252jn5 = AnonymousEnum<{
    /**
     * Account balance must be greater than or equal to the transfer amount.
     */
    "BalanceLow": undefined;
    /**
     * The account to alter does not exist.
     */
    "NoAccount": undefined;
    /**
     * The signing account has no permission to do the operation.
     */
    "NoPermission": undefined;
    /**
     * The given asset ID is unknown.
     */
    "Unknown": undefined;
    /**
     * The origin account is frozen.
     */
    "Frozen": undefined;
    /**
     * The asset ID is already taken.
     */
    "InUse": undefined;
    /**
     * Invalid witness data given.
     */
    "BadWitness": undefined;
    /**
     * Minimum balance should be non-zero.
     */
    "MinBalanceZero": undefined;
    /**
     * Unable to increment the consumer reference counters on the account. Either no provider
     * reference exists to allow a non-zero balance of a non-self-sufficient asset, or one
     * fewer then the maximum number of consumers has been reached.
     */
    "UnavailableConsumer": undefined;
    /**
     * Invalid metadata given.
     */
    "BadMetadata": undefined;
    /**
     * No approval exists that would allow the transfer.
     */
    "Unapproved": undefined;
    /**
     * The source account would not survive the transfer and it needs to stay alive.
     */
    "WouldDie": undefined;
    /**
     * The asset-account already exists.
     */
    "AlreadyExists": undefined;
    /**
     * The asset-account doesn't have an associated deposit.
     */
    "NoDeposit": undefined;
    /**
     * The operation would result in funds being burned.
     */
    "WouldBurn": undefined;
    /**
     * The asset is a live asset and is actively being used. Usually emit for operations such
     * as `start_destroy` which require the asset to be in a destroying state.
     */
    "LiveAsset": undefined;
    /**
     * The asset is not live, and likely being destroyed.
     */
    "AssetNotLive": undefined;
    /**
     * The asset status is not the expected status.
     */
    "IncorrectStatus": undefined;
    /**
     * The asset should be frozen before the given operation.
     */
    "NotFrozen": undefined;
    /**
     * Callback action resulted in error
     */
    "CallbackFailed": undefined;
    /**
     * The asset ID must be equal to the [`NextAssetId`].
     */
    "BadAssetId": undefined;
    /**
     * The asset cannot be destroyed because some accounts for this asset contain freezes.
     */
    "ContainsFreezes": undefined;
    /**
     * The asset cannot be destroyed because some accounts for this asset contain holds.
     */
    "ContainsHolds": undefined;
    /**
     * Tried setting too many reserves.
     */
    "TooManyReserves": undefined;
}>;
export type I3rc9953c1unod = AnonymousEnum<{
    /**
     * Number of holds on an account would exceed the count of `RuntimeHoldReason`.
     */
    "TooManyHolds": undefined;
}>;
export type I3qgd61cgli6cp = AnonymousEnum<{
    /**
     * The given asset ID is unknown.
     */
    "UnknownAssetKind": undefined;
    /**
     * The given asset ID already has an assigned conversion rate and cannot be re-created.
     */
    "AlreadyExists": undefined;
    /**
     * Overflow ocurred when calculating the inverse rate.
     */
    "Overflow": undefined;
}>;
export type I36bcffk2387dv = AnonymousEnum<{
    /**
     * The pallet has too many candidates.
     */
    "TooManyCandidates": undefined;
    /**
     * Leaving would result in too few candidates.
     */
    "TooFewEligibleCollators": undefined;
    /**
     * Account is already a candidate.
     */
    "AlreadyCandidate": undefined;
    /**
     * Account is not a candidate.
     */
    "NotCandidate": undefined;
    /**
     * There are too many Invulnerables.
     */
    "TooManyInvulnerables": undefined;
    /**
     * Account is already an Invulnerable.
     */
    "AlreadyInvulnerable": undefined;
    /**
     * Account is not an Invulnerable.
     */
    "NotInvulnerable": undefined;
    /**
     * Account has no associated validator ID.
     */
    "NoAssociatedValidatorId": undefined;
    /**
     * Validator ID is not yet registered.
     */
    "ValidatorNotRegistered": undefined;
    /**
     * Could not insert in the candidate list.
     */
    "InsertToCandidateListFailed": undefined;
    /**
     * Could not remove from the candidate list.
     */
    "RemoveFromCandidateListFailed": undefined;
    /**
     * New deposit amount would be below the minimum candidacy bond.
     */
    "DepositTooLow": undefined;
    /**
     * Could not update the candidate list.
     */
    "UpdateCandidateListFailed": undefined;
    /**
     * Deposit amount is too low to take the target's slot in the candidate list.
     */
    "InsufficientBond": undefined;
    /**
     * The target account to be replaced in the candidate list is not a candidate.
     */
    "TargetIsNotCandidate": undefined;
    /**
     * The updated deposit amount is equal to the amount already reserved.
     */
    "IdenticalDeposit": undefined;
    /**
     * Cannot lower candidacy bond while occupying a future collator slot in the list.
     */
    "InvalidUnreserve": undefined;
}>;
export type I1e07dgbaqd1sq = AnonymousEnum<{
    /**
     * Invalid ownership proof.
     */
    "InvalidProof": undefined;
    /**
     * No associated validator ID for account.
     */
    "NoAssociatedValidatorId": undefined;
    /**
     * Registered duplicate key.
     */
    "DuplicatedKey": undefined;
    /**
     * No keys are associated with this account.
     */
    "NoKeys": undefined;
    /**
     * Key setting account is not live, so it's impossible to associate keys.
     */
    "NoAccount": undefined;
}>;
export type Idnnbndsjjeqqs = AnonymousEnum<{
    /**
     * Setting the queue config failed since one of its values was invalid.
     */
    "BadQueueConfig": undefined;
    /**
     * The execution is already suspended.
     */
    "AlreadySuspended": undefined;
    /**
     * The execution is already resumed.
     */
    "AlreadyResumed": undefined;
    /**
     * There are too many active outbound channels.
     */
    "TooManyActiveOutboundChannels": undefined;
    /**
     * The message is too big.
     */
    "TooBig": undefined;
}>;
export type I4vcvo9od6afmt = AnonymousEnum<{
    /**
     * The desired destination was unreachable, generally because there is a no way of routing
     * to it.
     */
    "Unreachable": undefined;
    /**
     * There was some other issue (i.e. not to do with routing) in sending the message.
     * Perhaps a lack of space for buffering the message.
     */
    "SendFailure": undefined;
    /**
     * The message execution fails the filter.
     */
    "Filtered": undefined;
    /**
     * The message's weight could not be determined.
     */
    "UnweighableMessage": undefined;
    /**
     * The destination `Location` provided cannot be inverted.
     */
    "DestinationNotInvertible": undefined;
    /**
     * The assets to be sent are empty.
     */
    "Empty": undefined;
    /**
     * Could not re-anchor the assets to declare the fees for the destination chain.
     */
    "CannotReanchor": undefined;
    /**
     * Too many assets have been attempted for transfer.
     */
    "TooManyAssets": undefined;
    /**
     * Origin is invalid for sending.
     */
    "InvalidOrigin": undefined;
    /**
     * The version of the `Versioned` value used is not able to be interpreted.
     */
    "BadVersion": undefined;
    /**
     * The given location could not be used (e.g. because it cannot be expressed in the
     * desired version of XCM).
     */
    "BadLocation": undefined;
    /**
     * The referenced subscription could not be found.
     */
    "NoSubscription": undefined;
    /**
     * The location is invalid since it already has a subscription from us.
     */
    "AlreadySubscribed": undefined;
    /**
     * Could not check-out the assets for teleportation to the destination chain.
     */
    "CannotCheckOutTeleport": undefined;
    /**
     * The owner does not own (all) of the asset that they wish to do the operation on.
     */
    "LowBalance": undefined;
    /**
     * The asset owner has too many locks on the asset.
     */
    "TooManyLocks": undefined;
    /**
     * The given account is not an identifiable sovereign account for any location.
     */
    "AccountNotSovereign": undefined;
    /**
     * The operation required fees to be paid which the initiator could not meet.
     */
    "FeesNotMet": undefined;
    /**
     * A remote lock with the corresponding data could not be found.
     */
    "LockNotFound": undefined;
    /**
     * The unlock operation cannot succeed because there are still consumers of the lock.
     */
    "InUse": undefined;
    /**
     * Invalid asset, reserve chain could not be determined for it.
     */
    "InvalidAssetUnknownReserve": undefined;
    /**
     * Invalid asset, do not support remote asset reserves with different fees reserves.
     */
    "InvalidAssetUnsupportedReserve": undefined;
    /**
     * Too many assets with different reserve locations have been attempted for transfer.
     */
    "TooManyReserves": undefined;
    /**
     * Local XCM execution incomplete.
     */
    "LocalExecutionIncomplete": undefined;
    /**
     * Too many locations authorized to alias origin.
     */
    "TooManyAuthorizedAliases": undefined;
    /**
     * Expiry block number is in the past.
     */
    "ExpiresInPast": undefined;
    /**
     * The alias to remove authorization for was not found.
     */
    "AliasNotFound": undefined;
    /**
     * Local XCM execution incomplete with the actual XCM error and the index of the
     * instruction that caused the error.
     */
    "LocalExecutionIncompleteWithError": Anonymize<I5r8t4iaend96p>;
}>;
export type I5r8t4iaend96p = {
    "index": number;
    "error": Enum<{
        "Overflow": undefined;
        "Unimplemented": undefined;
        "UntrustedReserveLocation": undefined;
        "UntrustedTeleportLocation": undefined;
        "LocationFull": undefined;
        "LocationNotInvertible": undefined;
        "BadOrigin": undefined;
        "InvalidLocation": undefined;
        "AssetNotFound": undefined;
        "FailedToTransactAsset": undefined;
        "NotWithdrawable": undefined;
        "LocationCannotHold": undefined;
        "ExceedsMaxMessageSize": undefined;
        "DestinationUnsupported": undefined;
        "Transport": undefined;
        "Unroutable": undefined;
        "UnknownClaim": undefined;
        "FailedToDecode": undefined;
        "MaxWeightInvalid": undefined;
        "NotHoldingFees": undefined;
        "TooExpensive": undefined;
        "Trap": undefined;
        "ExpectationFalse": undefined;
        "PalletNotFound": undefined;
        "NameMismatch": undefined;
        "VersionIncompatible": undefined;
        "HoldingWouldOverflow": undefined;
        "ExportError": undefined;
        "ReanchorFailed": undefined;
        "NoDeal": undefined;
        "FeesNotMet": undefined;
        "LockError": undefined;
        "NoPermission": undefined;
        "Unanchored": undefined;
        "NotDepositable": undefined;
        "TooManyAssets": undefined;
        "UnhandledXcmVersion": undefined;
        "WeightLimitReached": undefined;
        "Barrier": undefined;
        "WeightNotComputable": undefined;
        "ExceedsStackLimit": undefined;
    }>;
};
export type I5iupade5ag2dp = AnonymousEnum<{
    /**
     * Page is not reapable because it has items remaining to be processed and is not old
     * enough.
     */
    "NotReapable": undefined;
    /**
     * Page to be reaped does not exist.
     */
    "NoPage": undefined;
    /**
     * The referenced message could not be found.
     */
    "NoMessage": undefined;
    /**
     * The message was already processed and cannot be processed again.
     */
    "AlreadyProcessed": undefined;
    /**
     * The message is queued for future execution.
     */
    "Queued": undefined;
    /**
     * There is temporarily not enough weight to continue servicing messages.
     */
    "InsufficientWeight": undefined;
    /**
     * This message is temporarily unprocessable.
     *
     * Such errors are expected, but not guaranteed, to resolve themselves eventually through
     * retrying.
     */
    "TemporarilyUnprocessable": undefined;
    /**
     * The queue is paused and no message can be executed from it.
     *
     * This can change at any time and may resolve in the future by re-trying.
     */
    "QueuePaused": undefined;
    /**
     * Another call is in progress and needs to finish before this call can happen.
     */
    "RecursiveDisallowed": undefined;
}>;
export type I8dt2g2hcrgh36 = AnonymousEnum<{
    /**
     * Too many calls batched.
     */
    "TooManyCalls": undefined;
}>;
export type Ia76qmhhg4jvb9 = AnonymousEnum<{
    /**
     * Threshold must be 2 or greater.
     */
    "MinimumThreshold": undefined;
    /**
     * Call is already approved by this signatory.
     */
    "AlreadyApproved": undefined;
    /**
     * Call doesn't need any (more) approvals.
     */
    "NoApprovalsNeeded": undefined;
    /**
     * There are too few signatories in the list.
     */
    "TooFewSignatories": undefined;
    /**
     * There are too many signatories in the list.
     */
    "TooManySignatories": undefined;
    /**
     * The signatories were provided out of order; they should be ordered.
     */
    "SignatoriesOutOfOrder": undefined;
    /**
     * The sender was contained in the other signatories; it shouldn't be.
     */
    "SenderInSignatories": undefined;
    /**
     * Multisig operation not found in storage.
     */
    "NotFound": undefined;
    /**
     * Only the account that originally created the multisig is able to cancel it or update
     * its deposits.
     */
    "NotOwner": undefined;
    /**
     * No timepoint was given, yet the multisig operation is already underway.
     */
    "NoTimepoint": undefined;
    /**
     * A different timepoint was given to the multisig operation that is underway.
     */
    "WrongTimepoint": undefined;
    /**
     * A timepoint was given, yet no multisig operation is underway.
     */
    "UnexpectedTimepoint": undefined;
    /**
     * The maximum weight information provided was too low.
     */
    "MaxWeightTooLow": undefined;
    /**
     * The data to be stored is already stored.
     */
    "AlreadyStored": undefined;
}>;
export type Iaug04qjhbli00 = AnonymousEnum<{
    /**
     * Sender must be the Sudo account.
     */
    "RequireSudo": undefined;
}>;
export type Iuvt54ei4cehc = AnonymousEnum<{
    /**
     * There are too many proxies registered or too many announcements pending.
     */
    "TooMany": undefined;
    /**
     * Proxy registration not found.
     */
    "NotFound": undefined;
    /**
     * Sender is not a proxy of the account to be proxied.
     */
    "NotProxy": undefined;
    /**
     * A call which is incompatible with the proxy type's filter was attempted.
     */
    "Unproxyable": undefined;
    /**
     * Account is already a proxy.
     */
    "Duplicate": undefined;
    /**
     * Call may not be made by proxy because it may escalate its privileges.
     */
    "NoPermission": undefined;
    /**
     * Announcement, if made at all, was made too recently.
     */
    "Unannounced": undefined;
    /**
     * Cannot add self as proxy.
     */
    "NoSelfProxy": undefined;
}>;
export type I6ngmnhrhffg3o = AnonymousEnum<{
    /**
     * Too many subs-accounts.
     */
    "TooManySubAccounts": undefined;
    /**
     * No alias found for an account.
     */
    "NoAlias": undefined;
    /**
     * Account isn't found.
     */
    "NotFound": undefined;
    /**
     * Account isn't named.
     */
    "NotNamed": undefined;
    /**
     * Empty index.
     */
    "EmptyIndex": undefined;
    /**
     * Fee is changed.
     */
    "FeeChanged": undefined;
    /**
     * No identity found.
     */
    "NoIdentity": undefined;
    /**
     * Sticky judgement.
     */
    "StickyJudgement": undefined;
    /**
     * Judgement given.
     */
    "JudgementGiven": undefined;
    /**
     * Invalid judgement.
     */
    "InvalidJudgement": undefined;
    /**
     * The index is invalid.
     */
    "InvalidIndex": undefined;
    /**
     * The target is invalid.
     */
    "InvalidTarget": undefined;
    /**
     * Maximum amount of registrars reached. Cannot add any more.
     */
    "TooManyRegistrars": undefined;
    /**
     * Account ID is already named.
     */
    "AlreadyClaimed": undefined;
    /**
     * Username has already been reported.
     */
    "AlreadyReported": undefined;
    /**
     * Sender is not a sub-account.
     */
    "NotSub": undefined;
    /**
     * Sub-account isn't owned by sender.
     */
    "NotOwned": undefined;
    /**
     * The provided judgement was for a different identity.
     */
    "JudgementForDifferentIdentity": undefined;
    /**
     * Error that occurs when there is an issue paying for judgement.
     */
    "JudgementPaymentFailed": undefined;
    /**
     * The provided suffix is too long.
     */
    "InvalidSuffix": undefined;
    /**
     * The sender does not have permission to issue a username.
     */
    "NotUsernameAuthority": undefined;
    /**
     * The authority cannot allocate any more usernames.
     */
    "NoAllocation": undefined;
    /**
     * The signature on a username was not valid.
     */
    "InvalidSignature": undefined;
    /**
     * Setting this username requires a signature, but none was provided.
     */
    "RequiresSignature": undefined;
    /**
     * The username does not meet the requirements.
     */
    "InvalidUsername": undefined;
    /**
     * The username is already taken.
     */
    "UsernameTaken": undefined;
    /**
     * The requested username does not exist.
     */
    "NoUsername": undefined;
    /**
     * The reported username was not provided by the system.
     */
    "NotSystemProvidedUsername": undefined;
    /**
     * The username cannot be forcefully removed because it can still be accepted.
     */
    "NotExpired": undefined;
    /**
     * The username cannot be removed because it's still in the grace period.
     */
    "TooEarly": undefined;
    /**
     * The username cannot be removed because it is not unbinding.
     */
    "NotUnbinding": undefined;
    /**
     * The username cannot be unbound because it is already unbinding.
     */
    "AlreadyUnbinding": undefined;
    /**
     * The action cannot be performed because of insufficient privileges (e.g. authority
     * trying to unbind a username provided by the system).
     */
    "InsufficientPrivileges": undefined;
    /**
     * The context in which the alias was used is not supported.
     */
    "BadContext": undefined;
    /**
     * No associated request for the judgement received.
     */
    "UnexpectedJudgement": undefined;
    /**
     * The social credential is not supported by the configured identity information provider.
     */
    "NotSupported": undefined;
    /**
     * The person is banned and cannot perform the operation.
     */
    "Banned": undefined;
    /**
     * The person already has a personal identity associated with their alias.
     */
    "AlreadyRegistered": undefined;
    /**
     * The list of judgements ongoing on a personal identity is full.
     */
    "JudgementListFull": undefined;
    /**
     * The username has been reported too recently.
     */
    "LastUsernameReportTooRecent": undefined;
    /**
     * The username has been reported and is undergoing validity judgement.
     */
    "UsernameJudgementOngoing": undefined;
}>;
export type I7crjg7o7jiji6 = AnonymousEnum<{
    /**
     * The supplied identifier does not represent a person.
     */
    "NotPerson": undefined;
    /**
     * The given person has no associated key.
     */
    "NoKey": undefined;
    /**
     * The context is not a member of those allowed to have account aliases held.
     */
    "InvalidContext": undefined;
    /**
     * The account is not known.
     */
    "InvalidAccount": undefined;
    /**
     * The account is already in use under another alias.
     */
    "AccountInUse": undefined;
    /**
     * The proof is invalid.
     */
    "InvalidProof": undefined;
    /**
     * The signature is invalid.
     */
    "InvalidSignature": undefined;
    /**
     * There are not yet any members of our personhood set.
     */
    "NoMembers": undefined;
    /**
     * The root cannot be finalized as there are still unpushed members.
     */
    "Incomplete": undefined;
    /**
     * The root is still fresh.
     */
    "StillFresh": undefined;
    /**
     * Too many members have been pushed.
     */
    "TooManyMembers": undefined;
    /**
     * Key already in use by another person.
     */
    "KeyAlreadyInUse": undefined;
    /**
     * The old key was not found when expected.
     */
    "KeyNotFound": undefined;
    /**
     * Could not push member into the ring.
     */
    "CouldNotPush": undefined;
    /**
     * The record is already using this key.
     */
    "SameKey": undefined;
    /**
     * Personal Id was not reserved.
     */
    "PersonalIdNotReserved": undefined;
    /**
     * Personal Id has never been reserved.
     */
    "PersonalIdReservationCannotRenew": undefined;
    /**
     * Personal Id was not reserved or not already recognized.
     */
    "PersonalIdNotReservedOrNotRecognized": undefined;
    /**
     * Ring cannot be merged if it's the top ring.
     */
    "InvalidRing": undefined;
    /**
     * Ring cannot be built while there are suspensions pending.
     */
    "SuspensionsPending": undefined;
    /**
     * Ring cannot be merged if it's not below 1/2 capacity.
     */
    "RingAboveMergeThreshold": undefined;
    /**
     * Suspension indices provided are invalid.
     */
    "InvalidSuspensions": undefined;
    /**
     * An mutating action was queued when there was no mutation session in progress.
     */
    "NoMutationSession": undefined;
    /**
     * An mutating session could not be started.
     */
    "CouldNotStartMutationSession": undefined;
    /**
     * Cannot merge rings while a suspension session is in progress.
     */
    "SuspensionSessionInProgress": undefined;
    /**
     * The alias mapping is not stale.
     */
    "AliasNotStale": undefined;
    /**
     * Call is too late or too early.
     */
    "TimeOutOfRange": undefined;
    /**
     * Alias <-> Account is already set and up to date.
     */
    "AliasAccountAlreadySet": undefined;
    /**
     * Personhood cannot be resumed if it is not suspended.
     */
    "NotSuspended": undefined;
    /**
     * Personhood is suspended.
     */
    "Suspended": undefined;
    /**
     * Invalid state for attempted key migration.
     */
    "InvalidKeyMigration": undefined;
    /**
     * Invalid suspension of a key belonging to a person whose index in the ring has already
     * been included in the pending suspensions list.
     */
    "KeyAlreadySuspended": undefined;
    /**
     * The onboarding size must not exceed the maximum ring size.
     */
    "InvalidOnboardingSize": undefined;
    /**
     * The member key is not valid for the crypto.
     */
    "InvalidMemberKey": undefined;
    /**
     * The people collection has already been created.
     */
    "PeopleCollectionAlreadyExists": undefined;
    /**
     * The provided alias does not match the account's current alias mapping.
     */
    "AliasMismatch": undefined;
    /**
     * None of the supplied aliases were stale.
     */
    "NoStaleAliases": undefined;
}>;
export type I940ulmo4j2d84 = AnonymousEnum<{
    /**
     * The case does not exist.
     */
    "NoSuchCase": undefined;
    /**
     * The vote does not exist.
     */
    "NoSuchVote": undefined;
    /**
     * The case is not open.
     */
    "NotOpen": undefined;
    /**
     * The case is not ripe.
     */
    "NotRipe": undefined;
    /**
     * The case is not yet done.
     */
    "NotDone": undefined;
    /**
     * The decode of the call failed. Maybe there was a breaking runtime upgrade in between?
     */
    "CodecError": undefined;
    /**
     * The call failed to dispatch. Maybe there was a breaking runtime upgrade in between?
     */
    "DispatchError": undefined;
    /**
     * The case is too recent to be reaped.
     */
    "Recent": undefined;
    /**
     * Not enough credit to payout the rewards.
     */
    "NoCredit": undefined;
    /**
     * No mob credit distribution in place to reward voters.
     */
    "NoReward": undefined;
    /**
     * No points to be converted to mob credit.
     */
    "NoPoints": undefined;
    /**
     * Too many vote claims.
     */
    "TooManyClaims": undefined;
    /**
     * No payout in progress.
     */
    "NoPayout": undefined;
    /**
     * The point and/or credit arithmetic overflows.
     */
    "ArithmeticOverflow": undefined;
    /**
     * Too many payout round schedules.
     */
    "TooManySchedules": undefined;
    /**
     * No payout round schedule found.
     */
    "NoSchedule": undefined;
    /**
     * No vote penalty found.
     */
    "NoPenalty": undefined;
    /**
     * The vote penalty has not expired yet.
     */
    "Early": undefined;
    /**
     * The vote cannot be cast due to a voting penalty in effect.
     */
    "UnderPenalty": undefined;
    /**
     * The open case expiration is disabled due to insufficient active voters.
     */
    "CaseExpirationDisabled": undefined;
}>;
export type Icouc1975ac8ae = AnonymousEnum<{
    /**
     * Account is already applying to make a proof-of-ink.
     */
    "InProgress": undefined;
    /**
     * Account has not been referred.
     */
    "NoReferral": undefined;
    /**
     * The callback context is invalid; this should never happen.
     */
    "BadContext": undefined;
    /**
     * The incoming judgement ID is not what we were expecting for the account.
     */
    "UnexpectedJudgement": undefined;
    /**
     * No arguments were supplied with the judgement.
     */
    "NoArgs": undefined;
    /**
     * The account has not applied to make a proof-of-ink.
     */
    "NotApplied": undefined;
    /**
     * The candidate has not committed to a design.
     */
    "NotSelected": undefined;
    /**
     * The candidate did not prove themselves yet.
     */
    "NotProven": undefined;
    /**
     * The candidate has already started their judgement.
     */
    "AlreadyStarted": undefined;
    /**
     * The personal ID is not in range.
     */
    "OutOfRange": undefined;
    /**
     * The personal ID has already been taken.
     */
    "AlreadyTaken": undefined;
    /**
     * The person has no more referrals left to give.
     */
    "NoMoreReferrals": undefined;
    /**
     * The reroll is too early.
     */
    "TooEarly": undefined;
    /**
     * The referrer's design is not procedural.
     */
    "DesignInvalid": undefined;
    /**
     * The referrer's design is already taken.
     */
    "DesignTaken": undefined;
    /**
     * The referrer doesn't appear to be a person. This should never happen.
     */
    "BadParent": undefined;
    /**
     * The design family doesn't exist.
     */
    "BadFamily": undefined;
    /**
     * The design family is invalid for this choice.
     */
    "WrongFamily": undefined;
    /**
     * The index of the design or variant is beyond the allowed maximum for the family.
     */
    "IndexTooBig": undefined;
    /**
     * The system is busy with too many commitments; try again later.
     */
    "Busy": undefined;
    /**
     * The person has been banned from referring.
     */
    "Banned": undefined;
    /**
     * The candidate has not demonstrated probably through the initial evidence.
     */
    "Improbable": undefined;
    /**
     * The personal identity has already been reserved.
     */
    "IdReserved": undefined;
    /**
     * The personal identity is already taken by a proven person.
     */
    "IdUsed": undefined;
    /**
     * The ticket provided is invalid.
     */
    "InvalidTicket": undefined;
    /**
     * The caller has not provided a referral or invitation ticket.
     */
    "NoTicket": undefined;
    /**
     * The account is not authorized to do this.
     */
    "NotAuthorized": undefined;
    /**
     * The personal identity doesn't exist.
     */
    "NotPerson": undefined;
    /**
     * The candidate is referred. But the operation requires the candidate to not be referred.
     */
    "ReferredCandidate": undefined;
    /**
     * The candidate is not referred. But the operation requires the candidate to be referred.
     */
    "NotReferredCandidate": undefined;
    /**
     * There is no referral reward to register.
     */
    "NoRewardToRegister": undefined;
    /**
     * There is a pending referral reward that must be registered first.
     */
    "RewardToRegister": undefined;
    /**
     * No inviter found.
     */
    "NoInviter": undefined;
    /**
     * Invalid signature.
     */
    "InvalidSignature": undefined;
    /**
     * No invite available.
     */
    "NoInvites": undefined;
    /**
     * Invite is already set.
     */
    "AlreadyInvited": undefined;
    /**
     * The referrer is not a person.
     */
    "NoReferrer": undefined;
    /**
     * The individual is not a person recognized by proof of ink.
     */
    "NotPoiPerson": undefined;
    /**
     * The proof of ownership is invalid.
     */
    "InvalidProofOfOwnership": undefined;
    /**
     * The reimbursement values are invalid.
     */
    "InvalidReimbursementValues": undefined;
}>;
export type Ic64qv46c45g50 = AnonymousEnum<{
    /**
     * Game ongoing.
     */
    "GameOngoing": undefined;
    /**
     * No registration phase ongoing.
     */
    "NoRegistration": undefined;
    /**
     * The setup is outdated.
     */
    "OutdatedGameSetup": undefined;
    /**
     * Invalid setup.
     */
    "InvalidGameSetup": undefined;
    /**
     * Invalid report.
     */
    "InvalidReport": undefined;
    /**
     * No game ongoing.
     */
    "NoGame": undefined;
    /**
     * No report phase ongoing.
     */
    "NoReporting": undefined;
    /**
     * Not registered.
     */
    "NotRegistered": undefined;
    /**
     * Player already registered.
     */
    "AlreadyRegistered": undefined;
    /**
     * Report already sent.
     */
    "ReportAlreadySent": undefined;
    /**
     * Operation is not valid yet.
     */
    "Early": undefined;
    /**
     * The operation expect a player account.
     */
    "NotKickablePlayer": undefined;
    /**
     * No archived player found.
     */
    "NoArchivedPlayer": undefined;
    /**
     * No ticket found.
     */
    "NoTicket": undefined;
    /**
     * No invite available.
     */
    "NoInvites": undefined;
    /**
     * Invite is already set.
     */
    "AlreadyInvited": undefined;
    /**
     * Not an account based player, expected an account based player.
     */
    "NotAccountPlayer": undefined;
    /**
     * The player can't use an invite if already playing.
     */
    "UseInviteButAlreadyPlaying": undefined;
    /**
     * The number of existing schedules and new schedules exceeds the configured limit.
     */
    "TooManyGameSchedules": undefined;
    /**
     * The game that was supposed to be removed was not found in scheduled games.
     */
    "NoSuchGameScheduled": undefined;
    /**
     * The statement account signature is invalid.
     */
    "InvalidStatementAccountSignature": undefined;
    /**
     * The statement account is already in used by another player.
     */
    "StatementAccountAlreadyInUse": undefined;
    /**
     * Internal error invalid state.
     */
    "InternalErrorInvalidState": undefined;
    /**
     * The operation cannot be performed in the current game state.
     */
    "InvalidGameState": undefined;
    /**
     * No player found.
     */
    "NoPlayer": undefined;
    /**
     * The player cannot offboard while registered for a game.
     */
    "CannotOffboardWhileRegisteredForGame": undefined;
    /**
     * Invalid state
     */
    "InvalidState": undefined;
    /**
     * `set_play_deposit`: the supplied amount must be non-zero.
     */
    "InvalidPlayDeposit": undefined;
    "InvalidAirdropVrfVariantForAccount": undefined;
    "InvalidAirdropVrfVariantForRecognition": undefined;
    /**
     * `claim_airdrop`: the claimant is not recognized in pallet-score, or their most recent
     * attended game does not match the `game_index` of the airdrop.
     */
    "NotEligibleForAirdrop": undefined;
}>;
export type I1e55cbho6hjcq = AnonymousEnum<{
    /**
     * The calling origin is not a person.
     */
    "NotPerson": undefined;
    /**
     * The person didn't reach personhood.
     */
    "HasNotReachedPersonhood": undefined;
    /**
     * No reward available.
     */
    "NoReward": undefined;
    /**
     * The person has no associated score.
     */
    "NoScore": undefined;
    /**
     * No payout schedule available.
     */
    "NoSchedule": undefined;
    /**
     * Too many payout schedules already registered.
     */
    "TooManySchedules": undefined;
    /**
     * The participant is recognized or has been recognized as a person.
     */
    "Recognized": undefined;
    /**
     * The participant has already cashed out in this era.
     */
    "CashOutCooldown": undefined;
    /**
     * The round is on going or no schedule.
     */
    "RoundOnGoingOrNoSchedule": undefined;
    /**
     * The payout round has not started.
     */
    "NoRound": undefined;
    /**
     * The origin is neither a person nor a signed account.
     */
    "BadOriginNotPersonNotSigned": undefined;
    /**
     * The origin is neither a person nor a signed account nor an account participant.
     */
    "BadOriginNotPersonNotSignedNotAccountParticipant": undefined;
    /**
     * The origin is neither a signed account nor an account participant.
     */
    "BadOriginNotSignedNotAccountParticipant": undefined;
    /**
     * The participant is already participating.
     */
    "AlreadyParticipating": undefined;
    /**
     * The key must be provided.
     */
    "KeyMustBeProvided": undefined;
    /**
     * The key must not be provided.
     */
    "KeyMustNotBeProvided": undefined;
    /**
     * Has reached personhood in the past.
     */
    "HasReachedPersonhood": undefined;
    /**
     * The proof of ownership is invalid.
     */
    "InvalidProofOfOwnership": undefined;
    /**
     * An absence grace tier has a window exceeding the maximum trackable history (8).
     */
    "WindowTooLarge": undefined;
    /**
     * The allowed misses must be strictly less than the window (or both zero).
     */
    "AllowedMissesTooLarge": undefined;
    /**
     * Absence-grace tiers must be sorted by ascending `population_size_threshold`.
     */
    "AbsenceScheduleNotSorted": undefined;
    /**
     * The personhood-threshold schedule must contain at least one tier.
     */
    "PersonhoodScheduleEmpty": undefined;
    /**
     * A personhood-threshold tier has `score_threshold == 0`.
     */
    "PersonhoodScoreThresholdZero": undefined;
    /**
     * A personhood-threshold tier exceeds `MAX_PERSONHOOD_THRESHOLD`.
     */
    "PersonhoodScoreThresholdTooLarge": undefined;
    /**
     * Personhood-threshold tiers must be sorted by ascending
     * `population_size_threshold`.
     */
    "PersonhoodScheduleNotSorted": undefined;
    /**
     * Personhood-threshold `score_threshold` values must be non-decreasing
     * across tiers (a larger population must not have a lower bar).
     */
    "PersonhoodScheduleNotMonotonic": undefined;
    /**
     * The last personhood-threshold tier must cover all populations
     * (`population_size_threshold == u32::MAX`).
     */
    "PersonhoodScheduleNotTotal": undefined;
}>;
export type I4dumqe8b5q0ce = AnonymousEnum<{
    /**
     * The personal ID does not belong to a recognized person.
     */
    "NotPerson": undefined;
    /**
     * The personal ID does not belong to a suspended person.
     */
    "NotSuspended": undefined;
    /**
     * The personal ID is not reserved and awaiting recognition.
     */
    "NotReserved": undefined;
    /**
     * The operation does not support this many people.
     */
    "TooManyPeople": undefined;
}>;
export type I3tva1ioru4b0 = AnonymousEnum<{
    /**
     * No attestation allowance.
     */
    "NoAttestationAllowance": undefined;
    /**
     * The signature created by the candidate's account is invalid.
     */
    "InvalidAttestationSignature": undefined;
    /**
     * The signature created by the candidate's ring vrf key is invalid.
     */
    "InvalidProofOfOwnership": undefined;
    /**
     * The candidate is already registered.
     */
    "AlreadyRegistered": undefined;
    /**
     * The ring VRF key is already enrolled by another lite person.
     */
    "KeyAlreadyInUse": undefined;
    /**
     * The account is already in use.
     */
    "AccountInUse": undefined;
    /**
     * The alias <-> account mapping is already set and current.
     */
    "AliasAccountAlreadySet": undefined;
    /**
     * The alias <-> account mapping is not set.
     */
    "AliasAccountNotSet": undefined;
    /**
     * The requested alias setup block window is invalid for the current block.
     */
    "CallBlockOutOfRange": undefined;
    /**
     * The alias context is invalid.
     */
    "InvalidAliasContext": undefined;
    /**
     * The lite people member collection has not been initialized yet.
     */
    "LitePeopleCollectionNotCreated": undefined;
}>;
export type I3lcis8epk78u = AnonymousEnum<{
    /**
     * Username does not fit the requirements.
     */
    "InvalidUsername": undefined;
    /**
     * Username is already taken.
     */
    "UsernameTaken": undefined;
    /**
     * Consumer is already registered.
     */
    "AlreadyRegistered": undefined;
    /**
     * Provided proof of ownership is invalid.
     */
    "InvalidProofOfOwnership": undefined;
    /**
     * Person is not registered as a consumer.
     */
    "NotRegistered": undefined;
    /**
     * Consumer is not a full person.
     */
    "NotFullPerson": undefined;
    /**
     * Attempted to update person authorization too early.
     */
    "TouchNotReady": undefined;
    /**
     * Reservation is not active.
     */
    "NoReservation": undefined;
    /**
     * The linked lite identity is not the active holder of the reservation.
     */
    "NotReservationHolder": undefined;
    /**
     * The username in the reservation request is already taken.
     */
    "UsernameReservationTaken": undefined;
    /**
     * The reservation has not expired.
     */
    "ReservationFresh": undefined;
    /**
     * There is no lite consumer to be linked.
     */
    "NoLinkedIdentity": undefined;
    /**
     * The lite consumer is already linked to a full person consumer.
     */
    "AlreadyLinked": undefined;
    /**
     * The person's authorization has not expired yet.
     */
    "PersonAuthNotExpired": undefined;
    /**
     * The person has already been demoted.
     */
    "AlreadyDemoted": undefined;
    /**
     * Queue for this username is full.
     */
    "QueueFull": undefined;
    /**
     * Account is not in the queue for this username.
     */
    "NotInQueue": undefined;
    /**
     * Account already has a reservation for another username.
     */
    "AlreadyHasReservation": undefined;
    /**
     * Friend request sequence is invalid for the consumer.
     */
    "InvalidFriendRequestSequence": undefined;
    /**
     * Friend request period is not the current period.
     */
    "InvalidFriendRequestPeriod": undefined;
    /**
     * Friend request registration is not expired yet.
     */
    "FriendRequestRegistrationNotExpired": undefined;
    /**
     * Friend request registration already exists for the alias/context.
     */
    "FriendRequestRegistrationAlreadyExists": undefined;
    /**
     * The replacement cooldown has not elapsed since the entry was last set.
     */
    "StmtStoreReplacementTooEarly": undefined;
    /**
     * The provided `limit` exceeds `LongTermStorageCleanupLimit`.
     */
    "LongTermStorageCleanupLimitExceeded": undefined;
}>;
export type I81gtj1f3ennke = AnonymousEnum<{
    /**
     * The requested chunk index doesn't exist.
     */
    "ChunkNotFound": undefined;
    /**
     * The provided chunk data couldn't be decoded.
     */
    "InvalidChunks": undefined;
    /**
     * The start index isn't strictly less than the end index.
     */
    "InvalidChunkRange": undefined;
}>;
export type Idecbp1bqjv3s9 = AnonymousEnum<{
    /**
     * The supplied identifier does not represent a member.
     */
    "NotMember": undefined;
    /**
     * Ring has no root.
     */
    "NoRoot": undefined;
    /**
     * The proof is invalid.
     */
    "InvalidProof": undefined;
    /**
     * The root cannot be finalized as there are still unpushed members.
     */
    "Incomplete": undefined;
    /**
     * Too many members have been pushed.
     */
    "TooManyMembers": undefined;
    /**
     * Key already in use by another member.
     */
    "KeyAlreadyInUse": undefined;
    /**
     * The old key was not found when expected.
     */
    "KeyNotFound": undefined;
    /**
     * Could not push member into the ring.
     */
    "CouldNotPush": undefined;
    /**
     * Ring cannot be merged if it's the top ring.
     */
    "InvalidRing": undefined;
    /**
     * Ring cannot be built while there are suspensions pending.
     */
    "SuspensionsPending": undefined;
    /**
     * Ring cannot be merged if it's not below 1/2 capacity.
     */
    "RingAboveMergeThreshold": undefined;
    /**
     * Suspension indices provided are invalid.
     */
    "InvalidSuspensions": undefined;
    /**
     * A mutating action was queued when there was no removal session in progress.
     */
    "NoRemovalSession": undefined;
    /**
     * A removal session could not be started.
     */
    "CouldNotStartRemovalSession": undefined;
    /**
     * Cannot merge rings while a removal session is in progress.
     */
    "RemovalSessionInProgress": undefined;
    /**
     * Invalid suspension of a key belonging to a member whose index in the ring has already
     * been included in the pending suspensions list.
     */
    "KeyAlreadySuspended": undefined;
    /**
     * The onboarding size must not exceed the maximum ring size.
     */
    "InvalidOnboardingSize": undefined;
    /**
     * The member key is not valid for the crypto.
     */
    "InvalidMemberKey": undefined;
    /**
     * The collection does not exist.
     */
    "CollectionNotFound": undefined;
    /**
     * The collection already exists.
     */
    "CollectionAlreadyExists": undefined;
    /**
     * Too many collections for this owner.
     */
    "TooManyCollections": undefined;
    /**
     * Flexible collections must use the MaxFlexibleRingExponent ring size.
     */
    "InvalidRingSizeForFlexible": undefined;
    /**
     * The ring exponent is not supported.
     */
    "InvalidRingExponent": undefined;
    /**
     * Insufficient members in the queue to onboard.
     */
    "PrematureOnboarding": undefined;
    /**
     * The collection is marked for deletion and cannot be modified.
     */
    "CollectionMarkedForDeletion": undefined;
    /**
     * The caller is not the owner of the collection.
     */
    "NotCollectionOwner": undefined;
    /**
     * The member is not in the onboarding queue.
     */
    "NotOnboarding": undefined;
    /**
     * There is no ring root to build.
     */
    "NothingToBuild": undefined;
}>;
export type Ic1dr90c79fbnh = AnonymousEnum<{
    "MemberKeyAlreadyUsed": undefined;
    "InvalidMemberKey": undefined;
    "InternalError": undefined;
    "RecyclerAlreadyUnloaded": undefined;
    "InvalidConsolidation": undefined;
    "ConsolidationTooBig": undefined;
    "CoinValueTooBig": undefined;
    "CoinValueTooSmall": undefined;
    "CoinValueIsLessThanFee": undefined;
    "CoinValueOutOfBound": undefined;
    /**
     * The coin value cannot be losslessly converted to an asset amount because
     * `UnderlyingAssetUnit` is not evenly divisible by `2^|value|`.
     */
    "LossyCoinValueConversion": undefined;
    "InvalidAliasProof": undefined;
    "NoUnloadingRecycler": undefined;
    "ProofAndAliasMismatch": undefined;
    "NothingToBuild": undefined;
    "TooManyRings": undefined;
    "AddressAlreadyHasCoin": undefined;
    "InvalidProofOfOwnership": undefined;
    "EmptyInputs": undefined;
    /**
     * The fee recycler in the origin does not match the call's recycler.
     */
    "RecyclerMismatch": undefined;
    /**
     * The total unloaded amount is less than the fee.
     */
    "InsufficientUnloadForFee": undefined;
    /**
     * The first alias was not pre-marked by extension (required for FromOutput fee).
     */
    "AliasNotPremarked": undefined;
    /**
     * The recycler revision does not match (recycler may not exist or has been rebuilt).
     */
    "InvalidRecyclerRevision": undefined;
    "InvalidSplit": undefined;
    /**
     * This operation requires a fresh coin (`age == 0`).
     */
    "FreshCoinRequired": undefined;
    "CannotConvertNativeToAsset": undefined;
    /**
     * When using Prepaid fee mode, max_fee must be 0.
     */
    "MaxFeeNotAllowedForPrepaid": undefined;
    /**
     * The max_fee exceeds the total input value.
     */
    "MaxFeeExceedsInput": undefined;
    /**
     * The max fee argument doesn't satisfy the requirements.
     */
    "InvalidMaxFee": undefined;
    /**
     * The recycler collection does not exist and could not be created on-demand.
     */
    "CannotCreateRecyclerCollection": undefined;
    /**
     * The underlying asset id has not been set yet.
     */
    "AssetIdNotSet": undefined;
    /**
     * The underlying asset id has already been set and cannot be changed.
     */
    "AssetIdAlreadySet": undefined;
    /**
     * The proposed underlying asset id does not exist in [`Config::Fungibles`].
     */
    "UnknownAsset": undefined;
}>;
export type Id2ueql1n8r6lh = AnonymousEnum<{
    /**
     * Subscriber not found.
     */
    "SubscriberNotFound": undefined;
    /**
     * Subscriber already exists.
     */
    "AlreadySubscribed": undefined;
    /**
     * Maximum subscribers reached.
     */
    "TooManySubscribers": undefined;
    /**
     * Collections list must be sorted in strictly ascending order with no duplicates.
     */
    "InvalidCollectionsList": undefined;
    /**
     * Too many ring root updates to fit in a single batch.
     */
    "TooManyUpdates": undefined;
    /**
     * XCM send failed.
     */
    "XcmSendFailed": undefined;
    /**
     * Subscriber is not subscribed to the requested collection.
     */
    "NotSubscribedToCollection": undefined;
    /**
     * Ring root index is out of range.
     */
    "InvalidRingIndex": undefined;
    /**
     * Requested updates exceed the subscriber's HRMP channel capacity.
     */
    "ExceedsChannelCapacity": undefined;
    /**
     * No active batch exists.
     */
    "NoBatchActive": undefined;
    /**
     * No pending initialization for this subscriber.
     */
    "NoPendingInit": undefined;
    /**
     * Replay cooldown has not elapsed for this subscriber and collection.
     */
    "ReplayCooldownActive": undefined;
    /**
     * Replay requested with an empty list of ring root indices.
     */
    "EmptyRingIndices": undefined;
}>;
export type I37f79uio94b2l = AnonymousEnum<{
    "PrizeBelowMinBalance": undefined;
    "NoWinnersConfigured": undefined;
    "TooManyWinners": undefined;
    "InvalidEventTimes": undefined;
    "DuplicateEventId": undefined;
    "NoScheduledEvent": undefined;
    "UnknownEvent": undefined;
    /**
     * Operation requires a specific status the event isn't in.
     */
    "WrongStatus": undefined;
    "NotAcceptingRegistrations": undefined;
    "NotClaiming": undefined;
    /**
     * Claim attempted after the event's `end_time`.
     */
    "ClaimingWindowClosed": undefined;
    "EntropySlotTaken": undefined;
    "InvalidVrfProof": undefined;
    /**
     * Supplied account id does not correspond to any sr25519 public key.
     */
    "UnsupportedAccountKey": undefined;
    "InvalidMembershipProof": undefined;
    "NoSuchWinner": undefined;
    "ParticipantOverflow": undefined;
    "PrizeAllocationOverflow": undefined;
    /**
     * The prize asset has not been enabled via `enable_asset`.
     */
    "AssetNotEnabled": undefined;
    /**
     * `enable_asset` was called for an asset that is already enabled.
     */
    "AssetAlreadyEnabled": undefined;
}>;
export type Ib7pa0cea24q4v = AnonymousEnum<{
    /**
     * Arithmetic error like over/underflow, division by zero or similar.
     */
    "Arithmetic": undefined;
    /**
     * There is already a vote by the same voter for the same subject.
     */
    "SubjectAlreadyVoted": undefined;
    /**
     * The provided ring proof failed verification.
     */
    "InvalidProof": undefined;
}>;
export type Iaaqq5jevtahm8 = AnonymousEnum<{
    /**
     * The operation cannot complete since some MBMs are ongoing.
     */
    "Ongoing": undefined;
}>;
export type TokenError = Enum<{
    "FundsUnavailable": undefined;
    "OnlyProvider": undefined;
    "BelowMinimum": undefined;
    "CannotCreate": undefined;
    "UnknownAsset": undefined;
    "Frozen": undefined;
    "Unsupported": undefined;
    "CannotCreateHold": undefined;
    "NotExpendable": undefined;
    "Blocked": undefined;
}>;
export declare const TokenError: GetEnum<TokenError>;
export type ArithmeticError = Enum<{
    "Underflow": undefined;
    "Overflow": undefined;
    "DivisionByZero": undefined;
}>;
export declare const ArithmeticError: GetEnum<ArithmeticError>;
export type TransactionalError = Enum<{
    "LimitReached": undefined;
    "NoLayer": undefined;
}>;
export declare const TransactionalError: GetEnum<TransactionalError>;
export type Idh4cj79bvroj8 = AnonymousEnum<{
    "InvalidStateRoot": undefined;
    "IncompleteDatabase": undefined;
    "ValueAtIncompleteKey": undefined;
    "DecoderError": undefined;
    "InvalidHash": undefined;
    "DuplicateKey": undefined;
    "ExtraneousNode": undefined;
    "ExtraneousValue": undefined;
    "ExtraneousHashReference": undefined;
    "InvalidChildReference": undefined;
    "ValueMismatch": undefined;
    "IncompleteProof": undefined;
    "RootMismatch": undefined;
    "DecodeError": undefined;
}>;
export type I1jm8m1rh9e20v = {
    "hash": SizedHex<32>;
};
export type Icbccs0ug47ilf = {
    "account": SS58String;
};
export type I855j4i3kr8ko1 = {
    "sender": SS58String;
    "hash": SizedHex<32>;
};
export type Ibgl04rn6nbfm6 = {
    "code_hash": SizedHex<32>;
    "check_version": boolean;
};
export type I1dfctsnhih1bs = {
    "code_hash": SizedHex<32>;
    "error": Anonymize<I8rjgvnsb8ltnm>;
};
export type Icbsekf57miplo = AnonymousEnum<{
    /**
     * The validation function has been scheduled to apply.
     */
    "ValidationFunctionStored": undefined;
    /**
     * The validation function was applied as of the contained relay chain block number.
     */
    "ValidationFunctionApplied": Anonymize<Idd7hd99u0ho0n>;
    /**
     * The relay-chain aborted the upgrade process.
     */
    "ValidationFunctionDiscarded": undefined;
    /**
     * Some downward messages have been received and will be processed.
     */
    "DownwardMessagesReceived": Anonymize<Iafscmv8tjf0ou>;
    /**
     * Downward messages were processed using the given weight.
     */
    "DownwardMessagesProcessed": Anonymize<I100l07kaehdlp>;
    /**
     * An upward message was sent to the relay chain.
     */
    "UpwardMessageSent": Anonymize<I6gnbnvip5vvdi>;
}>;
export type Idd7hd99u0ho0n = {
    "relay_chain_block_num": number;
};
export type Iafscmv8tjf0ou = {
    "count": number;
};
export type I100l07kaehdlp = {
    "weight_used": Anonymize<I4q39t5hn830vp>;
    "dmq_head": SizedHex<32>;
};
export type I6gnbnvip5vvdi = {
    "message_hash"?: Anonymize<I4s6vifaf8k998>;
};
export type I4s6vifaf8k998 = (SizedHex<32>) | undefined;
export type I4c6hinnlgm6m = AnonymousEnum<{
    /**
     * An account was created with some free balance.
     */
    "Endowed": Anonymize<Icv68aq8841478>;
    /**
     * An account was removed whose balance was non-zero but below ExistentialDeposit,
     * resulting in an outright loss.
     */
    "DustLost": Anonymize<Ic262ibdoec56a>;
    /**
     * Transfer succeeded.
     */
    "Transfer": Anonymize<Iflcfm9b6nlmdd>;
    /**
     * A balance was set by root.
     */
    "BalanceSet": Anonymize<Ijrsf4mnp3eka>;
    /**
     * Some balance was reserved (moved from free to reserved).
     */
    "Reserved": Anonymize<Id5fm4p8lj5qgi>;
    /**
     * Some balance was unreserved (moved from reserved to free).
     */
    "Unreserved": Anonymize<Id5fm4p8lj5qgi>;
    /**
     * Some balance was moved from the reserve of the first account to the second account.
     * Final argument indicates the destination balance type.
     */
    "ReserveRepatriated": Anonymize<I8tjvj9uq4b7hi>;
    /**
     * Some amount was deposited (e.g. for transaction fees).
     */
    "Deposit": Anonymize<Id5fm4p8lj5qgi>;
    /**
     * Some amount was withdrawn from the account (e.g. for transaction fees).
     */
    "Withdraw": Anonymize<Id5fm4p8lj5qgi>;
    /**
     * Some amount was removed from the account (e.g. for misbehavior).
     */
    "Slashed": Anonymize<Id5fm4p8lj5qgi>;
    /**
     * Some amount was minted into an account.
     */
    "Minted": Anonymize<Id5fm4p8lj5qgi>;
    /**
     * Some credit was balanced and added to the TotalIssuance.
     */
    "MintedCredit": Anonymize<I3qt1hgg4djhgb>;
    /**
     * Some amount was burned from an account.
     */
    "Burned": Anonymize<Id5fm4p8lj5qgi>;
    /**
     * Some debt has been dropped from the Total Issuance.
     */
    "BurnedDebt": Anonymize<I3qt1hgg4djhgb>;
    /**
     * Some amount was suspended from an account (it can be restored later).
     */
    "Suspended": Anonymize<Id5fm4p8lj5qgi>;
    /**
     * Some amount was restored into an account.
     */
    "Restored": Anonymize<Id5fm4p8lj5qgi>;
    /**
     * An account was upgraded.
     */
    "Upgraded": Anonymize<I4cbvqmqadhrea>;
    /**
     * Total issuance was increased by `amount`, creating a credit to be balanced.
     */
    "Issued": Anonymize<I3qt1hgg4djhgb>;
    /**
     * Total issuance was decreased by `amount`, creating a debt to be balanced.
     */
    "Rescinded": Anonymize<I3qt1hgg4djhgb>;
    /**
     * Some balance was locked.
     */
    "Locked": Anonymize<Id5fm4p8lj5qgi>;
    /**
     * Some balance was unlocked.
     */
    "Unlocked": Anonymize<Id5fm4p8lj5qgi>;
    /**
     * Some balance was frozen.
     */
    "Frozen": Anonymize<Id5fm4p8lj5qgi>;
    /**
     * Some balance was thawed.
     */
    "Thawed": Anonymize<Id5fm4p8lj5qgi>;
    /**
     * The `TotalIssuance` was forcefully changed.
     */
    "TotalIssuanceForced": Anonymize<I4fooe9dun9o0t>;
    /**
     * Some balance was placed on hold.
     */
    "Held": Anonymize<I4t941tu6n95pd>;
    /**
     * Held balance was burned from an account.
     */
    "BurnedHeld": Anonymize<I4t941tu6n95pd>;
    /**
     * A transfer of `amount` on hold from `source` to `dest` was initiated.
     */
    "TransferOnHold": Anonymize<I7a812tlv1a711>;
    /**
     * The `transferred` balance is placed on hold at the `dest` account.
     */
    "TransferAndHold": Anonymize<I3osgdo4c94kio>;
    /**
     * Some balance was released from hold.
     */
    "Released": Anonymize<I4t941tu6n95pd>;
    /**
     * An unexpected/defensive event was triggered.
     */
    "Unexpected": Anonymize<Iph9c4rn81ub2>;
}>;
export type Icv68aq8841478 = {
    "account": SS58String;
    "free_balance": bigint;
};
export type Ic262ibdoec56a = {
    "account": SS58String;
    "amount": bigint;
};
export type Iflcfm9b6nlmdd = {
    "from": SS58String;
    "to": SS58String;
    "amount": bigint;
};
export type Ijrsf4mnp3eka = {
    "who": SS58String;
    "free": bigint;
};
export type Id5fm4p8lj5qgi = {
    "who": SS58String;
    "amount": bigint;
};
export type I8tjvj9uq4b7hi = {
    "from": SS58String;
    "to": SS58String;
    "amount": bigint;
    "destination_status": BalanceStatus;
};
export type BalanceStatus = Enum<{
    "Free": undefined;
    "Reserved": undefined;
}>;
export declare const BalanceStatus: GetEnum<BalanceStatus>;
export type I3qt1hgg4djhgb = {
    "amount": bigint;
};
export type I4cbvqmqadhrea = {
    "who": SS58String;
};
export type I4fooe9dun9o0t = {
    "old": bigint;
    "new": bigint;
};
export type I4t941tu6n95pd = {
    "reason": Anonymize<I7sdoogtdsfine>;
    "who": SS58String;
    "amount": bigint;
};
export type I7sdoogtdsfine = AnonymousEnum<{
    "Session": Anonymize<I6bkr3dqv753nc>;
    "PolkadotXcm": Anonymize<Ideiof6273rsoe>;
    "MobRule": Enum<{
        "Payout": undefined;
        "Credit": undefined;
    }>;
    "ProofOfInk": Enum<{
        "ProofOfInk": undefined;
    }>;
    "Game": Enum<{
        "PlayDeposit": undefined;
    }>;
    "Score": Enum<{
        "Payout": undefined;
        "Credit": undefined;
    }>;
    "Coinage": Enum<{
        "Wrapped": undefined;
    }>;
    "Airdrop": Enum<{
        "Airdrop": undefined;
    }>;
}>;
export type I6bkr3dqv753nc = AnonymousEnum<{
    "Keys": undefined;
}>;
export type Ideiof6273rsoe = AnonymousEnum<{
    "AuthorizeAlias": undefined;
}>;
export type I7a812tlv1a711 = {
    "reason": Anonymize<I7sdoogtdsfine>;
    "source": SS58String;
    "dest": SS58String;
    "amount": bigint;
};
export type I3osgdo4c94kio = {
    "reason": Anonymize<I7sdoogtdsfine>;
    "source": SS58String;
    "dest": SS58String;
    "transferred": bigint;
};
export type Iph9c4rn81ub2 = AnonymousEnum<{
    "BalanceUpdated": undefined;
    "FailedToMutateAccount": undefined;
}>;
export type TransactionPaymentEvent = Enum<{
    /**
     * A transaction fee `actual_fee`, of which `tip` was added to the minimum inclusion fee,
     * has been paid by `who`.
     */
    "TransactionFeePaid": Anonymize<Ier2cke86dqbr2>;
}>;
export declare const TransactionPaymentEvent: GetEnum<TransactionPaymentEvent>;
export type Ier2cke86dqbr2 = {
    "who": SS58String;
    "actual_fee": bigint;
    "tip": bigint;
};
export type I8g774vc9t4tf1 = AnonymousEnum<{
    /**
     * A transaction fee was skipped.
     */
    "FeeSkipped": Anonymize<Ia19q5nd942d8c>;
}>;
export type Ia19q5nd942d8c = {
    "origin": Anonymize<I2vjn8o312puvk>;
};
export type I2vjn8o312puvk = AnonymousEnum<{
    "system": Anonymize<I9gqitj4t615g3>;
    "PolkadotXcm": Anonymize<Icvilmd7qu30i4>;
    "CumulusXcm": Anonymize<I3in0d0lb61qi8>;
    "People": Enum<{
        "PersonalIdentity": bigint;
        "PersonalAlias": Anonymize<I6vki5ip88t309>;
    }>;
    "ProofOfInk": Enum<{
        "AuthorizedApplyWithSig": SS58String;
        "ReferredCandidate": SS58String;
        "InvitedCandidate": SS58String;
    }>;
    "Game": Enum<{
        "Invited": SS58String;
    }>;
    "Score": Enum<{
        "AccountParticipant": SS58String;
    }>;
    "PeopleLite": Enum<{
        "LitePerson": SS58String;
        "LiteAlias": Anonymize<I6vki5ip88t309>;
    }>;
    "Resources": Enum<{
        "FriendRequestAlias": SizedHex<32>;
        "StmtStoreAlias": SizedHex<32>;
        "LongTermStorageClaim": [SizedHex<32>, Anonymize<I7fnmgdak2nuqf>];
    }>;
    "Members": Enum<{
        "MemberAlias": [SizedHex<32>, Anonymize<I6vki5ip88t309>];
        "SelfInclude": SizedHex<32>;
    }>;
    "Coinage": Enum<{
        "Coin": {
            "coin_id": SS58String;
            "coin": Anonymize<I6sjgjftjavcbd>;
        };
        "UnloadToken": {
            "alias_proofs": Anonymize<Itom7fk49o0c9>;
            "proven_msg": SizedHex<32>;
            "fee": Enum<{
                "Prepaid": undefined;
                "FromOutput": {
                    "fee_recycler_value": number;
                    "fee_recycler_index": number;
                };
            }>;
        };
        "InfallibleUnpaidSigned": Anonymize<I4cbvqmqadhrea>;
    }>;
    "Honour": Enum<{
        "Voter": {
            "aliases": {
                "subject_alias": SizedHex<32>;
                "point_alias": SizedHex<32>;
            };
        };
    }>;
}>;
export type I9gqitj4t615g3 = AnonymousEnum<{
    "Root": undefined;
    "Signed": SS58String;
    "None": undefined;
    "Authorized": undefined;
}>;
export type Icvilmd7qu30i4 = AnonymousEnum<{
    "Xcm": Anonymize<If9iqq7i64mur8>;
    "Response": Anonymize<If9iqq7i64mur8>;
}>;
export type If9iqq7i64mur8 = {
    "parents": number;
    "interior": XcmV5Junctions;
};
export type XcmV5Junctions = Enum<{
    "Here": undefined;
    "X1": XcmV5Junction;
    "X2": FixedSizeArray<2, XcmV5Junction>;
    "X3": FixedSizeArray<3, XcmV5Junction>;
    "X4": FixedSizeArray<4, XcmV5Junction>;
    "X5": FixedSizeArray<5, XcmV5Junction>;
    "X6": FixedSizeArray<6, XcmV5Junction>;
    "X7": FixedSizeArray<7, XcmV5Junction>;
    "X8": FixedSizeArray<8, XcmV5Junction>;
}>;
export declare const XcmV5Junctions: GetEnum<XcmV5Junctions>;
export type XcmV5Junction = Enum<{
    "Parachain": number;
    "AccountId32": {
        "network"?: Anonymize<I97pd2rst02a7r>;
        "id": SizedHex<32>;
    };
    "AccountIndex64": {
        "network"?: Anonymize<I97pd2rst02a7r>;
        "index": bigint;
    };
    "AccountKey20": {
        "network"?: Anonymize<I97pd2rst02a7r>;
        "key": SizedHex<20>;
    };
    "PalletInstance": number;
    "GeneralIndex": bigint;
    "GeneralKey": Anonymize<I15lht6t53odo4>;
    "OnlyChild": undefined;
    "Plurality": Anonymize<I518fbtnclg1oc>;
    "GlobalConsensus": XcmV5NetworkId;
}>;
export declare const XcmV5Junction: GetEnum<XcmV5Junction>;
export type I97pd2rst02a7r = (XcmV5NetworkId) | undefined;
export type XcmV5NetworkId = Enum<{
    "ByGenesis": SizedHex<32>;
    "ByFork": Anonymize<I15vf5oinmcgps>;
    "Polkadot": undefined;
    "Kusama": undefined;
    "Ethereum": Anonymize<I623eo8t3jrbeo>;
    "BitcoinCore": undefined;
    "BitcoinCash": undefined;
    "PolkadotBulletin": undefined;
}>;
export declare const XcmV5NetworkId: GetEnum<XcmV5NetworkId>;
export type I15vf5oinmcgps = {
    "block_number": bigint;
    "block_hash": SizedHex<32>;
};
export type I623eo8t3jrbeo = {
    "chain_id": bigint;
};
export type I15lht6t53odo4 = {
    "length": number;
    "data": SizedHex<32>;
};
export type I518fbtnclg1oc = {
    "id": XcmV3JunctionBodyId;
    "part": XcmV2JunctionBodyPart;
};
export type XcmV3JunctionBodyId = Enum<{
    "Unit": undefined;
    "Moniker": SizedHex<4>;
    "Index": number;
    "Executive": undefined;
    "Technical": undefined;
    "Legislative": undefined;
    "Judicial": undefined;
    "Defense": undefined;
    "Administration": undefined;
    "Treasury": undefined;
}>;
export declare const XcmV3JunctionBodyId: GetEnum<XcmV3JunctionBodyId>;
export type XcmV2JunctionBodyPart = Enum<{
    "Voice": undefined;
    "Members": Anonymize<Iafscmv8tjf0ou>;
    "Fraction": {
        "nom": number;
        "denom": number;
    };
    "AtLeastProportion": {
        "nom": number;
        "denom": number;
    };
    "MoreThanProportion": {
        "nom": number;
        "denom": number;
    };
}>;
export declare const XcmV2JunctionBodyPart: GetEnum<XcmV2JunctionBodyPart>;
export type I3in0d0lb61qi8 = AnonymousEnum<{
    "Relay": undefined;
    "SiblingParachain": number;
}>;
export type I6vki5ip88t309 = {
    "revision": number;
    "ring": number;
    "ca": Anonymize<Icq9999ubti4jr>;
};
export type Icq9999ubti4jr = {
    "alias": SizedHex<32>;
    "context": SizedHex<32>;
};
export type I7fnmgdak2nuqf = AnonymousEnum<{
    "People": undefined;
    "LitePeople": undefined;
}>;
export type I6sjgjftjavcbd = {
    "value": number;
    "age": number;
};
export type Itom7fk49o0c9 = Array<Uint8Array>;
export type I2isv113mtlrp7 = AnonymousEnum<{
    /**
     * Usage for an entity is cleaned.
     */
    "UsageCleaned": Anonymize<Iea5hvin03frku>;
}>;
export type Iea5hvin03frku = {
    "entity": Anonymize<I8arc778cv9pqq>;
};
export type I8arc778cv9pqq = AnonymousEnum<{
    "PersonalAlias": SizedHex<32>;
    "PersonalIdentity": bigint;
    "ReferredCandidate": SS58String;
    "AccountParticipant": SS58String;
    "InvitedCandidate": SS58String;
    "LitePerson": SS58String;
}>;
export type I4nr69fhfof48s = AnonymousEnum<{
    /**
     * Some asset class was created.
     */
    "Created": Anonymize<Icqe266pmnr25o>;
    /**
     * Some assets were issued.
     */
    "Issued": Anonymize<I5hoiph0lqphp>;
    /**
     * Some assets were transferred.
     */
    "Transferred": Anonymize<I5k7oropl9ofc7>;
    /**
     * Some assets were destroyed.
     */
    "Burned": Anonymize<I48vagp1omigob>;
    /**
     * The management team changed.
     */
    "TeamChanged": Anonymize<Ib5tst4ppem1g6>;
    /**
     * The owner changed.
     */
    "OwnerChanged": Anonymize<Ibn64edsrg3737>;
    /**
     * Some account `who` was frozen.
     */
    "Frozen": Anonymize<I83r9d02dh47j9>;
    /**
     * Some account `who` was thawed.
     */
    "Thawed": Anonymize<I83r9d02dh47j9>;
    /**
     * Some asset `asset_id` was frozen.
     */
    "AssetFrozen": Anonymize<I22bm4d7re21j9>;
    /**
     * Some asset `asset_id` was thawed.
     */
    "AssetThawed": Anonymize<I22bm4d7re21j9>;
    /**
     * Accounts were destroyed for given asset.
     */
    "AccountsDestroyed": Anonymize<I3jnhifvaeuama>;
    /**
     * Approvals were destroyed for given asset.
     */
    "ApprovalsDestroyed": Anonymize<I8n1gia0lo42ok>;
    /**
     * An asset class is in the process of being destroyed.
     */
    "DestructionStarted": Anonymize<I22bm4d7re21j9>;
    /**
     * An asset class was destroyed.
     */
    "Destroyed": Anonymize<I22bm4d7re21j9>;
    /**
     * Some asset class was force-created.
     */
    "ForceCreated": Anonymize<Ibn64edsrg3737>;
    /**
     * New metadata has been set for an asset.
     */
    "MetadataSet": Anonymize<I6gb0o7lqjfdjq>;
    /**
     * Metadata has been cleared for an asset.
     */
    "MetadataCleared": Anonymize<I22bm4d7re21j9>;
    /**
     * (Additional) funds have been approved for transfer to a destination account.
     */
    "ApprovedTransfer": Anonymize<Idh36v6iegkmpq>;
    /**
     * An approval for account `delegate` was cancelled by `owner`.
     */
    "ApprovalCancelled": Anonymize<I27hnueutmchbe>;
    /**
     * An `amount` was transferred in its entirety from `owner` to `destination` by
     * the approved `delegate`.
     */
    "TransferredApproved": Anonymize<Iectm2em66uhao>;
    /**
     * An asset has had its attributes changed by the `Force` origin.
     */
    "AssetStatusChanged": Anonymize<I22bm4d7re21j9>;
    /**
     * The min_balance of an asset has been updated by the asset owner.
     */
    "AssetMinBalanceChanged": Anonymize<I7q57goff3j72h>;
    /**
     * Some account `who` was created with a deposit from `depositor`.
     */
    "Touched": Anonymize<Ibe49veu9i9nro>;
    /**
     * Some account `who` was blocked.
     */
    "Blocked": Anonymize<I83r9d02dh47j9>;
    /**
     * Some assets were deposited (e.g. for transaction fees).
     */
    "Deposited": Anonymize<I1rnkmiu7usb82>;
    /**
     * Some assets were withdrawn from the account (e.g. for transaction fees).
     */
    "Withdrawn": Anonymize<I1rnkmiu7usb82>;
    /**
     * Reserve information was set or updated for `asset_id`.
     */
    "ReservesUpdated": Anonymize<Iadvnek4gbu68j>;
    /**
     * Reserve information was removed for `asset_id`.
     */
    "ReservesRemoved": Anonymize<I22bm4d7re21j9>;
    /**
     * Some assets were issued as Credit (no owner yet).
     */
    "IssuedCredit": Anonymize<Ibtugueatkkr9s>;
    /**
     * Some assets Credit was destroyed.
     */
    "BurnedCredit": Anonymize<Ibtugueatkkr9s>;
    /**
     * Some assets were burned and a Debt was created.
     */
    "IssuedDebt": Anonymize<Ibtugueatkkr9s>;
    /**
     * Some assets Debt was destroyed (and assets issued).
     */
    "BurnedDebt": Anonymize<Ibtugueatkkr9s>;
}>;
export type Icqe266pmnr25o = {
    "asset_id": Anonymize<If9iqq7i64mur8>;
    "creator": SS58String;
    "owner": SS58String;
};
export type I5hoiph0lqphp = {
    "asset_id": Anonymize<If9iqq7i64mur8>;
    "owner": SS58String;
    "amount": bigint;
};
export type I5k7oropl9ofc7 = {
    "asset_id": Anonymize<If9iqq7i64mur8>;
    "from": SS58String;
    "to": SS58String;
    "amount": bigint;
};
export type I48vagp1omigob = {
    "asset_id": Anonymize<If9iqq7i64mur8>;
    "owner": SS58String;
    "balance": bigint;
};
export type Ib5tst4ppem1g6 = {
    "asset_id": Anonymize<If9iqq7i64mur8>;
    "issuer": SS58String;
    "admin": SS58String;
    "freezer": SS58String;
};
export type Ibn64edsrg3737 = {
    "asset_id": Anonymize<If9iqq7i64mur8>;
    "owner": SS58String;
};
export type I83r9d02dh47j9 = {
    "asset_id": Anonymize<If9iqq7i64mur8>;
    "who": SS58String;
};
export type I22bm4d7re21j9 = {
    "asset_id": Anonymize<If9iqq7i64mur8>;
};
export type I3jnhifvaeuama = {
    "asset_id": Anonymize<If9iqq7i64mur8>;
    "accounts_destroyed": number;
    "accounts_remaining": number;
};
export type I8n1gia0lo42ok = {
    "asset_id": Anonymize<If9iqq7i64mur8>;
    "approvals_destroyed": number;
    "approvals_remaining": number;
};
export type I6gb0o7lqjfdjq = {
    "asset_id": Anonymize<If9iqq7i64mur8>;
    "name": Uint8Array;
    "symbol": Uint8Array;
    "decimals": number;
    "is_frozen": boolean;
};
export type Idh36v6iegkmpq = {
    "asset_id": Anonymize<If9iqq7i64mur8>;
    "source": SS58String;
    "delegate": SS58String;
    "amount": bigint;
};
export type I27hnueutmchbe = {
    "asset_id": Anonymize<If9iqq7i64mur8>;
    "owner": SS58String;
    "delegate": SS58String;
};
export type Iectm2em66uhao = {
    "asset_id": Anonymize<If9iqq7i64mur8>;
    "owner": SS58String;
    "delegate": SS58String;
    "destination": SS58String;
    "amount": bigint;
};
export type I7q57goff3j72h = {
    "asset_id": Anonymize<If9iqq7i64mur8>;
    "new_min_balance": bigint;
};
export type Ibe49veu9i9nro = {
    "asset_id": Anonymize<If9iqq7i64mur8>;
    "who": SS58String;
    "depositor": SS58String;
};
export type I1rnkmiu7usb82 = {
    "asset_id": Anonymize<If9iqq7i64mur8>;
    "who": SS58String;
    "amount": bigint;
};
export type Iadvnek4gbu68j = {
    "asset_id": Anonymize<If9iqq7i64mur8>;
    "reserves": Anonymize<If2801grpltbp8>;
};
export type If2801grpltbp8 = Array<{
    "reserve": Anonymize<If9iqq7i64mur8>;
    "teleportable": boolean;
}>;
export type Ibtugueatkkr9s = {
    "asset_id": Anonymize<If9iqq7i64mur8>;
    "amount": bigint;
};
export type Ies5dmgt7ichj9 = AnonymousEnum<{
    /**
     * `who`s balance on hold was increased by `amount`.
     */
    "Held": Anonymize<I6felmv64s40c4>;
    /**
     * `who`s balance on hold was decreased by `amount`.
     */
    "Released": Anonymize<I6felmv64s40c4>;
    /**
     * `who`s balance on hold was burned by `amount`.
     */
    "Burned": Anonymize<I6felmv64s40c4>;
}>;
export type I6felmv64s40c4 = {
    "who": SS58String;
    "asset_id": Anonymize<If9iqq7i64mur8>;
    "reason": Anonymize<I7sdoogtdsfine>;
    "amount": bigint;
};
export type I51qnoi21es512 = AnonymousEnum<{
    "AssetRateCreated": Anonymize<I72jcvr86rnvv8>;
    "AssetRateRemoved": Anonymize<I90c919drss29e>;
    "AssetRateUpdated": Anonymize<I5k7edfft48vsq>;
}>;
export type I72jcvr86rnvv8 = {
    "asset_kind": Anonymize<If9iqq7i64mur8>;
    "rate": bigint;
};
export type I90c919drss29e = {
    "asset_kind": Anonymize<If9iqq7i64mur8>;
};
export type I5k7edfft48vsq = {
    "asset_kind": Anonymize<If9iqq7i64mur8>;
    "old": bigint;
    "new": bigint;
};
export type Ie598chmfqlqa = AnonymousEnum<{
    /**
     * A transaction fee `actual_fee`, of which `tip` was added to the minimum inclusion fee,
     * has been paid by `who` in an asset `asset_id`.
     */
    "AssetTxFeePaid": Anonymize<Iaeqj2ebnvkjqe>;
}>;
export type Iaeqj2ebnvkjqe = {
    "who": SS58String;
    "actual_fee": bigint;
    "tip": bigint;
    "asset_id"?: Anonymize<I4pai6qnfk426l>;
};
export type I4pai6qnfk426l = (Anonymize<If9iqq7i64mur8>) | undefined;
export type I4srakrmf0fspo = AnonymousEnum<{
    /**
     * New Invulnerables were set.
     */
    "NewInvulnerables": Anonymize<I39t01nnod9109>;
    /**
     * A new Invulnerable was added.
     */
    "InvulnerableAdded": Anonymize<I6v8sm60vvkmk7>;
    /**
     * An Invulnerable was removed.
     */
    "InvulnerableRemoved": Anonymize<I6v8sm60vvkmk7>;
    /**
     * The number of desired candidates was set.
     */
    "NewDesiredCandidates": Anonymize<I1qmtmbe5so8r3>;
    /**
     * The candidacy bond was set.
     */
    "NewCandidacyBond": Anonymize<Ih99m6ehpcar7>;
    /**
     * A new candidate joined.
     */
    "CandidateAdded": Anonymize<Idgorhsbgdq2ap>;
    /**
     * Bond of a candidate updated.
     */
    "CandidateBondUpdated": Anonymize<Idgorhsbgdq2ap>;
    /**
     * A candidate was removed.
     */
    "CandidateRemoved": Anonymize<I6v8sm60vvkmk7>;
    /**
     * An account was replaced in the candidate list by another one.
     */
    "CandidateReplaced": Anonymize<I9ubb2kqevnu6t>;
    /**
     * An account was unable to be added to the Invulnerables because they did not have keys
     * registered. Other Invulnerables may have been set.
     */
    "InvalidInvulnerableSkipped": Anonymize<I6v8sm60vvkmk7>;
}>;
export type I39t01nnod9109 = {
    "invulnerables": Anonymize<Ia2lhg7l2hilo3>;
};
export type Ia2lhg7l2hilo3 = Array<SS58String>;
export type I6v8sm60vvkmk7 = {
    "account_id": SS58String;
};
export type I1qmtmbe5so8r3 = {
    "desired_candidates": number;
};
export type Ih99m6ehpcar7 = {
    "bond_amount": bigint;
};
export type Idgorhsbgdq2ap = {
    "account_id": SS58String;
    "deposit": bigint;
};
export type I9ubb2kqevnu6t = {
    "old": SS58String;
    "new": SS58String;
    "deposit": bigint;
};
export type I6ue0ck5fc3u44 = AnonymousEnum<{
    /**
     * New session has happened. Note that the argument is the session index, not the
     * block number as the type might suggest.
     */
    "NewSession": Anonymize<I2hq50pu2kdjpo>;
    /**
     * The `NewSession` event in the current block also implies a new validator set to be
     * queued.
     */
    "NewQueued": undefined;
    /**
     * Validator has been disabled.
     */
    "ValidatorDisabled": Anonymize<I9acqruh7322g2>;
    /**
     * Validator has been re-enabled.
     */
    "ValidatorReenabled": Anonymize<I9acqruh7322g2>;
}>;
export type I2hq50pu2kdjpo = {
    "session_index": number;
};
export type I9acqruh7322g2 = {
    "validator": SS58String;
};
export type Idsqc7mhp6nnle = AnonymousEnum<{
    /**
     * An HRMP message was sent to a sibling parachain.
     */
    "XcmpMessageSent": Anonymize<I137t1cld92pod>;
}>;
export type I137t1cld92pod = {
    "message_hash": SizedHex<32>;
};
export type If95hivmqmkiku = AnonymousEnum<{
    /**
     * Execution of an XCM message was attempted.
     */
    "Attempted": Anonymize<I61d51nv4cou88>;
    /**
     * An XCM message was sent.
     */
    "Sent": Anonymize<If8u5kl4h8070m>;
    /**
     * An XCM message failed to send.
     */
    "SendFailed": Anonymize<Ibmuil6p3vl83l>;
    /**
     * An XCM message failed to process.
     */
    "ProcessXcmError": Anonymize<I7lul91g50ae87>;
    /**
     * Query response received which does not match a registered query. This may be because a
     * matching query was never registered, it may be because it is a duplicate response, or
     * because the query timed out.
     */
    "UnexpectedResponse": Anonymize<Icl7nl1rfeog3i>;
    /**
     * Query response has been received and is ready for taking with `take_response`. There is
     * no registered notification call.
     */
    "ResponseReady": Anonymize<Iasr6pj6shs0fl>;
    /**
     * Query response has been received and query is removed. The registered notification has
     * been dispatched and executed successfully.
     */
    "Notified": Anonymize<I2uqmls7kcdnii>;
    /**
     * Query response has been received and query is removed. The registered notification
     * could not be dispatched because the dispatch weight is greater than the maximum weight
     * originally budgeted by this runtime for the query result.
     */
    "NotifyOverweight": Anonymize<Idg69klialbkb8>;
    /**
     * Query response has been received and query is removed. There was a general error with
     * dispatching the notification call.
     */
    "NotifyDispatchError": Anonymize<I2uqmls7kcdnii>;
    /**
     * Query response has been received and query is removed. The dispatch was unable to be
     * decoded into a `Call`; this might be due to dispatch function having a signature which
     * is not `(origin, QueryId, Response)`.
     */
    "NotifyDecodeFailed": Anonymize<I2uqmls7kcdnii>;
    /**
     * Expected query response has been received but the origin location of the response does
     * not match that expected. The query remains registered for a later, valid, response to
     * be received and acted upon.
     */
    "InvalidResponder": Anonymize<I7r6b7145022pp>;
    /**
     * Expected query response has been received but the expected origin location placed in
     * storage by this runtime previously cannot be decoded. The query remains registered.
     *
     * This is unexpected (since a location placed in storage in a previously executing
     * runtime should be readable prior to query timeout) and dangerous since the possibly
     * valid response will be dropped. Manual governance intervention is probably going to be
     * needed.
     */
    "InvalidResponderVersion": Anonymize<Icl7nl1rfeog3i>;
    /**
     * Received query response has been read and removed.
     */
    "ResponseTaken": Anonymize<I30pg328m00nr3>;
    /**
     * Some assets have been placed in an asset trap.
     */
    "AssetsTrapped": Anonymize<Icmrn7bogp28cs>;
    /**
     * An XCM version change notification message has been attempted to be sent.
     *
     * The cost of sending it (borne by the chain) is included.
     */
    "VersionChangeNotified": Anonymize<I7m9b5plj4h5ot>;
    /**
     * The supported version of a location has been changed. This might be through an
     * automatic notification or a manual intervention.
     */
    "SupportedVersionChanged": Anonymize<I9kt8c221c83ln>;
    /**
     * A given location which had a version change subscription was dropped owing to an error
     * sending the notification to it.
     */
    "NotifyTargetSendFail": Anonymize<I9onhk772nfs4f>;
    /**
     * A given location which had a version change subscription was dropped owing to an error
     * migrating the location to our new XCM format.
     */
    "NotifyTargetMigrationFail": Anonymize<I3l6bnksrmt56r>;
    /**
     * Expected query response has been received but the expected querier location placed in
     * storage by this runtime previously cannot be decoded. The query remains registered.
     *
     * This is unexpected (since a location placed in storage in a previously executing
     * runtime should be readable prior to query timeout) and dangerous since the possibly
     * valid response will be dropped. Manual governance intervention is probably going to be
     * needed.
     */
    "InvalidQuerierVersion": Anonymize<Icl7nl1rfeog3i>;
    /**
     * Expected query response has been received but the querier location of the response does
     * not match the expected. The query remains registered for a later, valid, response to
     * be received and acted upon.
     */
    "InvalidQuerier": Anonymize<Idh09k0l2pmdcg>;
    /**
     * A remote has requested XCM version change notification from us and we have honored it.
     * A version information message is sent to them and its cost is included.
     */
    "VersionNotifyStarted": Anonymize<I7uoiphbm0tj4r>;
    /**
     * We have requested that a remote chain send us XCM version change notifications.
     */
    "VersionNotifyRequested": Anonymize<I7uoiphbm0tj4r>;
    /**
     * We have requested that a remote chain stops sending us XCM version change
     * notifications.
     */
    "VersionNotifyUnrequested": Anonymize<I7uoiphbm0tj4r>;
    /**
     * Fees were paid from a location for an operation (often for using `SendXcm`).
     */
    "FeesPaid": Anonymize<I512p1n7qt24l8>;
    /**
     * Some assets have been claimed from an asset trap
     */
    "AssetsClaimed": Anonymize<Icmrn7bogp28cs>;
    /**
     * A XCM version migration finished.
     */
    "VersionMigrationFinished": Anonymize<I6s1nbislhk619>;
    /**
     * An `aliaser` location was authorized by `target` to alias it, authorization valid until
     * `expiry` block number.
     */
    "AliasAuthorized": Anonymize<I3gghqnh2mj0is>;
    /**
     * `target` removed alias authorization for `aliaser`.
     */
    "AliasAuthorizationRemoved": Anonymize<I6iv852roh6t3h>;
    /**
     * `target` removed all alias authorizations.
     */
    "AliasesAuthorizationsRemoved": Anonymize<I9oc2o6itbiopq>;
}>;
export type I61d51nv4cou88 = {
    "outcome": Anonymize<Ieqhmksji3pmv5>;
};
export type Ieqhmksji3pmv5 = AnonymousEnum<{
    "Complete": {
        "used": Anonymize<I4q39t5hn830vp>;
    };
    "Incomplete": {
        "used": Anonymize<I4q39t5hn830vp>;
        "error": Anonymize<Ieiju48dn66cuh>;
    };
    "Error": Anonymize<Ieiju48dn66cuh>;
}>;
export type Ieiju48dn66cuh = {
    "index": number;
    "error": Anonymize<Id56rgs0bdb7gl>;
};
export type Id56rgs0bdb7gl = AnonymousEnum<{
    "Overflow": undefined;
    "Unimplemented": undefined;
    "UntrustedReserveLocation": undefined;
    "UntrustedTeleportLocation": undefined;
    "LocationFull": undefined;
    "LocationNotInvertible": undefined;
    "BadOrigin": undefined;
    "InvalidLocation": undefined;
    "AssetNotFound": undefined;
    "FailedToTransactAsset": undefined;
    "NotWithdrawable": undefined;
    "LocationCannotHold": undefined;
    "ExceedsMaxMessageSize": undefined;
    "DestinationUnsupported": undefined;
    "Transport": undefined;
    "Unroutable": undefined;
    "UnknownClaim": undefined;
    "FailedToDecode": undefined;
    "MaxWeightInvalid": undefined;
    "NotHoldingFees": undefined;
    "TooExpensive": undefined;
    "Trap": bigint;
    "ExpectationFalse": undefined;
    "PalletNotFound": undefined;
    "NameMismatch": undefined;
    "VersionIncompatible": undefined;
    "HoldingWouldOverflow": undefined;
    "ExportError": undefined;
    "ReanchorFailed": undefined;
    "NoDeal": undefined;
    "FeesNotMet": undefined;
    "LockError": undefined;
    "NoPermission": undefined;
    "Unanchored": undefined;
    "NotDepositable": undefined;
    "TooManyAssets": undefined;
    "UnhandledXcmVersion": undefined;
    "WeightLimitReached": Anonymize<I4q39t5hn830vp>;
    "Barrier": undefined;
    "WeightNotComputable": undefined;
    "ExceedsStackLimit": undefined;
}>;
export type If8u5kl4h8070m = {
    "origin": Anonymize<If9iqq7i64mur8>;
    "destination": Anonymize<If9iqq7i64mur8>;
    "message": Anonymize<Ict03eedr8de9s>;
    "message_id": SizedHex<32>;
};
export type Ict03eedr8de9s = Array<XcmV5Instruction>;
export type XcmV5Instruction = Enum<{
    "WithdrawAsset": Anonymize<I4npjalvhmfuj>;
    "ReserveAssetDeposited": Anonymize<I4npjalvhmfuj>;
    "ReceiveTeleportedAsset": Anonymize<I4npjalvhmfuj>;
    "QueryResponse": {
        "query_id": bigint;
        "response": Anonymize<I7vucpgm2c6959>;
        "max_weight": Anonymize<I4q39t5hn830vp>;
        "querier"?: Anonymize<I4pai6qnfk426l>;
    };
    "TransferAsset": {
        "assets": Anonymize<I4npjalvhmfuj>;
        "beneficiary": Anonymize<If9iqq7i64mur8>;
    };
    "TransferReserveAsset": {
        "assets": Anonymize<I4npjalvhmfuj>;
        "dest": Anonymize<If9iqq7i64mur8>;
        "xcm": Anonymize<Ict03eedr8de9s>;
    };
    "Transact": {
        "origin_kind": XcmV2OriginKind;
        "fallback_max_weight"?: Anonymize<Iasb8k6ash5mjn>;
        "call": Uint8Array;
    };
    "HrmpNewChannelOpenRequest": Anonymize<I5uhhrjqfuo4e5>;
    "HrmpChannelAccepted": Anonymize<Ifij4jam0o7sub>;
    "HrmpChannelClosing": Anonymize<Ieeb4svd9i8fji>;
    "ClearOrigin": undefined;
    "DescendOrigin": XcmV5Junctions;
    "ReportError": Anonymize<I6vsmh07hrp1rc>;
    "DepositAsset": {
        "assets": XcmV5AssetFilter;
        "beneficiary": Anonymize<If9iqq7i64mur8>;
    };
    "DepositReserveAsset": {
        "assets": XcmV5AssetFilter;
        "dest": Anonymize<If9iqq7i64mur8>;
        "xcm": Anonymize<Ict03eedr8de9s>;
    };
    "ExchangeAsset": {
        "give": XcmV5AssetFilter;
        "want": Anonymize<I4npjalvhmfuj>;
        "maximal": boolean;
    };
    "InitiateReserveWithdraw": {
        "assets": XcmV5AssetFilter;
        "reserve": Anonymize<If9iqq7i64mur8>;
        "xcm": Anonymize<Ict03eedr8de9s>;
    };
    "InitiateTeleport": {
        "assets": XcmV5AssetFilter;
        "dest": Anonymize<If9iqq7i64mur8>;
        "xcm": Anonymize<Ict03eedr8de9s>;
    };
    "ReportHolding": {
        "response_info": Anonymize<I6vsmh07hrp1rc>;
        "assets": XcmV5AssetFilter;
    };
    "BuyExecution": {
        "fees": Anonymize<Iffh1nc5e1mod6>;
        "weight_limit": XcmV3WeightLimit;
    };
    "RefundSurplus": undefined;
    "SetErrorHandler": Anonymize<Ict03eedr8de9s>;
    "SetAppendix": Anonymize<Ict03eedr8de9s>;
    "ClearError": undefined;
    "ClaimAsset": {
        "assets": Anonymize<I4npjalvhmfuj>;
        "ticket": Anonymize<If9iqq7i64mur8>;
    };
    "Trap": bigint;
    "SubscribeVersion": Anonymize<Ieprdqqu7ildvr>;
    "UnsubscribeVersion": undefined;
    "BurnAsset": Anonymize<I4npjalvhmfuj>;
    "ExpectAsset": Anonymize<I4npjalvhmfuj>;
    "ExpectOrigin"?: Anonymize<I4pai6qnfk426l>;
    "ExpectError"?: Anonymize<I3l6ejee750fv1>;
    "ExpectTransactStatus": XcmV3MaybeErrorCode;
    "QueryPallet": {
        "module_name": Uint8Array;
        "response_info": Anonymize<I6vsmh07hrp1rc>;
    };
    "ExpectPallet": Anonymize<Id7mf37dkpgfjs>;
    "ReportTransactStatus": Anonymize<I6vsmh07hrp1rc>;
    "ClearTransactStatus": undefined;
    "UniversalOrigin": XcmV5Junction;
    "ExportMessage": {
        "network": XcmV5NetworkId;
        "destination": XcmV5Junctions;
        "xcm": Anonymize<Ict03eedr8de9s>;
    };
    "LockAsset": {
        "asset": Anonymize<Iffh1nc5e1mod6>;
        "unlocker": Anonymize<If9iqq7i64mur8>;
    };
    "UnlockAsset": {
        "asset": Anonymize<Iffh1nc5e1mod6>;
        "target": Anonymize<If9iqq7i64mur8>;
    };
    "NoteUnlockable": {
        "asset": Anonymize<Iffh1nc5e1mod6>;
        "owner": Anonymize<If9iqq7i64mur8>;
    };
    "RequestUnlock": {
        "asset": Anonymize<Iffh1nc5e1mod6>;
        "locker": Anonymize<If9iqq7i64mur8>;
    };
    "SetFeesMode": Anonymize<I4nae9rsql8fa7>;
    "SetTopic": SizedHex<32>;
    "ClearTopic": undefined;
    "AliasOrigin": Anonymize<If9iqq7i64mur8>;
    "UnpaidExecution": {
        "weight_limit": XcmV3WeightLimit;
        "check_origin"?: Anonymize<I4pai6qnfk426l>;
    };
    "PayFees": {
        "asset": Anonymize<Iffh1nc5e1mod6>;
    };
    "InitiateTransfer": {
        "destination": Anonymize<If9iqq7i64mur8>;
        "remote_fees"?: (Anonymize<Ifhmc9e7vpeeig>) | undefined;
        "preserve_origin": boolean;
        "assets": Array<Anonymize<Ifhmc9e7vpeeig>>;
        "remote_xcm": Anonymize<Ict03eedr8de9s>;
    };
    "ExecuteWithOrigin": {
        "descendant_origin"?: (XcmV5Junctions) | undefined;
        "xcm": Anonymize<Ict03eedr8de9s>;
    };
    "SetHints": {
        "hints": Array<Enum<{
            "AssetClaimer": {
                "location": Anonymize<If9iqq7i64mur8>;
            };
        }>>;
    };
}>;
export declare const XcmV5Instruction: GetEnum<XcmV5Instruction>;
export type I4npjalvhmfuj = Array<Anonymize<Iffh1nc5e1mod6>>;
export type Iffh1nc5e1mod6 = {
    "id": Anonymize<If9iqq7i64mur8>;
    "fun": XcmV3MultiassetFungibility;
};
export type XcmV3MultiassetFungibility = Enum<{
    "Fungible": bigint;
    "NonFungible": XcmV3MultiassetAssetInstance;
}>;
export declare const XcmV3MultiassetFungibility: GetEnum<XcmV3MultiassetFungibility>;
export type XcmV3MultiassetAssetInstance = Enum<{
    "Undefined": undefined;
    "Index": bigint;
    "Array4": SizedHex<4>;
    "Array8": SizedHex<8>;
    "Array16": SizedHex<16>;
    "Array32": SizedHex<32>;
}>;
export declare const XcmV3MultiassetAssetInstance: GetEnum<XcmV3MultiassetAssetInstance>;
export type I7vucpgm2c6959 = AnonymousEnum<{
    "Null": undefined;
    "Assets": Anonymize<I4npjalvhmfuj>;
    "ExecutionResult"?: Anonymize<I3l6ejee750fv1>;
    "Version": number;
    "PalletsInfo": Anonymize<I599u7h20b52at>;
    "DispatchResult": XcmV3MaybeErrorCode;
}>;
export type I3l6ejee750fv1 = ([number, Anonymize<Id56rgs0bdb7gl>]) | undefined;
export type I599u7h20b52at = Array<{
    "index": number;
    "name": Uint8Array;
    "module_name": Uint8Array;
    "major": number;
    "minor": number;
    "patch": number;
}>;
export type XcmV3MaybeErrorCode = Enum<{
    "Success": undefined;
    "Error": Uint8Array;
    "TruncatedError": Uint8Array;
}>;
export declare const XcmV3MaybeErrorCode: GetEnum<XcmV3MaybeErrorCode>;
export type XcmV2OriginKind = Enum<{
    "Native": undefined;
    "SovereignAccount": undefined;
    "Superuser": undefined;
    "Xcm": undefined;
}>;
export declare const XcmV2OriginKind: GetEnum<XcmV2OriginKind>;
export type Iasb8k6ash5mjn = (Anonymize<I4q39t5hn830vp>) | undefined;
export type I5uhhrjqfuo4e5 = {
    "sender": number;
    "max_message_size": number;
    "max_capacity": number;
};
export type Ifij4jam0o7sub = {
    "recipient": number;
};
export type Ieeb4svd9i8fji = {
    "initiator": number;
    "sender": number;
    "recipient": number;
};
export type I6vsmh07hrp1rc = {
    "destination": Anonymize<If9iqq7i64mur8>;
    "query_id": bigint;
    "max_weight": Anonymize<I4q39t5hn830vp>;
};
export type XcmV5AssetFilter = Enum<{
    "Definite": Anonymize<I4npjalvhmfuj>;
    "Wild": XcmV5WildAsset;
}>;
export declare const XcmV5AssetFilter: GetEnum<XcmV5AssetFilter>;
export type XcmV5WildAsset = Enum<{
    "All": undefined;
    "AllOf": {
        "id": Anonymize<If9iqq7i64mur8>;
        "fun": XcmV2MultiassetWildFungibility;
    };
    "AllCounted": number;
    "AllOfCounted": {
        "id": Anonymize<If9iqq7i64mur8>;
        "fun": XcmV2MultiassetWildFungibility;
        "count": number;
    };
}>;
export declare const XcmV5WildAsset: GetEnum<XcmV5WildAsset>;
export type XcmV2MultiassetWildFungibility = Enum<{
    "Fungible": undefined;
    "NonFungible": undefined;
}>;
export declare const XcmV2MultiassetWildFungibility: GetEnum<XcmV2MultiassetWildFungibility>;
export type XcmV3WeightLimit = Enum<{
    "Unlimited": undefined;
    "Limited": Anonymize<I4q39t5hn830vp>;
}>;
export declare const XcmV3WeightLimit: GetEnum<XcmV3WeightLimit>;
export type Ieprdqqu7ildvr = {
    "query_id": bigint;
    "max_response_weight": Anonymize<I4q39t5hn830vp>;
};
export type Id7mf37dkpgfjs = {
    "index": number;
    "name": Uint8Array;
    "module_name": Uint8Array;
    "crate_major": number;
    "min_crate_minor": number;
};
export type I4nae9rsql8fa7 = {
    "jit_withdraw": boolean;
};
export type Ifhmc9e7vpeeig = AnonymousEnum<{
    "Teleport": XcmV5AssetFilter;
    "ReserveDeposit": XcmV5AssetFilter;
    "ReserveWithdraw": XcmV5AssetFilter;
}>;
export type Ibmuil6p3vl83l = {
    "origin": Anonymize<If9iqq7i64mur8>;
    "destination": Anonymize<If9iqq7i64mur8>;
    "error": Enum<{
        "NotApplicable": undefined;
        "Transport": undefined;
        "Unroutable": undefined;
        "DestinationUnsupported": undefined;
        "ExceedsMaxMessageSize": undefined;
        "MissingArgument": undefined;
        "Fees": undefined;
    }>;
    "message_id": SizedHex<32>;
};
export type I7lul91g50ae87 = {
    "origin": Anonymize<If9iqq7i64mur8>;
    "error": Anonymize<Id56rgs0bdb7gl>;
    "message_id": SizedHex<32>;
};
export type Icl7nl1rfeog3i = {
    "origin": Anonymize<If9iqq7i64mur8>;
    "query_id": bigint;
};
export type Iasr6pj6shs0fl = {
    "query_id": bigint;
    "response": Anonymize<I7vucpgm2c6959>;
};
export type I2uqmls7kcdnii = {
    "query_id": bigint;
    "pallet_index": number;
    "call_index": number;
};
export type Idg69klialbkb8 = {
    "query_id": bigint;
    "pallet_index": number;
    "call_index": number;
    "actual_weight": Anonymize<I4q39t5hn830vp>;
    "max_budgeted_weight": Anonymize<I4q39t5hn830vp>;
};
export type I7r6b7145022pp = {
    "origin": Anonymize<If9iqq7i64mur8>;
    "query_id": bigint;
    "expected_location"?: Anonymize<I4pai6qnfk426l>;
};
export type I30pg328m00nr3 = {
    "query_id": bigint;
};
export type Icmrn7bogp28cs = {
    "hash": SizedHex<32>;
    "origin": Anonymize<If9iqq7i64mur8>;
    "assets": XcmVersionedAssets;
};
export type XcmVersionedAssets = Enum<{
    "V3": Anonymize<Iai6dhqiq3bach>;
    "V4": Anonymize<I50mli3hb64f9b>;
    "V5": Anonymize<I4npjalvhmfuj>;
}>;
export declare const XcmVersionedAssets: GetEnum<XcmVersionedAssets>;
export type Iai6dhqiq3bach = Array<Anonymize<Idcm24504c8bkk>>;
export type Idcm24504c8bkk = {
    "id": XcmV3MultiassetAssetId;
    "fun": XcmV3MultiassetFungibility;
};
export type XcmV3MultiassetAssetId = Enum<{
    "Concrete": Anonymize<I4c0s5cioidn76>;
    "Abstract": SizedHex<32>;
}>;
export declare const XcmV3MultiassetAssetId: GetEnum<XcmV3MultiassetAssetId>;
export type I4c0s5cioidn76 = {
    "parents": number;
    "interior": XcmV3Junctions;
};
export type XcmV3Junctions = Enum<{
    "Here": undefined;
    "X1": XcmV3Junction;
    "X2": FixedSizeArray<2, XcmV3Junction>;
    "X3": FixedSizeArray<3, XcmV3Junction>;
    "X4": FixedSizeArray<4, XcmV3Junction>;
    "X5": FixedSizeArray<5, XcmV3Junction>;
    "X6": FixedSizeArray<6, XcmV3Junction>;
    "X7": FixedSizeArray<7, XcmV3Junction>;
    "X8": FixedSizeArray<8, XcmV3Junction>;
}>;
export declare const XcmV3Junctions: GetEnum<XcmV3Junctions>;
export type XcmV3Junction = Enum<{
    "Parachain": number;
    "AccountId32": {
        "network"?: Anonymize<Idcq3vns9tgp5p>;
        "id": SizedHex<32>;
    };
    "AccountIndex64": {
        "network"?: Anonymize<Idcq3vns9tgp5p>;
        "index": bigint;
    };
    "AccountKey20": {
        "network"?: Anonymize<Idcq3vns9tgp5p>;
        "key": SizedHex<20>;
    };
    "PalletInstance": number;
    "GeneralIndex": bigint;
    "GeneralKey": Anonymize<I15lht6t53odo4>;
    "OnlyChild": undefined;
    "Plurality": Anonymize<I518fbtnclg1oc>;
    "GlobalConsensus": XcmV3JunctionNetworkId;
}>;
export declare const XcmV3Junction: GetEnum<XcmV3Junction>;
export type Idcq3vns9tgp5p = (XcmV3JunctionNetworkId) | undefined;
export type XcmV3JunctionNetworkId = Enum<{
    "ByGenesis": SizedHex<32>;
    "ByFork": Anonymize<I15vf5oinmcgps>;
    "Polkadot": undefined;
    "Kusama": undefined;
    "Westend": undefined;
    "Rococo": undefined;
    "Wococo": undefined;
    "Ethereum": Anonymize<I623eo8t3jrbeo>;
    "BitcoinCore": undefined;
    "BitcoinCash": undefined;
    "PolkadotBulletin": undefined;
}>;
export declare const XcmV3JunctionNetworkId: GetEnum<XcmV3JunctionNetworkId>;
export type I50mli3hb64f9b = Array<Anonymize<Ia5l7mu5a6v49o>>;
export type Ia5l7mu5a6v49o = {
    "id": Anonymize<I4c0s5cioidn76>;
    "fun": XcmV3MultiassetFungibility;
};
export type I7m9b5plj4h5ot = {
    "destination": Anonymize<If9iqq7i64mur8>;
    "result": number;
    "cost": Anonymize<I4npjalvhmfuj>;
    "message_id": SizedHex<32>;
};
export type I9kt8c221c83ln = {
    "location": Anonymize<If9iqq7i64mur8>;
    "version": number;
};
export type I9onhk772nfs4f = {
    "location": Anonymize<If9iqq7i64mur8>;
    "query_id": bigint;
    "error": Anonymize<Id56rgs0bdb7gl>;
};
export type I3l6bnksrmt56r = {
    "location": XcmVersionedLocation;
    "query_id": bigint;
};
export type XcmVersionedLocation = Enum<{
    "V3": Anonymize<I4c0s5cioidn76>;
    "V4": Anonymize<I4c0s5cioidn76>;
    "V5": Anonymize<If9iqq7i64mur8>;
}>;
export declare const XcmVersionedLocation: GetEnum<XcmVersionedLocation>;
export type Idh09k0l2pmdcg = {
    "origin": Anonymize<If9iqq7i64mur8>;
    "query_id": bigint;
    "expected_querier": Anonymize<If9iqq7i64mur8>;
    "maybe_actual_querier"?: Anonymize<I4pai6qnfk426l>;
};
export type I7uoiphbm0tj4r = {
    "destination": Anonymize<If9iqq7i64mur8>;
    "cost": Anonymize<I4npjalvhmfuj>;
    "message_id": SizedHex<32>;
};
export type I512p1n7qt24l8 = {
    "paying": Anonymize<If9iqq7i64mur8>;
    "fees": Anonymize<I4npjalvhmfuj>;
};
export type I6s1nbislhk619 = {
    "version": number;
};
export type I3gghqnh2mj0is = {
    "aliaser": Anonymize<If9iqq7i64mur8>;
    "target": Anonymize<If9iqq7i64mur8>;
    "expiry"?: Anonymize<I35p85j063s0il>;
};
export type I35p85j063s0il = (bigint) | undefined;
export type I6iv852roh6t3h = {
    "aliaser": Anonymize<If9iqq7i64mur8>;
    "target": Anonymize<If9iqq7i64mur8>;
};
export type I9oc2o6itbiopq = {
    "target": Anonymize<If9iqq7i64mur8>;
};
export type I5uv57c3fffoi9 = AnonymousEnum<{
    /**
     * Downward message is invalid XCM.
     * \[ id \]
     */
    "InvalidFormat": SizedHex<32>;
    /**
     * Downward message is unsupported version of XCM.
     * \[ id \]
     */
    "UnsupportedVersion": SizedHex<32>;
    /**
     * Downward message executed with the given outcome.
     * \[ id, outcome \]
     */
    "ExecutedDownward": Anonymize<Ibslgga81p36aa>;
}>;
export type Ibslgga81p36aa = [SizedHex<32>, Anonymize<Ieqhmksji3pmv5>];
export type I2kosejppk3jon = AnonymousEnum<{
    /**
     * Message discarded due to an error in the `MessageProcessor` (usually a format error).
     */
    "ProcessingFailed": Anonymize<I1rvj4ubaplho0>;
    /**
     * Message is processed.
     */
    "Processed": Anonymize<Ia3uu7lqcc1q1i>;
    /**
     * Message placed in overweight queue.
     */
    "OverweightEnqueued": Anonymize<I7crucfnonitkn>;
    /**
     * This page was reaped.
     */
    "PageReaped": Anonymize<I7tmrp94r9sq4n>;
}>;
export type I1rvj4ubaplho0 = {
    /**
     * The `blake2_256` hash of the message.
     */
    "id": SizedHex<32>;
    /**
     * The queue of the message.
     */
    "origin": Anonymize<Iejeo53sea6n4q>;
    /**
     * The error that occurred.
     *
     * This error is pretty opaque. More fine-grained errors need to be emitted as events
     * by the `MessageProcessor`.
     */
    "error": Enum<{
        "BadFormat": undefined;
        "Corrupt": undefined;
        "Unsupported": undefined;
        "Overweight": Anonymize<I4q39t5hn830vp>;
        "Yield": undefined;
        "StackLimitReached": undefined;
    }>;
};
export type Iejeo53sea6n4q = AnonymousEnum<{
    "Here": undefined;
    "Parent": undefined;
    "Sibling": number;
}>;
export type Ia3uu7lqcc1q1i = {
    /**
     * The `blake2_256` hash of the message.
     */
    "id": SizedHex<32>;
    /**
     * The queue of the message.
     */
    "origin": Anonymize<Iejeo53sea6n4q>;
    /**
     * How much weight was used to process the message.
     */
    "weight_used": Anonymize<I4q39t5hn830vp>;
    /**
     * Whether the message was processed.
     *
     * Note that this does not mean that the underlying `MessageProcessor` was internally
     * successful. It *solely* means that the MQ pallet will treat this as a success
     * condition and discard the message. Any internal error needs to be emitted as events
     * by the `MessageProcessor`.
     */
    "success": boolean;
};
export type I7crucfnonitkn = {
    /**
     * The `blake2_256` hash of the message.
     */
    "id": SizedHex<32>;
    /**
     * The queue of the message.
     */
    "origin": Anonymize<Iejeo53sea6n4q>;
    /**
     * The page of the message.
     */
    "page_index": number;
    /**
     * The index of the message within the page.
     */
    "message_index": number;
};
export type I7tmrp94r9sq4n = {
    /**
     * The queue of the page.
     */
    "origin": Anonymize<Iejeo53sea6n4q>;
    /**
     * The index of the page.
     */
    "index": number;
};
export type I9t024spkebrtk = AnonymousEnum<{
    /**
     * Batch of dispatches did not complete fully. Index of first failing dispatch given, as
     * well as the error.
     */
    "BatchInterrupted": Anonymize<I8q7bne2mpmuvt>;
    /**
     * Batch of dispatches completed fully with no error.
     */
    "BatchCompleted": undefined;
    /**
     * Batch of dispatches completed but has errors.
     */
    "BatchCompletedWithErrors": undefined;
    /**
     * A single item within a Batch of dispatches has completed with no error.
     */
    "ItemCompleted": undefined;
    /**
     * A single item within a Batch of dispatches has completed with error.
     */
    "ItemFailed": Anonymize<I4e44onfj09kj9>;
    /**
     * A call was dispatched.
     */
    "DispatchedAs": Anonymize<Iff4dsuaudcmul>;
    /**
     * Main call was dispatched.
     */
    "IfElseMainSuccess": undefined;
    /**
     * The fallback call was dispatched.
     */
    "IfElseFallbackCalled": Anonymize<I6at1u8h56mk6v>;
}>;
export type I8q7bne2mpmuvt = {
    "index": number;
    "error": Anonymize<I8rjgvnsb8ltnm>;
};
export type I4e44onfj09kj9 = {
    "error": Anonymize<I8rjgvnsb8ltnm>;
};
export type Iff4dsuaudcmul = {
    "result": Anonymize<I90kprdmdpdfpl>;
};
export type I90kprdmdpdfpl = ResultPayload<undefined, Anonymize<I8rjgvnsb8ltnm>>;
export type I6at1u8h56mk6v = {
    "main_error": Anonymize<I8rjgvnsb8ltnm>;
};
export type Ig5k2529tfkni = AnonymousEnum<{
    /**
     * A new multisig operation has begun.
     */
    "NewMultisig": Anonymize<Iep27ialq4a7o7>;
    /**
     * A multisig operation has been approved by someone.
     */
    "MultisigApproval": Anonymize<Iasu5jvoqr43mv>;
    /**
     * A multisig operation has been executed.
     */
    "MultisigExecuted": Anonymize<Iip94ct8liqkr>;
    /**
     * A multisig operation has been cancelled.
     */
    "MultisigCancelled": Anonymize<I5qolde99acmd1>;
    /**
     * The deposit for a multisig operation has been updated/poked.
     */
    "DepositPoked": Anonymize<I8gtde5abn1g9a>;
}>;
export type Iep27ialq4a7o7 = {
    "approving": SS58String;
    "multisig": SS58String;
    "call_hash": SizedHex<32>;
};
export type Iasu5jvoqr43mv = {
    "approving": SS58String;
    "timepoint": Anonymize<Itvprrpb0nm3o>;
    "multisig": SS58String;
    "call_hash": SizedHex<32>;
};
export type Itvprrpb0nm3o = {
    "height": number;
    "index": number;
};
export type Iip94ct8liqkr = {
    "approving": SS58String;
    "timepoint": Anonymize<Itvprrpb0nm3o>;
    "multisig": SS58String;
    "call_hash": SizedHex<32>;
    "result": Anonymize<I90kprdmdpdfpl>;
};
export type I5qolde99acmd1 = {
    "cancelling": SS58String;
    "timepoint": Anonymize<Itvprrpb0nm3o>;
    "multisig": SS58String;
    "call_hash": SizedHex<32>;
};
export type I8gtde5abn1g9a = {
    "who": SS58String;
    "call_hash": SizedHex<32>;
    "old_deposit": bigint;
    "new_deposit": bigint;
};
export type Icqpp5h2s0lmjl = AnonymousEnum<{
    /**
     * A sudo call just took place.
     */
    "Sudid": Anonymize<Icanjvelodp3>;
    /**
     * The sudo key has been updated.
     */
    "KeyChanged": Anonymize<I5rtkmhm2dng4u>;
    /**
     * The key was permanently removed.
     */
    "KeyRemoved": undefined;
    /**
     * A [sudo_as](Pallet::sudo_as) call just took place.
     */
    "SudoAsDone": Anonymize<Icanjvelodp3>;
}>;
export type Icanjvelodp3 = {
    /**
     * The result of the call made by the sudo user.
     */
    "sudo_result": Anonymize<I90kprdmdpdfpl>;
};
export type I5rtkmhm2dng4u = {
    /**
     * The old sudo key (if one was previously set).
     */
    "old"?: Anonymize<Ihfphjolmsqq1>;
    /**
     * The new sudo key (if one was set).
     */
    "new": SS58String;
};
export type Ihfphjolmsqq1 = (SS58String) | undefined;
export type Iehol079dtpmsc = AnonymousEnum<{
    /**
     * A proxy was executed correctly, with the given.
     */
    "ProxyExecuted": Anonymize<Iff4dsuaudcmul>;
    /**
     * A pure account has been created by new proxy with given
     * disambiguation index and proxy type.
     */
    "PureCreated": Anonymize<Iquobi9ukq7tb>;
    /**
     * A pure proxy was killed by its spawner.
     */
    "PureKilled": Anonymize<I4mj21qcksiuf3>;
    /**
     * An announcement was placed to make a call in the future.
     */
    "Announced": Anonymize<I2ur0oeqg495j8>;
    /**
     * A proxy was added.
     */
    "ProxyAdded": Anonymize<I8v2su1f60qoae>;
    /**
     * A proxy was removed.
     */
    "ProxyRemoved": Anonymize<I8v2su1f60qoae>;
    /**
     * A deposit stored for proxies or announcements was poked / updated.
     */
    "DepositPoked": Anonymize<I1bhd210c3phjj>;
}>;
export type Iquobi9ukq7tb = {
    "pure": SS58String;
    "who": SS58String;
    "proxy_type": Anonymize<Ieuemnllefri8h>;
    "disambiguation_index": number;
    "at": number;
    "extrinsic_index": number;
};
export type Ieuemnllefri8h = AnonymousEnum<{
    "Any": undefined;
    "NonTransfer": undefined;
    "CancelProxy": undefined;
    "Identity": undefined;
    "IdentityJudgement": undefined;
    "Collator": undefined;
}>;
export type I4mj21qcksiuf3 = {
    "pure": SS58String;
    "spawner": SS58String;
    "proxy_type": Anonymize<Ieuemnllefri8h>;
    "disambiguation_index": number;
};
export type I2ur0oeqg495j8 = {
    "real": SS58String;
    "proxy": SS58String;
    "call_hash": SizedHex<32>;
};
export type I8v2su1f60qoae = {
    "delegator": SS58String;
    "delegatee": SS58String;
    "proxy_type": Anonymize<Ieuemnllefri8h>;
    "delay": number;
};
export type I1bhd210c3phjj = {
    "who": SS58String;
    "kind": Enum<{
        "Proxies": undefined;
        "Announcements": undefined;
    }>;
    "old_deposit": bigint;
    "new_deposit": bigint;
};
export type Idkb7nir4hamvl = AnonymousEnum<{
    /**
     * A name was set or reset (which will remove all judgements).
     */
    "IdentitySet": Anonymize<I4cbvqmqadhrea>;
    /**
     * A name was cleared, and the given balance returned.
     */
    "IdentityCleared": Anonymize<Iep1lmt6q3s6r3>;
    /**
     * A name was removed and the given balance slashed.
     */
    "IdentityKilled": Anonymize<Iep1lmt6q3s6r3>;
    /**
     * A judgement was asked from a registrar.
     */
    "JudgementRequested": Anonymize<I1fac16213rie2>;
    /**
     * A judgement request was retracted.
     */
    "JudgementUnrequested": Anonymize<I1fac16213rie2>;
    /**
     * A judgement was given by a registrar.
     */
    "JudgementGiven": Anonymize<Ifjt77oc391o43>;
    /**
     * A registrar was added.
     */
    "RegistrarAdded": Anonymize<Itvt1jsipv0lc>;
    /**
     * A sub-identity was added to an identity and the deposit paid.
     */
    "SubIdentityAdded": Anonymize<Ick3mveut33f44>;
    /**
     * An account's sub-identities were set (in bulk).
     */
    "SubIdentitiesSet": Anonymize<I719lqkkbtikbl>;
    /**
     * A given sub-account's associated name was changed by its super-identity.
     */
    "SubIdentityRenamed": Anonymize<Ie4intrc3n8jfu>;
    /**
     * A sub-identity was removed from an identity and the deposit freed.
     */
    "SubIdentityRemoved": Anonymize<Ick3mveut33f44>;
    /**
     * A sub-identity was cleared, and the given deposit repatriated from the
     * main identity account to the sub-identity account.
     */
    "SubIdentityRevoked": Anonymize<Ick3mveut33f44>;
    /**
     * A username authority was added.
     */
    "AuthorityAdded": Anonymize<I2rg5btjrsqec0>;
    /**
     * A username authority was removed.
     */
    "AuthorityRemoved": Anonymize<I2rg5btjrsqec0>;
    /**
     * A username was set for `who`.
     */
    "UsernameSet": Anonymize<Ibdqerrooruuq9>;
    /**
     * A username was queued, but `who` must accept it prior to `expiration`.
     */
    "UsernameQueued": Anonymize<I8u2ba9jeiu6q0>;
    /**
     * A queued username passed its expiration without being claimed and was removed.
     */
    "PreapprovalExpired": Anonymize<I7ieadb293k6b4>;
    /**
     * A username was set as a primary and can be looked up from `who`.
     */
    "PrimaryUsernameSet": Anonymize<Ibdqerrooruuq9>;
    /**
     * A dangling username (as in, a username corresponding to an account that has removed its
     * identity) has been removed.
     */
    "DanglingUsernameRemoved": Anonymize<Ibdqerrooruuq9>;
    /**
     * A username has been unbound.
     */
    "UsernameUnbound": Anonymize<Ie5l999tf7t2te>;
    /**
     * A username has been removed.
     */
    "UsernameRemoved": Anonymize<Ie5l999tf7t2te>;
    /**
     * A username has been killed.
     */
    "UsernameKilled": Anonymize<Ie5l999tf7t2te>;
    /**
     * A username has been reported.
     */
    "UsernameReported": Anonymize<I86ooiomatht8n>;
    /**
     * An identity for a person has been set.
     */
    "PersonalIdentitySet": Anonymize<I7v1eea9s3tjf6>;
    /**
     * Evidence for a credential has beed submitted by a person.
     */
    "EvidenceSubmitted": Anonymize<Ifcon2ngg4leli>;
    /**
     * A credential was accepted for a person.
     */
    "CredentialAccepted": Anonymize<Ifcon2ngg4leli>;
    /**
     * A credential was rejected for a person.
     */
    "CredentialRejected": Anonymize<Ifcon2ngg4leli>;
    /**
     * Person was banned for sending contemptuous evidence.
     */
    "PersonBanned": Anonymize<Ifcon2ngg4leli>;
    /**
     * A personal identity was cleared.
     */
    "PersonalIdentityCleared": Anonymize<Ifcon2ngg4leli>;
    /**
     * A reported username was judged valid.
     */
    "ReportedUsernameJudgedValid": Anonymize<Ie5l999tf7t2te>;
    /**
     * A reported username was judged invalid.
     */
    "ReportedUsernameJudgedInvalid": Anonymize<Ie5l999tf7t2te>;
    /**
     * The judgment regarding a reported username was unclear or uncertain.
     */
    "ReportedUsernameWeakOrUnclearJudgement": Anonymize<I7luomlm0cts8l>;
}>;
export type Iep1lmt6q3s6r3 = {
    "who": SS58String;
    "deposit": bigint;
};
export type I1fac16213rie2 = {
    "who": SS58String;
    "registrar_index": number;
};
export type Ifjt77oc391o43 = {
    "target": SS58String;
    "registrar_index": number;
};
export type Itvt1jsipv0lc = {
    "registrar_index": number;
};
export type Ick3mveut33f44 = {
    "sub": SS58String;
    "main": SS58String;
    "deposit": bigint;
};
export type I719lqkkbtikbl = {
    "main": SS58String;
    "number_of_subs": number;
    "new_deposit": bigint;
};
export type Ie4intrc3n8jfu = {
    "sub": SS58String;
    "main": SS58String;
};
export type I2rg5btjrsqec0 = {
    "authority": SS58String;
};
export type Ibdqerrooruuq9 = {
    "who": SS58String;
    "username": Uint8Array;
};
export type I8u2ba9jeiu6q0 = {
    "who": SS58String;
    "username": Uint8Array;
    "expiration": number;
};
export type I7ieadb293k6b4 = {
    "whose": SS58String;
};
export type Ie5l999tf7t2te = {
    "username": Uint8Array;
};
export type I86ooiomatht8n = {
    "reporter": SS58String;
    "username": Uint8Array;
};
export type I7v1eea9s3tjf6 = {
    "alias": SizedHex<32>;
    "account": SS58String;
    "username": Uint8Array;
};
export type Ifcon2ngg4leli = {
    "alias": SizedHex<32>;
};
export type I7luomlm0cts8l = {
    "username": Uint8Array;
    "judgement": Anonymize<Id32895epm7otq>;
};
export type Id32895epm7otq = AnonymousEnum<{
    "Truth": Enum<{
        "True": undefined;
        "False": undefined;
    }>;
    "Contempt": undefined;
}>;
export type Idundv7m4eqe4f = AnonymousEnum<{
    /**
     * An individual has had their personhood recognised and indexed.
     */
    "PersonhoodRecognized": Anonymize<I53pb13fh9bdtb>;
    /**
     * An individual has had their personhood recognised again and indexed.
     */
    "PersonOnboarding": Anonymize<I53pb13fh9bdtb>;
    /**
     * A call was dispatched under an alias.
     */
    "AliasDispatched": Anonymize<I5eoknm3d4b0hp>;
    /**
     * An alias-to-account mapping was set or updated.
     */
    "AliasAccountSet": Anonymize<I5eoknm3d4b0hp>;
    /**
     * An alias-to-account mapping was removed.
     */
    "AliasAccountUnset": Anonymize<I5eoknm3d4b0hp>;
    /**
     * A personal ID-to-account mapping was set or updated.
     */
    "PersonalIdAccountSet": Anonymize<I1267r4okm030g>;
    /**
     * A personal ID-to-account mapping was removed.
     */
    "PersonalIdAccountUnset": Anonymize<I1267r4okm030g>;
    /**
     * The people collection was created.
     */
    "CollectionCreated": undefined;
    /**
     * Personhood was forcefully recognized by root.
     */
    "ForcePersonhoodRecognized": Anonymize<I6tuqjmsr5ahcq>;
    /**
     * An alias-to-account mapping was cleaned up.
     */
    "AliasCleanedUp": Anonymize<I5eoknm3d4b0hp>;
}>;
export type I53pb13fh9bdtb = {
    "who": bigint;
    "key": SizedHex<32>;
};
export type I5eoknm3d4b0hp = {
    "alias": Anonymize<Icq9999ubti4jr>;
    "account": SS58String;
};
export type I1267r4okm030g = {
    "who": bigint;
    "account": SS58String;
};
export type I6tuqjmsr5ahcq = {
    "people": Anonymize<Ic5m5lp1oioo8r>;
};
export type Ic5m5lp1oioo8r = Array<SizedHex<32>>;
export type Id02pn4ssbc7gd = AnonymousEnum<{
    /**
     * A case has been created.
     */
    "CaseCreated": Anonymize<Id1vp19i5a7adv>;
    /**
     * A callback was triggered from mob-rule.
     */
    "Callback": Anonymize<Iff4dsuaudcmul>;
    /**
     * There was a codec error when trying to execute the callback.
     */
    "CallbackError": undefined;
    /**
     * The case has been closed with the following result.
     */
    "CaseClosed": Anonymize<Ibi23t489qjaej>;
    /**
     * A vote has been placed on a case.
     */
    "Voted": Anonymize<I7v53d8lg25u6e>;
    /**
     * A vote has been cleaned.
     */
    "VoteCleaned": Anonymize<Ic01glfot2319>;
    /**
     * A case has been removed.
     */
    "CaseRemoved": Anonymize<Id1vp19i5a7adv>;
    /**
     * A case has been intervened.
     */
    "CaseIntervened": Anonymize<Ibi23t489qjaej>;
    /**
     * Credits for votes have been claimed.
     */
    "VotesClaimed": Anonymize<Ie732hi40q3bng>;
    /**
     * A reward that has been paid out.
     */
    "RewardPayout": Anonymize<I4auq2rk2vmnof>;
    /**
     * A new payout round has been started.
     */
    "PayoutRoundStarted": Anonymize<I36d2sa03ne4gv>;
    /**
     * Payout rounds have been scheduled.
     */
    "PayoutRoundsScheduled": Anonymize<I1c6o7t4005obp>;
    /**
     * A payout schedule has been removed.
     */
    "PayoutScheduleRemoved": Anonymize<I666bl2fqjkejo>;
    /**
     * Credit has been claimed from the payout distribution.
     */
    "CreditClaimed": Anonymize<Id0mmcnagcakpt>;
    /**
     * Stale voting points have been cleaned.
     */
    "PointsCleaned": Anonymize<I3sgg3ifcuhgsi>;
    /**
     * A case has been touched (re-evaluated).
     */
    "CaseTouched": Anonymize<I3fn79iu085nho>;
    /**
     * A voting penalty has been cleared.
     */
    "VotingPenaltyCleared": Anonymize<I1qepegjhn0439>;
}>;
export type Id1vp19i5a7adv = {
    /**
     * The case index that was created.
     */
    "case_index": number;
};
export type Ibi23t489qjaej = {
    /**
     * The case index that was closed.
     */
    "case_index": number;
    /**
     * The verdict of the closed case.
     */
    "verdict": Anonymize<Id32895epm7otq>;
};
export type I7v53d8lg25u6e = {
    /**
     * The case voted on.
     */
    "case_index": number;
    /**
     * The alias that voted.
     */
    "voter": SizedHex<32>;
    /**
     * The opinion of the voter.
     */
    "opinion": Anonymize<Id32895epm7otq>;
};
export type Ic01glfot2319 = {
    /**
     * The case voted on.
     */
    "case_index": number;
    /**
     * The alias that voted.
     */
    "voter": SizedHex<32>;
};
export type Ie732hi40q3bng = {
    /**
     * The alias that voted.
     */
    "voter": SizedHex<32>;
    /**
     * The case that has been intervened.
     */
    "case_indices": Anonymize<Icgljjb6j82uhn>;
};
export type Icgljjb6j82uhn = Array<number>;
export type I4auq2rk2vmnof = {
    /**
     * The alias that earned a reward.
     */
    "voter": SizedHex<32>;
    /**
     * The destination account for the payout.
     */
    "destination": SS58String;
    /**
     * The payout amount that was transferred.
     */
    "amount": bigint;
};
export type I36d2sa03ne4gv = {
    /**
     * The index of the new payout round.
     */
    "round": number;
    /**
     * The initial balance allocated for the round.
     */
    "initial_balance": bigint;
    /**
     * Total accumulated points claimable in this round.
     */
    "total_points": bigint;
};
export type I1c6o7t4005obp = {
    /**
     * The amount of funds per round.
     */
    "amount": bigint;
    /**
     * The number of rounds scheduled.
     */
    "count": number;
    /**
     * The minimum period (in blocks) between rounds.
     */
    "period": number;
};
export type I666bl2fqjkejo = {
    /**
     * The index of the removed schedule.
     */
    "index": number;
};
export type Id0mmcnagcakpt = {
    /**
     * The alias of the voter who claimed.
     */
    "voter": SizedHex<32>;
    /**
     * The amount of credit claimed.
     */
    "amount": bigint;
};
export type I3sgg3ifcuhgsi = {
    /**
     * The round index from which points were removed.
     */
    "round": number;
    /**
     * The alias whose points were removed.
     */
    "voter": SizedHex<32>;
};
export type I3fn79iu085nho = {
    /**
     * The case that was touched.
     */
    "case_index": number;
    /**
     * Whether the case was ripened as a result.
     */
    "ripened": boolean;
};
export type I1qepegjhn0439 = {
    /**
     * The alias whose penalty was cleared.
     */
    "who": SizedHex<32>;
};
export type I2p1svr0ek31rn = AnonymousEnum<{
    /**
     * Candidate applied for verification.
     */
    "CandidateApplied": Anonymize<I6v8sm60vvkmk7>;
    /**
     * Candidate opened a judicial case for their verification evidence.
     */
    "JudgementRequested": Anonymize<I6v8sm60vvkmk7>;
    /**
     * Oracle has provided the judgement for a judicial case.
     */
    "JudgementProvided": Anonymize<I3g1h0napekm89>;
    /**
     * A candidate has been granted a free retry attempt after a failure to verify their
     * evidence.
     */
    "RetryGranted": Anonymize<Ib4r095rdf5mqu>;
    /**
     * Register an account as a person.
     */
    "PersonRegistered": Anonymize<I816g8dafh3n9m>;
    /**
     * Person referred an account.
     */
    "CandidateReferred": Anonymize<I5rguq5hs7ae5g>;
    /**
     * Entropy for a candidate changed after expiry.
     */
    "Rerolled": Anonymize<I6v8sm60vvkmk7>;
    /**
     * Candidate committed to an ink design.
     */
    "DesignCommitted": Anonymize<Id0n15ml7mlce1>;
    /**
     * Storage fully allocated for a committed design.
     */
    "FullyAllocated": Anonymize<I6v8sm60vvkmk7>;
    /**
     * Candidate removed after timeout.
     */
    "TimedOut": Anonymize<I6v8sm60vvkmk7>;
    /**
     * Uncommitted candidate removed.
     */
    "FlakedOut": Anonymize<I6v8sm60vvkmk7>;
    /**
     * Referral ticket created by storing the public key on chain.
     */
    "TicketReferred": Anonymize<I95dvhl27mlrti>;
    /**
     * Referral ticket removed by removing the public key from chain storage.
     */
    "TicketCancelled": Anonymize<I95dvhl27mlrti>;
    /**
     * Candidate applied using a referral ticket.
     */
    "TicketApplied": Anonymize<I6mojmjujt2q9u>;
    /**
     * Design family added.
     */
    "FamilyAdded": Anonymize<Idnsos6tvi9tt6>;
    /**
     * All invites have been removed for the inviter.
     */
    "AllInvitesRemoved": Anonymize<I3j43dj5855fif>;
    /**
     * Some invites have been removed for the inviter, some are remaining.
     */
    "SomeInvitesRemoved": Anonymize<I3j43dj5855fif>;
    /**
     * Candidate applied using an invitation.
     */
    "InvitedCandidateApplied": Anonymize<I9m7e67l1rvair>;
    /**
     * A referrer's reward voucher has been registered.
     */
    "ReferralVoucherRegistered": Anonymize<I2fsu027d9jn8p>;
    /**
     * Invites have been granted to an account.
     */
    "InvitesGranted": Anonymize<Ibl1gaa0rn2c67>;
    /**
     * An invite ticket has been set.
     */
    "InviteTicketSet": Anonymize<I1858d79avs8nu>;
    /**
     * An invite ticket has been cancelled.
     */
    "InviteTicketCancelled": Anonymize<I1858d79avs8nu>;
    /**
     * The pallet configuration has been updated.
     */
    "ConfigurationSet": Anonymize<I4s48t49obgv40>;
}>;
export type I3g1h0napekm89 = {
    "account_id": SS58String;
    "judgement": Anonymize<Id32895epm7otq>;
};
export type Ib4r095rdf5mqu = {
    "account_id": SS58String;
    "failures": number;
};
export type I816g8dafh3n9m = {
    "account_id": SS58String;
    "personal_id": bigint;
};
export type I5rguq5hs7ae5g = {
    "referrer": bigint;
    "referred": SS58String;
};
export type Id0n15ml7mlce1 = {
    "account_id": SS58String;
    "reserved_id": bigint;
};
export type I95dvhl27mlrti = {
    "referrer": bigint;
    "ticket": SS58String;
};
export type I6mojmjujt2q9u = {
    "account_id": SS58String;
    "referrer": bigint;
};
export type Idnsos6tvi9tt6 = {
    "index": number;
    "kind": Anonymize<Iflispc7h2jput>;
    "id": SizedHex<32>;
};
export type Iflispc7h2jput = AnonymousEnum<{
    "Designed": Anonymize<Iafscmv8tjf0ou>;
    "ProceduralAccount": undefined;
    "ProceduralPersonal": undefined;
    "Procedural": {
        "range": number;
    };
}>;
export type I3j43dj5855fif = {
    "inviter": SS58String;
};
export type I9m7e67l1rvair = {
    "who": SS58String;
    "inviter": SS58String;
};
export type I2fsu027d9jn8p = {
    "referrer": bigint;
};
export type Ibl1gaa0rn2c67 = {
    "account": SS58String;
    "count": number;
};
export type I1858d79avs8nu = {
    "inviter": SS58String;
    "ticket": SS58String;
};
export type I4s48t49obgv40 = {
    "config": Anonymize<I63ubv9qb76gl3>;
};
export type I63ubv9qb76gl3 = {
    "reroll_timeout": number;
    "fasttrack_count": number;
    "maximum": number;
    "full_alloc_len": bigint;
    "full_alloc_count": number;
    "init_alloc_len": bigint;
    "init_alloc_count": number;
    "timeout": number;
};
export type Iassevcqno9q3q = AnonymousEnum<{
    /**
     * A new game is starting.
     */
    "NewGame": Anonymize<I4dge44jia159s>;
    /**
     * The game and its post-process has ended.
     */
    "GameEnded": Anonymize<I666bl2fqjkejo>;
    /**
     * The current game was force-killed by [`Config::ManagerOrigin`].
     */
    "GameKilled": Anonymize<I666bl2fqjkejo>;
    /**
     * The game phase durations were overridden by [`Config::ManagerOrigin`].
     */
    "GamePhasesSet": Anonymize<I7rcbn8l002fcc>;
    /**
     * A player signed up for the game.
     */
    "SignedUp": Anonymize<I7uvflbq4g7rn>;
    /**
     * A player submitted their report.
     */
    "ReportSubmitted": Anonymize<Icpl0grufrj09l>;
    /**
     * A player offboarded from the game.
     */
    "Offboarded": Anonymize<I7uvflbq4g7rn>;
    /**
     * An archived player was kicked out.
     */
    "KickedOut": Anonymize<Ibi26id9j1t520>;
    /**
     * Invites were granted to an account.
     */
    "InvitesGranted": Anonymize<Ibl1gaa0rn2c67>;
    /**
     * An invite ticket was set.
     */
    "InviteTicketSet": Anonymize<I3j43dj5855fif>;
    /**
     * An invite ticket was cancelled.
     */
    "InviteTicketCancelled": Anonymize<I3j43dj5855fif>;
    /**
     * Games were scheduled.
     */
    "GamesScheduled": Anonymize<Iafscmv8tjf0ou>;
    /**
     * A scheduled game was removed.
     */
    "ScheduledGameRemoved": Anonymize<Ic9lb0ksm6bqp9>;
    /**
     * Statement store usage removed for the account.
     */
    "StmtUsageRemoved": Anonymize<I1qepegjhn0439>;
    /**
     * All invites have been removed for the inviter.
     */
    "AllInvitesRemoved": Anonymize<I3j43dj5855fif>;
    /**
     * Some invites have been removed for the inviter, some are remaining.
     */
    "SomeInvitesRemoved": Anonymize<I3j43dj5855fif>;
    /**
     * The configured play deposit was updated.
     */
    "PlayDepositSet": Anonymize<I3qt1hgg4djhgb>;
    /**
     * An airdrop event was scheduled for the current game.
     */
    "AirdropScheduled": Anonymize<Irboug90jv3o0>;
    /**
     * The airdrop event for the current game failed to schedule.
     */
    "AirdropScheduleFailed": Anonymize<I33d7cg3ci0742>;
    /**
     * Game `game_index` was cancelled.
     */
    "GameCancelled": Anonymize<I8s2eo7q9t6vgf>;
}>;
export type I4dge44jia159s = {
    "registration_ends": number;
    "game_date": number;
    "report_ends": number;
};
export type I7rcbn8l002fcc = {
    "phases": Anonymize<I1mvbp74tfuinr>;
};
export type I1mvbp74tfuinr = {
    "registration": number;
    "shuffle": number;
    "post_shuffle_margin": number;
    "reporting": number;
    "player_process": number;
    "airdrop_claim_window": number;
};
export type I7uvflbq4g7rn = {
    "who": Anonymize<Iavh3dqjok18o8>;
};
export type Iavh3dqjok18o8 = AnonymousEnum<{
    "Account": SS58String;
    "Person": SizedHex<32>;
}>;
export type Icpl0grufrj09l = {
    "who": Anonymize<Iavh3dqjok18o8>;
    "game_index": number;
};
export type Ibi26id9j1t520 = {
    "player": Anonymize<Iavh3dqjok18o8>;
};
export type Ic9lb0ksm6bqp9 = {
    "game_play_time": number;
};
export type Irboug90jv3o0 = {
    "game_index": number;
    "event_id": SizedHex<32>;
};
export type I33d7cg3ci0742 = {
    "game_index": number;
    "error": Anonymize<I8rjgvnsb8ltnm>;
};
export type I8s2eo7q9t6vgf = {
    "game_index": number;
};
export type Idlsua02m53lrp = AnonymousEnum<{
    /**
     * A person has claimed credit.
     */
    "CreditClaimed": Anonymize<Ieitag1fl7hkds>;
    /**
     * Personhood was recognized for an account.
     */
    "PersonhoodRecognized": Anonymize<Ie060ubkeme5vs>;
    /**
     * Payout rounds have been scheduled.
     */
    "PayoutRoundsScheduled": Anonymize<Icpk5dvoekngbe>;
    /**
     * A payout schedule has been removed.
     */
    "PayoutScheduleRemoved": Anonymize<I666bl2fqjkejo>;
    /**
     * A round has been transitioned.
     */
    "RoundTransitioned": Anonymize<Iepoo00jurbs3c>;
    /**
     * A payout round has been operated (credit distributed to participants).
     */
    "PayoutRoundOperated": Anonymize<Iepoo00jurbs3c>;
    /**
     * A participant has cashed out score for points.
     */
    "CashedOut": Anonymize<I7uvflbq4g7rn>;
    /**
     * The personhood-threshold schedule has been set.
     */
    "PersonhoodThresholdScheduleSet": undefined;
    /**
     * The absence-grace schedule has been set.
     */
    "AbsenceGraceScheduleSet": undefined;
}>;
export type Ieitag1fl7hkds = {
    /**
     * The person who claimed credit.
     */
    "who": Anonymize<Iavh3dqjok18o8>;
    /**
     * Destination account that received the transfer.
     */
    "destination": SS58String;
    /**
     * Amount transferred.
     */
    "amount": bigint;
};
export type Ie060ubkeme5vs = {
    /**
     * The account whose personhood was recognized.
     */
    "who": Anonymize<Iavh3dqjok18o8>;
    /**
     * Whether this was resuming from suspension or first-time recognition.
     */
    "resumed": boolean;
};
export type Icpk5dvoekngbe = {
    /**
     * The amount per round.
     */
    "amount": bigint;
    /**
     * The number of rounds.
     */
    "count": number;
    /**
     * The duration per round in blocks.
     */
    "duration": number;
};
export type Iepoo00jurbs3c = {
    /**
     * The round index that was transitioned.
     */
    "round_index": number;
};
export type Inci5ucc4j6it = AnonymousEnum<{
    /**
     * A number of IDs was reserved.
     */
    "IdsReserved": Anonymize<Iafscmv8tjf0ou>;
    /**
     * An ID was renewed.
     */
    "IdRenewed": Anonymize<I4ov6e94l79mbg>;
    /**
     * A reserved ID was removed.
     */
    "IdUnreserved": Anonymize<I4ov6e94l79mbg>;
    /**
     * Register multiple people.
     */
    "PeopleRegistered": Anonymize<Iafscmv8tjf0ou>;
    /**
     * Suspend a number of people.
     */
    "PeopleSuspended": Anonymize<Iafscmv8tjf0ou>;
    /**
     * Someone's personhood was resumed.
     */
    "PersonhoodResumed": Anonymize<I4ov6e94l79mbg>;
    /**
     * The pallet enabled suspensions.
     */
    "SuspensionsStarted": undefined;
    /**
     * The pallet disabled suspensions.
     */
    "SuspensionsEnded": undefined;
}>;
export type I4ov6e94l79mbg = {
    "id": bigint;
};
export type I8rnqb4fs2u0s5 = AnonymousEnum<{
    /**
     * All attestation allowance has been removed for the verifier.
     */
    "AllAttestationAllowanceCleared": Anonymize<I58bu3hm7657hm>;
    /**
     * Attestation allowance was increased for an account by `count` attestations.
     */
    "AttestationAllowanceIncreased": Anonymize<Ibl1gaa0rn2c67>;
    /**
     * A new lite person was registered through attestation.
     */
    "PersonAttested": Anonymize<Icc0fkkhtd78sc>;
    /**
     * A lite person was registered as a consumer.
     */
    "ConsumerRegistered": Anonymize<Icbccs0ug47ilf>;
    /**
     * An alias-to-account mapping was set or updated.
     */
    "AliasAccountSet": Anonymize<I5eoknm3d4b0hp>;
    /**
     * An alias-to-account mapping was removed.
     */
    "AliasAccountUnset": Anonymize<I5eoknm3d4b0hp>;
}>;
export type I58bu3hm7657hm = {
    "verifier": SS58String;
};
export type Icc0fkkhtd78sc = {
    "candidate": SS58String;
    "verifier": SS58String;
};
export type Ibdjm4ghdk920m = AnonymousEnum<{
    /**
     * A person has registered as a consumer.
     */
    "PersonRegistered": Anonymize<I9vf1so75dnrom>;
    /**
     * A lite person has registered as a consumer.
     */
    "LitePersonRegistered": Anonymize<Icbccs0ug47ilf>;
    /**
     * Friend request statement usage has been assigned for a sequence.
     */
    "FriendRequestStmtUsageSet": Anonymize<I9hg8vptgbqai>;
    /**
     * Friend request statement usage has been removed.
     */
    "FriendRequestStmtUsageRemoved": Anonymize<Icbccs0ug47ilf>;
    /**
     * A person's authorization was touched.
     */
    "PersonAuthorizationTouched": Anonymize<Icbccs0ug47ilf>;
    /**
     * An expired username reservation was removed.
     */
    "ExpiredUsernameReservationRemoved": Anonymize<I28tfrqrmts741>;
    /**
     * A consumer's identifier key was updated.
     */
    "IdentifierKeyUpdated": Anonymize<Icbccs0ug47ilf>;
    /**
     * The username reservation duration was set.
     */
    "UsernameReservationDurationSet": Anonymize<I1i6t85s8phv1c>;
    /**
     * An anonymous statement store allowance was granted.
     */
    "StmtStoreAllowanceSet": Anonymize<I9hg8vptgbqai>;
    /**
     * Expired statement store allowances were cleaned up.
     */
    "StmtStoreAllowancesCleared": Anonymize<I16m4f7hclkkad>;
    /**
     * A full person was demoted due to expired authorization.
     */
    "PersonDemoted": Anonymize<Icbccs0ug47ilf>;
    /**
     * Long-term storage has been claimed for an account.
     */
    "LongTermStorageClaimed": Anonymize<I5dvnb65dm4f56>;
    /**
     * A long-term storage claim was accepted but the downstream allocation failed. The alias
     * is still marked spent for the period.
     */
    "LongTermStorageAllocationFailed": Anonymize<I5dvnb65dm4f56>;
    /**
     * Expired long-term storage aliases have been cleared for a period.
     */
    "LongTermStorageAliasesCleared": Anonymize<I2abip8j5bmg27>;
}>;
export type I9vf1so75dnrom = {
    "alias": SizedHex<32>;
    "account": SS58String;
};
export type I9hg8vptgbqai = {
    "alias": SizedHex<32>;
    "period": number;
    "seq": number;
    "account": SS58String;
};
export type I28tfrqrmts741 = {
    "username": Uint8Array;
    "account": SS58String;
};
export type I1i6t85s8phv1c = {
    "duration": bigint;
};
export type I16m4f7hclkkad = {
    "period": number;
    "first_key": SizedHex<32>;
    "count": number;
};
export type I5dvnb65dm4f56 = {
    "alias": SizedHex<32>;
    "period": number;
    "counter": number;
    "account": SS58String;
    "collection": Anonymize<I7fnmgdak2nuqf>;
};
export type I2abip8j5bmg27 = {
    "period": number;
    "count": number;
};
export type I2g1s4krv9s4p2 = AnonymousEnum<{
    /**
     * A new chunk page hash set has been initialized (e.g., during genesis).
     */
    "ChunkPageHashesInitialized": Anonymize<Ickpn0png35631>;
    /**
     * New chunks have been successfully added to an existing or new chunk set.
     */
    "ChunksAdded": Anonymize<I3ns5kg6jo268n>;
}>;
export type Ickpn0png35631 = {
    "ring_exponent": Anonymize<Idvob66qflhcgd>;
    "total_pages": number;
};
export type Idvob66qflhcgd = AnonymousEnum<{
    "R2e9": undefined;
    "R2e10": undefined;
    "R2e14": undefined;
}>;
export type I3ns5kg6jo268n = {
    "ring_exponent": Anonymize<Idvob66qflhcgd>;
    "start_index": number;
    "count": number;
};
export type If4h4847mmr709 = AnonymousEnum<{
    /**
     * An entity has had their membership recognised and indexed.
     */
    "MemberAdded": Anonymize<I7hu7hl7r35nrm>;
    /**
     * An entity has had their membership revoked.
     */
    "MemberRemoved": Anonymize<I7hu7hl7r35nrm>;
    /**
     * A collection has been marked for deletion.
     */
    "CollectionMarkedForDeletion": Anonymize<Idjiu7vp8ovdab>;
    /**
     * A collection has been fully deleted.
     */
    "CollectionDeleted": Anonymize<Idjiu7vp8ovdab>;
    /**
     * A ring root was built.
     */
    "RingBuilt": Anonymize<Idpufnltgsuodp>;
    /**
     * Members were onboarded.
     */
    "MembersOnboarded": Anonymize<Idjiu7vp8ovdab>;
    /**
     * Two rings were merged.
     */
    "RingsMerged": Anonymize<I6mk90q9np5nf3>;
    /**
     * The onboarding size was set for a collection.
     */
    "OnboardingSizeSet": Anonymize<Ichkkipipv6vbf>;
    /**
     * A member self-included into a ring.
     */
    "MemberSelfIncluded": Anonymize<Ia783as0f2ls27>;
    /**
     * An old root revision has been cleaned up.
     */
    "OldRootCleanedUp": Anonymize<I298u2lqese6h0>;
}>;
export type I7hu7hl7r35nrm = {
    "key": SizedHex<32>;
};
export type Idjiu7vp8ovdab = {
    "identifier": SizedHex<32>;
};
export type Idpufnltgsuodp = {
    "identifier": SizedHex<32>;
    "ring_index": number;
};
export type I6mk90q9np5nf3 = {
    "identifier": SizedHex<32>;
    "base_ring_index": number;
    "target_ring_index": number;
};
export type Ichkkipipv6vbf = {
    "identifier": SizedHex<32>;
    "onboarding_size": number;
};
export type Ia783as0f2ls27 = {
    "identifier": SizedHex<32>;
    "key": SizedHex<32>;
};
export type I298u2lqese6h0 = {
    "identifier": SizedHex<32>;
    "ring_index": number;
    "revision": number;
};
export type Id7j62tudmp73q = AnonymousEnum<{
    "CoinSplit": Anonymize<I4c20l83g9496a>;
    "CoinTransferred": Anonymize<I4gp88defd7an>;
    "RecyclerLoadedWithCoin": Anonymize<Icnkee0to4c5ac>;
    "RecyclerLoadedWithExternalAsset": Anonymize<Id113tpicu8sh3>;
    "RecyclerUnloadedIntoCoin": Anonymize<I6ceb7pmur4hki>;
    "RecyclerUnloadedIntoExternalAsset": Anonymize<Ie2d9d2u1qa7ro>;
    "RecyclerUnloadedIntoExternalAssetAndVouchers": Anonymize<Iebdi09jg1ifvr>;
    "PaidUnloadTokenRegisteredWithCoin": Anonymize<I5kek6hgenovr0>;
    "PaidUnloadTokenRegisteredWithNative": Anonymize<I91tbphb2dk7gn>;
    "PaidUnloadTokenRegisteredWithStable": Anonymize<I91tbphb2dk7gn>;
    "PeopleFreeUnloadTokenConsumed": Anonymize<I7ts20td7b1pmf>;
    "LitePeopleFreeUnloadTokenConsumed": Anonymize<I7ts20td7b1pmf>;
    "RecyclersUnloadedIntoCoin": Anonymize<I5509mqtnio180>;
    "RecyclersUnloadedIntoExternalAsset": Anonymize<Ifojd05k7ogo8n>;
    "RecyclersUnloadedIntoExternalAssetNonAnonymous": Anonymize<I2h93i19beq4qk>;
    "RecyclerUnloadedIntoCoins": Anonymize<I4c20l83g9496a>;
    "CoinOffboardedIntoExternalAsset": Anonymize<I4lmgf1qe39res>;
    "RecyclerCleaned": Anonymize<Igvk3mrc51o9l>;
    "ConsumedFreeTokensCleaned": Anonymize<I7ts20td7b1pmf>;
    "PaidUnloadTokenRingCleaned": Anonymize<I7315hlp5liq47>;
    "RecyclerDustCleaned": undefined;
    "PaidUnloadTokenDustCleaned": undefined;
    "ExpiredPaidUnloadTokenCollectionDeleted": Anonymize<I7ts20td7b1pmf>;
    "UnderlyingAssetIdSet": Anonymize<I22bm4d7re21j9>;
}>;
export type I4c20l83g9496a = {
    "output_count": number;
};
export type I4gp88defd7an = {
    "to": SS58String;
    "value": number;
    "new_age": number;
};
export type Icnkee0to4c5ac = {
    "value": number;
};
export type Id113tpicu8sh3 = {
    "who": SS58String;
    "value": number;
    "amount": bigint;
};
export type I6ceb7pmur4hki = {
    "to": SS58String;
    "input_value": number;
    "output_value": number;
    "input_count": number;
};
export type Ie2d9d2u1qa7ro = {
    "to": SS58String;
    "value": number;
    "input_count": number;
    "amount": bigint;
};
export type Iebdi09jg1ifvr = {
    "to": SS58String;
    "value": number;
    "input_count": number;
    "external_asset_amount": bigint;
    "voucher_count": number;
};
export type I5kek6hgenovr0 = {
    "fee": bigint;
    "destroyed": bigint;
};
export type I91tbphb2dk7gn = {
    "who": SS58String;
    "fee": bigint;
};
export type I7ts20td7b1pmf = {
    "period": number;
};
export type I5509mqtnio180 = {
    "to": SS58String;
    "output_value": number;
    "input_count": number;
};
export type Ifojd05k7ogo8n = {
    "to": SS58String;
    "input_count": number;
    "amount": bigint;
};
export type I2h93i19beq4qk = {
    "who": SS58String;
    "to": SS58String;
    "input_count": number;
    "amount": bigint;
    "fee_currency": Anonymize<I1h1i9ifhurrkc>;
};
export type I1h1i9ifhurrkc = AnonymousEnum<{
    "Native": undefined;
    "Stable": undefined;
}>;
export type I4lmgf1qe39res = {
    "to": SS58String;
    "value": number;
    "amount": bigint;
};
export type Igvk3mrc51o9l = {
    "value": number;
    "remaining_coins": number;
    "destroyed_amount": bigint;
};
export type I7315hlp5liq47 = {
    "period": number;
    "ring_index": number;
};
export type Ieg96uk2l11u40 = AnonymousEnum<{
    /**
     * A parachain subscribed.
     */
    "Subscribed": Anonymize<I37r4bdai8o9mp>;
    /**
     * A parachain unsubscribed.
     */
    "Unsubscribed": Anonymize<I37r4bdai8o9mp>;
    /**
     * Update batch sent to subscriber.
     */
    "UpdatesSent": Anonymize<Ifrvjscp9m1e73>;
    /**
     * Sending ring root updates to a subscriber failed.
     */
    "UpdateSendFailed": Anonymize<I37r4bdai8o9mp>;
    /**
     * Replay of ring roots requested by a subscriber.
     */
    "ReplayRequested": Anonymize<Iamcee9e6bogsv>;
    /**
     * A stuck batch was abandoned by the offchain worker.
     */
    "BatchAbandoned": Anonymize<I2e1ek76m34991>;
}>;
export type I37r4bdai8o9mp = {
    "para_id": number;
};
export type Ifrvjscp9m1e73 = {
    "para_id": number;
    "update_count": number;
};
export type Iamcee9e6bogsv = {
    "para_id": number;
    "identifier": SizedHex<32>;
    "indices_count": number;
};
export type I2e1ek76m34991 = {
    "sequence": bigint;
};
export type Ic05g466md6v74 = AnonymousEnum<{
    "EventScheduled": Anonymize<Ib4o08d7u3o37d>;
    "ScheduledEventRemoved": Anonymize<Ib4o08d7u3o37d>;
    "EventCancelled": Anonymize<Ib4o08d7u3o37d>;
    "RegistrationStarted": Anonymize<Ib4o08d7u3o37d>;
    "AliasRegistered": Anonymize<I50aksks5it5n0>;
    "AccountRegistered": Anonymize<Icc5o3lh1v2smd>;
    "DrawingWinners": Anonymize<I5srndmgodi29b>;
    "ClaimingStarted": Anonymize<I5srndmgodi29b>;
    "EventCanceled": Anonymize<Ib4o08d7u3o37d>;
    "PrizeClaimed": Anonymize<Idd6sihggmv1dq>;
    "ClearingRegistrations": Anonymize<I1obalebkt2h11>;
    "ClearingWinners": Anonymize<Ib4o08d7u3o37d>;
    "FinalizingEvent": Anonymize<Ib4o08d7u3o37d>;
    "EventCompleted": Anonymize<Ib4o08d7u3o37d>;
    "AssetEnabled": Anonymize<I2gbrv9jm3ucsu>;
    "AssetDisabled": Anonymize<I9pgrv71u9hf6c>;
}>;
export type Ib4o08d7u3o37d = {
    "event_id": SizedHex<32>;
};
export type I50aksks5it5n0 = {
    "event_id": SizedHex<32>;
    "slot": SizedHex<32>;
    "participant_origin": Anonymize<I6cunlo5qsnfm5>;
};
export type I6cunlo5qsnfm5 = AnonymousEnum<{
    "Alias": Anonymize<Ifcon2ngg4leli>;
    "Account": Anonymize<I6v8sm60vvkmk7>;
}>;
export type Icc5o3lh1v2smd = {
    "event_id": SizedHex<32>;
    "slot": SizedHex<32>;
    "account_id": SS58String;
};
export type I5srndmgodi29b = {
    "event_id": SizedHex<32>;
    "effective_winners": number;
};
export type Idd6sihggmv1dq = {
    "event_id": SizedHex<32>;
    "slot": SizedHex<32>;
    "beneficiary": SS58String;
    "asset_id": Anonymize<If9iqq7i64mur8>;
    "amount": bigint;
};
export type I1obalebkt2h11 = {
    "event_id": SizedHex<32>;
    "unclaimed": number;
};
export type I2gbrv9jm3ucsu = {
    "asset_id": Anonymize<If9iqq7i64mur8>;
    "funded": bigint;
};
export type I9pgrv71u9hf6c = {
    "asset_id": Anonymize<If9iqq7i64mur8>;
    "refunded": bigint;
};
export type I6kiujajvpvk8a = AnonymousEnum<{
    /**
     * A subject was voted on with a previously unused point.
     */
    "VoteCast": Anonymize<Ib2kb4gr1v6eis>;
    /**
     * A point was redirected from one subject to another.
     */
    "VoteReused": Anonymize<Ib52ld1ackp05u>;
    /**
     * The honour score of a subject has changed.
     */
    "HonourChanged": Anonymize<I619o495nctj82>;
}>;
export type Ib2kb4gr1v6eis = {
    /**
     * The subject that was voted on.
     */
    "subject": SizedHex<32>;
    /**
     * The direction of the vote.
     */
    "direction": Anonymize<Ia31ehvm9n25pi>;
};
export type Ia31ehvm9n25pi = AnonymousEnum<{
    "Honourable": undefined;
    "Dishonourable": undefined;
}>;
export type Ib52ld1ackp05u = {
    /**
     * The subject that previously held the redirected point.
     */
    "old_subject": SizedHex<32>;
    /**
     * The previous direction of the point.
     */
    "old_direction": Anonymize<Ia31ehvm9n25pi>;
    /**
     * The subject that now holds the redirected point.
     */
    "new_subject": SizedHex<32>;
    /**
     * The new direction of the vote.
     */
    "new_direction": Anonymize<Ia31ehvm9n25pi>;
};
export type I619o495nctj82 = {
    /**
     * The subject whose honour score changed.
     */
    "subject": SizedHex<32>;
    /**
     * The honour value before the update.
     */
    "old_value": number;
    /**
     * The honour value after the update.
     */
    "new_value": number;
};
export type I7l1gg2sl9pcgr = AnonymousEnum<{
    /**
     * The foreign asset was created and reserves were set.
     */
    "AssetCreated": undefined;
    /**
     * An XCM funds transfer was sent to Asset Hub.
     */
    "XcmFundsTransferSent": undefined;
    /**
     * The XCM transfer timed out and will be retried.
     */
    "XcmFundsTransferTimedOut": undefined;
    /**
     * Transferred funds have been verified.
     */
    "FundsVerified": undefined;
    /**
     * All pots have been funded.
     */
    "PotsFunded": undefined;
    /**
     * People Lite attestation allowances have been set.
     */
    "PeopleLiteAttestationAllowancesSet": undefined;
    /**
     * Mob Rule payout schedule has been set.
     */
    "MobRulePayoutsScheduled": undefined;
    /**
     * Score payout schedule has been set.
     */
    "ScorePayoutsScheduled": undefined;
    /**
     * The one-time on_poll initialization has completed.
     */
    "OnPollInitializationCompleted": undefined;
    /**
     * Migration: initial people have been recognized.
     */
    "MigrationPeopleRecognized": undefined;
    /**
     * Migration: onboarding size has been set.
     */
    "MigrationOnboardingSizeSet": undefined;
    /**
     * Migration: Proof-of-Ink pallet has been initialized.
     */
    "MigrationProofOfInkInitialized": undefined;
    /**
     * Migration: games have been scheduled.
     */
    "MigrationGamesScheduled": undefined;
    /**
     * Migration: invites have been granted.
     */
    "MigrationInvitesGranted": undefined;
    /**
     * Migration: Proof-of-Ink reimbursement values have been set.
     */
    "MigrationReimbursementValuesSet": undefined;
    /**
     * Migration: People Lite attestation allowances have been set.
     */
    "MigrationAttestationAllowancesSet": undefined;
    /**
     * Migration has completed and on_poll initialization has been triggered.
     */
    "MigrationCompleted": undefined;
}>;
export type I94co7vj7h6bo = AnonymousEnum<{
    /**
     * A Runtime upgrade started.
     *
     * Its end is indicated by `UpgradeCompleted` or `UpgradeFailed`.
     */
    "UpgradeStarted": Anonymize<If1co0pilmi7oq>;
    /**
     * The current runtime upgrade completed.
     *
     * This implies that all of its migrations completed successfully as well.
     */
    "UpgradeCompleted": undefined;
    /**
     * Runtime upgrade failed.
     *
     * This is very bad and will require governance intervention.
     */
    "UpgradeFailed": undefined;
    /**
     * A migration was skipped since it was already executed in the past.
     */
    "MigrationSkipped": Anonymize<I666bl2fqjkejo>;
    /**
     * A migration progressed.
     */
    "MigrationAdvanced": Anonymize<Iae74gjak1qibn>;
    /**
     * A Migration completed.
     */
    "MigrationCompleted": Anonymize<Iae74gjak1qibn>;
    /**
     * A Migration failed.
     *
     * This implies that the whole upgrade failed and governance intervention is required.
     */
    "MigrationFailed": Anonymize<Iae74gjak1qibn>;
    /**
     * The set of historical migrations has been cleared.
     */
    "HistoricCleared": Anonymize<I3escdojpj0551>;
}>;
export type If1co0pilmi7oq = {
    /**
     * The number of migrations that this upgrade contains.
     *
     * This can be used to design a progress indicator in combination with counting the
     * `MigrationCompleted` and `MigrationSkipped` events.
     */
    "migrations": number;
};
export type Iae74gjak1qibn = {
    /**
     * The index of the migration within the [`Config::Migrations`] list.
     */
    "index": number;
    /**
     * The number of blocks that this migration took so far.
     */
    "took": number;
};
export type I3escdojpj0551 = {
    /**
     * Should be passed to `clear_historic` in a successive call.
     */
    "next_cursor"?: Anonymize<Iabpgqcjikia83>;
};
export type Iabpgqcjikia83 = (Uint8Array) | undefined;
export type I95g6i7ilua7lq = Array<Anonymize<I9jd27rnpm8ttv>>;
export type I9jd27rnpm8ttv = FixedSizeArray<2, number>;
export type Ieniouoqkq4icf = {
    "spec_version": number;
    "spec_name": string;
};
export type I8re9183nrhr3n = AnonymousEnum<{
    "FullCore": {
        "context": number;
    };
    "PotentialFullCore": {
        "context": number;
        "first_transaction_index"?: Anonymize<I4arjljr6dpflb>;
        "target_weight": Anonymize<I4q39t5hn830vp>;
    };
    "FractionOfCore": {
        "context": number;
        "first_transaction_index"?: Anonymize<I4arjljr6dpflb>;
    };
}>;
export type I4arjljr6dpflb = (number) | undefined;
export type I1v7jbnil3tjns = Array<{
    "used_bandwidth": Anonymize<Ieafp1gui1o4cl>;
    "para_head_hash"?: Anonymize<I4s6vifaf8k998>;
    "consumed_go_ahead_signal"?: Anonymize<Iav8k1edbj86k7>;
}>;
export type Ieafp1gui1o4cl = {
    "ump_msg_count": number;
    "ump_total_bytes": number;
    "hrmp_outgoing": Array<[number, {
        "msg_count": number;
        "total_bytes": number;
    }]>;
};
export type Iav8k1edbj86k7 = (UpgradeGoAhead) | undefined;
export type UpgradeGoAhead = Enum<{
    "Abort": undefined;
    "GoAhead": undefined;
}>;
export declare const UpgradeGoAhead: GetEnum<UpgradeGoAhead>;
export type I8jgj1nhcr2dg8 = {
    "used_bandwidth": Anonymize<Ieafp1gui1o4cl>;
    "hrmp_watermark"?: Anonymize<I4arjljr6dpflb>;
    "consumed_go_ahead_signal"?: Anonymize<Iav8k1edbj86k7>;
};
export type Ifn6q3equiq9qi = {
    "parent_head": Uint8Array;
    "relay_parent_number": number;
    "relay_parent_storage_root": SizedHex<32>;
    "max_pov_size": number;
};
export type Ia3sb0vgvovhtg = (UpgradeRestriction) | undefined;
export type UpgradeRestriction = Enum<{
    "Present": undefined;
}>;
export declare const UpgradeRestriction: GetEnum<UpgradeRestriction>;
export type I4i91h98n3cv1b = {
    "dmq_mqc_head": SizedHex<32>;
    "relay_dispatch_queue_remaining_capacity": {
        "remaining_count": number;
        "remaining_size": number;
    };
    "ingress_channels": Array<[number, {
        "max_capacity": number;
        "max_total_size": number;
        "max_message_size": number;
        "msg_count": number;
        "total_size": number;
        "mqc_head"?: Anonymize<I4s6vifaf8k998>;
    }]>;
    "egress_channels": Array<[number, {
        "max_capacity": number;
        "max_total_size": number;
        "max_message_size": number;
        "msg_count": number;
        "total_size": number;
        "mqc_head"?: Anonymize<I4s6vifaf8k998>;
    }]>;
};
export type I4iumukclgj8ej = {
    "max_code_size": number;
    "max_head_data_size": number;
    "max_upward_queue_count": number;
    "max_upward_queue_size": number;
    "max_upward_message_size": number;
    "max_upward_message_num_per_candidate": number;
    "hrmp_max_message_num_per_candidate": number;
    "validation_upgrade_cooldown": number;
    "validation_upgrade_delay": number;
    "async_backing_params": {
        "max_candidate_depth": number;
        "allowed_ancestry_len": number;
    };
};
export type Iqnbvitf7a7l3 = Array<Anonymize<I4p5t2krb1gmvp>>;
export type I4p5t2krb1gmvp = [number, SizedHex<32>];
export type I48i407regf59r = {
    "sent_at": number;
    "reverse_idx": number;
};
export type I6r5cbv8ttrb09 = Array<{
    "recipient": number;
    "data": Uint8Array;
}>;
export type Inofn0qqbjtb9 = {
    "relay_storage_root_or_hash": SizedHex<32>;
    "core_selector": number;
    "bundle_index": number;
    "ump_msg_count": number;
    "hrmp_outbound_count": number;
    "hrmp_outbound_recipients": Anonymize<Icgljjb6j82uhn>;
};
export type I8ds64oj6581v0 = Array<{
    "id": SizedHex<8>;
    "amount": bigint;
    "reasons": BalancesTypesReasons;
}>;
export type BalancesTypesReasons = Enum<{
    "Fee": undefined;
    "Misc": undefined;
    "All": undefined;
}>;
export declare const BalancesTypesReasons: GetEnum<BalancesTypesReasons>;
export type Ia7pdug7cdsg8g = Array<{
    "id": SizedHex<8>;
    "amount": bigint;
}>;
export type Iff83br6to6vp5 = Array<{
    "id": Anonymize<I7sdoogtdsfine>;
    "amount": bigint;
}>;
export type I9bin2jc70qt6q = Array<Anonymize<I3qt1hgg4djhgb>>;
export type TransactionPaymentReleases = Enum<{
    "V1Ancient": undefined;
    "V2": undefined;
}>;
export declare const TransactionPaymentReleases: GetEnum<TransactionPaymentReleases>;
export type Icj0tssrh6ika3 = {
    "used": bigint;
    "at_block": number;
};
export type I3qklfjubrljqh = {
    "owner": SS58String;
    "issuer": SS58String;
    "admin": SS58String;
    "freezer": SS58String;
    "supply": bigint;
    "deposit": bigint;
    "min_balance": bigint;
    "is_sufficient": boolean;
    "accounts": number;
    "sufficients": number;
    "approvals": number;
    "status": Enum<{
        "Live": undefined;
        "Frozen": undefined;
        "Destroying": undefined;
    }>;
};
export type Iag3f1hum3p4c8 = {
    "balance": bigint;
    "status": Enum<{
        "Liquid": undefined;
        "Frozen": undefined;
        "Blocked": undefined;
    }>;
    "reason": Enum<{
        "Consumer": undefined;
        "Sufficient": undefined;
        "DepositHeld": bigint;
        "DepositRefunded": undefined;
        "DepositFrom": [SS58String, bigint];
    }>;
};
export type I4v5g6i7bmt06o = [Anonymize<If9iqq7i64mur8>, SS58String];
export type I4s6jkha20aoh0 = {
    "amount": bigint;
    "deposit": bigint;
};
export type I84bhscllvv07n = [Anonymize<If9iqq7i64mur8>, SS58String, SS58String];
export type I78s05f59eoi8b = {
    "deposit": bigint;
    "name": Uint8Array;
    "symbol": Uint8Array;
    "decimals": number;
    "is_frozen": boolean;
};
export type Ifi4da1gej1fri = Array<Anonymize<Iep1lmt6q3s6r3>>;
export type Ifvgo9568rpmqc = Array<Anonymize<I8uo3fpd3bcc6f>>;
export type I8uo3fpd3bcc6f = [SS58String, SizedHex<32>];
export type I6cs1itejju2vv = [bigint, number];
export type I9pvau8qut93lg = Array<{
    "recipient": number;
    "state": Enum<{
        "Ok": undefined;
        "Suspended": undefined;
    }>;
    "signals_exist": boolean;
    "first_index": number;
    "last_index": number;
    "flags": number;
}>;
export type I5g2vv0ckl2m8b = [number, number];
export type Ifup3lg9ro8a0f = {
    "suspend_threshold": number;
    "drop_threshold": number;
    "resume_threshold": number;
};
export type I5qfubnuvrnqn6 = AnonymousEnum<{
    "Pending": {
        "responder": XcmVersionedLocation;
        "maybe_match_querier"?: (XcmVersionedLocation) | undefined;
        "maybe_notify"?: (SizedHex<2>) | undefined;
        "timeout": number;
    };
    "VersionNotifier": {
        "origin": XcmVersionedLocation;
        "is_active": boolean;
    };
    "Ready": {
        "response": Enum<{
            "V3": XcmV3Response;
            "V4": XcmV4Response;
            "V5": Anonymize<I7vucpgm2c6959>;
        }>;
        "at": number;
    };
}>;
export type XcmV3Response = Enum<{
    "Null": undefined;
    "Assets": Anonymize<Iai6dhqiq3bach>;
    "ExecutionResult"?: Anonymize<I7sltvf8v2nure>;
    "Version": number;
    "PalletsInfo": Anonymize<I599u7h20b52at>;
    "DispatchResult": XcmV3MaybeErrorCode;
}>;
export declare const XcmV3Response: GetEnum<XcmV3Response>;
export type I7sltvf8v2nure = ([number, XcmV3TraitsError]) | undefined;
export type XcmV3TraitsError = Enum<{
    "Overflow": undefined;
    "Unimplemented": undefined;
    "UntrustedReserveLocation": undefined;
    "UntrustedTeleportLocation": undefined;
    "LocationFull": undefined;
    "LocationNotInvertible": undefined;
    "BadOrigin": undefined;
    "InvalidLocation": undefined;
    "AssetNotFound": undefined;
    "FailedToTransactAsset": undefined;
    "NotWithdrawable": undefined;
    "LocationCannotHold": undefined;
    "ExceedsMaxMessageSize": undefined;
    "DestinationUnsupported": undefined;
    "Transport": undefined;
    "Unroutable": undefined;
    "UnknownClaim": undefined;
    "FailedToDecode": undefined;
    "MaxWeightInvalid": undefined;
    "NotHoldingFees": undefined;
    "TooExpensive": undefined;
    "Trap": bigint;
    "ExpectationFalse": undefined;
    "PalletNotFound": undefined;
    "NameMismatch": undefined;
    "VersionIncompatible": undefined;
    "HoldingWouldOverflow": undefined;
    "ExportError": undefined;
    "ReanchorFailed": undefined;
    "NoDeal": undefined;
    "FeesNotMet": undefined;
    "LockError": undefined;
    "NoPermission": undefined;
    "Unanchored": undefined;
    "NotDepositable": undefined;
    "UnhandledXcmVersion": undefined;
    "WeightLimitReached": Anonymize<I4q39t5hn830vp>;
    "Barrier": undefined;
    "WeightNotComputable": undefined;
    "ExceedsStackLimit": undefined;
}>;
export declare const XcmV3TraitsError: GetEnum<XcmV3TraitsError>;
export type XcmV4Response = Enum<{
    "Null": undefined;
    "Assets": Anonymize<I50mli3hb64f9b>;
    "ExecutionResult"?: Anonymize<I7sltvf8v2nure>;
    "Version": number;
    "PalletsInfo": Anonymize<I599u7h20b52at>;
    "DispatchResult": XcmV3MaybeErrorCode;
}>;
export declare const XcmV4Response: GetEnum<XcmV4Response>;
export type I8t3u2dv73ahbd = [number, XcmVersionedLocation];
export type I7vlvrrl2pnbgk = [bigint, Anonymize<I4q39t5hn830vp>, number];
export type Ie0rpl5bahldfk = Array<[XcmVersionedLocation, number]>;
export type XcmPalletVersionMigrationStage = Enum<{
    "MigrateSupportedVersion": undefined;
    "MigrateVersionNotifiers": undefined;
    "NotifyCurrentTargets"?: Anonymize<Iabpgqcjikia83>;
    "MigrateAndNotifyOldTargets": undefined;
}>;
export declare const XcmPalletVersionMigrationStage: GetEnum<XcmPalletVersionMigrationStage>;
export type I7e5oaj2qi4kl1 = {
    "amount": bigint;
    "owner": XcmVersionedLocation;
    "locker": XcmVersionedLocation;
    "consumers": Array<[undefined, bigint]>;
};
export type Ie849h3gncgvok = [number, SS58String, XcmVersionedAssetId];
export type XcmVersionedAssetId = Enum<{
    "V3": XcmV3MultiassetAssetId;
    "V4": Anonymize<I4c0s5cioidn76>;
    "V5": Anonymize<If9iqq7i64mur8>;
}>;
export declare const XcmVersionedAssetId: GetEnum<XcmVersionedAssetId>;
export type Iat62vud7hlod2 = Array<[bigint, XcmVersionedLocation]>;
export type Ici7ejds60vj52 = {
    "aliasers": Anonymize<I41j3fc5ema929>;
};
export type I41j3fc5ema929 = Array<{
    "location": XcmVersionedLocation;
    "expiry"?: Anonymize<I35p85j063s0il>;
}>;
export type Idh2ug6ou4a8og = {
    "begin": number;
    "end": number;
    "count": number;
    "ready_neighbours"?: ({
        "prev": Anonymize<Iejeo53sea6n4q>;
        "next": Anonymize<Iejeo53sea6n4q>;
    }) | undefined;
    "message_count": bigint;
    "size": bigint;
};
export type I53esa2ms463bk = {
    "remaining": number;
    "remaining_size": number;
    "first_index": number;
    "first": number;
    "last": number;
    "heap": Uint8Array;
};
export type Ib4jhb8tt3uung = [Anonymize<Iejeo53sea6n4q>, number];
export type Iag146hmjgqfgj = {
    "when": Anonymize<Itvprrpb0nm3o>;
    "deposit": bigint;
    "depositor": SS58String;
    "approvals": Anonymize<Ia2lhg7l2hilo3>;
};
export type I48e2fe747rjco = [Array<{
    "delegate": SS58String;
    "proxy_type": Anonymize<Ieuemnllefri8h>;
    "delay": number;
}>, bigint];
export type I9p9lq3rej5bhc = [Array<{
    "real": SS58String;
    "call_hash": SizedHex<32>;
    "height": number;
}>, bigint];
export type I8sp8i1c9u7kvv = {
    "judgements": Array<[number, Anonymize<Icl2bbh90k7l2q>]>;
    "deposit": bigint;
    "info": Anonymize<Ibr5qtvptt8691>;
};
export type Icl2bbh90k7l2q = AnonymousEnum<{
    "Unknown": undefined;
    "FeePaid": bigint;
    "Reasonable": undefined;
    "KnownGood": undefined;
    "OutOfDate": undefined;
    "LowQuality": undefined;
    "Erroneous": undefined;
    "External": undefined;
}>;
export type Ibr5qtvptt8691 = {
    "display": IdentityData;
    "legal": IdentityData;
    "web": IdentityData;
    "matrix": IdentityData;
    "email": IdentityData;
    "pgp_fingerprint"?: (SizedHex<20>) | undefined;
    "image": IdentityData;
    "twitter": IdentityData;
    "github": IdentityData;
    "discord": IdentityData;
};
export type IdentityData = Enum<{
    "None": undefined;
    "Raw0": undefined;
    "Raw1": number;
    "Raw2": SizedHex<2>;
    "Raw3": SizedHex<3>;
    "Raw4": SizedHex<4>;
    "Raw5": SizedHex<5>;
    "Raw6": SizedHex<6>;
    "Raw7": SizedHex<7>;
    "Raw8": SizedHex<8>;
    "Raw9": SizedHex<9>;
    "Raw10": SizedHex<10>;
    "Raw11": SizedHex<11>;
    "Raw12": SizedHex<12>;
    "Raw13": SizedHex<13>;
    "Raw14": SizedHex<14>;
    "Raw15": SizedHex<15>;
    "Raw16": SizedHex<16>;
    "Raw17": SizedHex<17>;
    "Raw18": SizedHex<18>;
    "Raw19": SizedHex<19>;
    "Raw20": SizedHex<20>;
    "Raw21": SizedHex<21>;
    "Raw22": SizedHex<22>;
    "Raw23": SizedHex<23>;
    "Raw24": SizedHex<24>;
    "Raw25": SizedHex<25>;
    "Raw26": SizedHex<26>;
    "Raw27": SizedHex<27>;
    "Raw28": SizedHex<28>;
    "Raw29": SizedHex<29>;
    "Raw30": SizedHex<30>;
    "Raw31": SizedHex<31>;
    "Raw32": SizedHex<32>;
    "BlakeTwo256": SizedHex<32>;
    "Sha256": SizedHex<32>;
    "Keccak256": SizedHex<32>;
    "ShaThree256": SizedHex<32>;
}>;
export declare const IdentityData: GetEnum<IdentityData>;
export type I910puuahutflf = [SS58String, IdentityData];
export type I4nfjdef0ibh44 = [bigint, Anonymize<Ia2lhg7l2hilo3>];
export type I74af64m08r6as = Array<({
    "account": SS58String;
    "fee": bigint;
    "fields": bigint;
}) | undefined>;
export type Ic8ann3kre6vdm = {
    "account_id": SS58String;
    "allocation": number;
};
export type I1j72qfgdejqsv = {
    "owner": SS58String;
    "provider": Anonymize<Idib8jf3ve40bj>;
};
export type Idib8jf3ve40bj = AnonymousEnum<{
    "Allocation": undefined;
    "AuthorityDeposit": bigint;
    "System": undefined;
}>;
export type I60biiepd74113 = [SS58String, number, Anonymize<Idib8jf3ve40bj>];
export type I2skcsqibb3i2k = {
    "account": SS58String;
    "pending_judgements": Array<[Anonymize<Ifgk0bca7f05om>, number]>;
    "banned": boolean;
    "username_last_reported_at"?: Anonymize<I4arjljr6dpflb>;
};
export type Ifgk0bca7f05om = AnonymousEnum<{
    "Twitter": Anonymize<Ie5l999tf7t2te>;
    "Github": Anonymize<Ie5l999tf7t2te>;
    "Discord": {
        "display_and_tag": Uint8Array;
    };
}>;
export type I4ekkp6f1d7a69 = {
    "reporter": SS58String;
    "username": Uint8Array;
    "case_id": number;
};
export type Ifpolrv9bn0ss8 = {
    "key": SizedHex<32>;
    "account"?: Anonymize<Ihfphjolmsqq1>;
};
export type I5h2gdbrcdulu5 = {
    "voted": number;
    "cleaned": number;
    "correct": number;
    "credit": bigint;
};
export type I14eopu9hl6hgk = {
    "since": bigint;
    "details": Anonymize<Ib15skbo4cf2mg>;
    "tally": {
        "aye": number;
        "nay": number;
        "contempt": number;
    };
};
export type Ib15skbo4cf2mg = {
    "statement": Enum<{
        "ProofOfInk": {
            "design": Anonymize<I8p7pbmodi01pv>;
            "evidence": SizedHex<32>;
            "probable_acceptable": boolean;
        };
        "IdentityCredential": {
            "platform": Anonymize<Ifgk0bca7f05om>;
            "evidence": Uint8Array;
        };
        "UsernameValid": Anonymize<Ie5l999tf7t2te>;
    }>;
    "context": Uint8Array;
    "callback": {
        "pallet_index": number;
        "call_index": number;
    };
};
export type I8p7pbmodi01pv = AnonymousEnum<{
    "DesignedElective": Anonymize<I9jd27rnpm8ttv>;
    "ProceduralAccount": Anonymize<I4p5t2krb1gmvp>;
    "ProceduralPersonal": [number, bigint];
    "Procedural": [number, SizedHex<4>];
}>;
export type Iaq1a4h34blh5u = {
    "details": Anonymize<Ib15skbo4cf2mg>;
    "verdict": Anonymize<Id32895epm7otq>;
};
export type Ieaqfchj8o5p3e = {
    "since": bigint;
    "verdict": Anonymize<Id32895epm7otq>;
};
export type Ia11lg4mrmjqfg = {
    "round": number;
    "initial_balance": bigint;
    "remaining_balance": bigint;
    "total_points": bigint;
    "start": number;
};
export type Idevgv5mu1k9gt = Array<{
    "remaining": number;
    "amount_per_round": bigint;
    "period": number;
}>;
export type Ic5ardbudan54b = AnonymousEnum<{
    "Applied": {
        "cred": Anonymize<Ibt4ac5matmkrm>;
        "entropy": SizedHex<32>;
        "entropy_since": number;
    };
    "Selected": {
        "since": number;
        "cred": Anonymize<Ibt4ac5matmkrm>;
        "reserved": bigint;
        "entropy": SizedHex<32>;
        "design": Anonymize<I8p7pbmodi01pv>;
        "allocation": Enum<{
            "Initial": undefined;
            "InitDone": undefined;
            "Full": undefined;
        }>;
        "judging"?: Anonymize<I4arjljr6dpflb>;
        "failed": number;
    };
    "Proven": {
        "design": Anonymize<I8p7pbmodi01pv>;
        "reserved": bigint;
        "was_referred": boolean;
        "was_invited": boolean;
    };
}>;
export type Ibt4ac5matmkrm = AnonymousEnum<{
    "Referred": bigint;
    "Deposit": bigint;
    "Invited": SS58String;
}>;
export type I6n9krukma1mut = {
    "design"?: (Anonymize<I8p7pbmodi01pv>) | undefined;
    "active_referrals": Anonymize<Ia2lhg7l2hilo3>;
    "allowed_referral_tickets": number;
    "bad_referrals": number;
    "successful_referrals": number;
    "referrals": number;
    "derivatives": number;
    "banned": boolean;
    "pending_referral_rewards": number;
};
export type Ie6cl0ap8d265e = {
    "kind": Anonymize<Iflispc7h2jput>;
    "id": SizedHex<32>;
};
export type I9feps983hs1sf = AnonymousEnum<{
    "Reserved": undefined;
    "Committed": undefined;
}>;
export type I2na29tt2afp0j = FixedSizeArray<2, SS58String>;
export type Ifip05kcrl65am = Array<Anonymize<I6cs1itejju2vv>>;
export type I9u9nqhm3kqr8q = [Anonymize<Iavh3dqjok18o8>, SizedHex<32>];
export type I191vhdj2skphj = AnonymousEnum<{
    "Kickable": {
        "first_game": number;
        "archived_since": number;
    };
    "Unkickable": {
        "first_game": number;
    };
}>;
export type Idm8j2k0kcll3q = {
    "first_game": number;
    "registered": boolean;
    "sent_report": boolean;
    "early_attendance_enactment"?: ({
        "attendance": boolean;
        "disposition": Enum<{
            "Keep": undefined;
            "ArchiveKickable": undefined;
            "ArchiveUnkickable": undefined;
        }>;
    }) | undefined;
    "yes_person": number;
    "no_not_person": number;
    "expected_max_vote_weight": number;
    "vote_weight": number;
    "credibility": Enum<{
        "Invited": undefined;
        "Recognized": undefined;
        "Deposit": bigint;
    }>;
};
export type I5uteah8rq8etm = {
    "index": number;
    "registration_ends": number;
    "shuffle_deadline": number;
    "game_date": number;
    "report_ends": number;
    "state": Enum<{
        "Registration": {
            "next_player_index": number;
        };
        "Shuffle": {
            "step": Enum<{
                "Step1Insert": Anonymize<Ian857vvm41akm>;
                "Step2Retrieve": {
                    "next_player_index": number;
                    "recognized_finished": boolean;
                };
                "Step3ComputeWeights": Anonymize<Ia5kr65gtmjmug>;
                "Step4AwaitSession": Anonymize<I641idg32qb13l>;
            }>;
        };
        "Reporting": Anonymize<I641idg32qb13l>;
        "PlayerProcess": {
            "step": Enum<{
                "Step1ProcessPlayers": Anonymize<Ia5kr65gtmjmug>;
                "Step2ClearIndices": undefined;
            }>;
        };
        "Cancelling": Anonymize<Ian857vvm41akm>;
    }>;
    "max_group_size": number;
    "rounds": number;
    "pending_attendance": number;
    "airdrop_scheduled": boolean;
};
export type Ian857vvm41akm = {
    "last_iteration"?: Anonymize<I6ut7269ghmf35>;
};
export type I6ut7269ghmf35 = (Anonymize<Iavh3dqjok18o8>) | undefined;
export type Ia5kr65gtmjmug = {
    "last_iteration"?: Anonymize<I6ut7269ghmf35>;
    "player_count": number;
};
export type I641idg32qb13l = {
    "player_count": number;
};
export type I9sbfhir4aitej = Array<{
    "game_play_time": number;
    "rounds": number;
    "max_group_size": number;
    "airdrop_prize"?: (Anonymize<Icgupsga2s8p0f>) | undefined;
}>;
export type Icgupsga2s8p0f = {
    "asset_id": Anonymize<If9iqq7i64mur8>;
    "asset_amount": bigint;
    "max_winners": number;
    "winner_cap": number;
};
export type I5rab7drti2f9h = {
    "score": number;
    "streak": Enum<{
        "Attended": number;
        "Absent": number;
    }>;
    "attendance_history": number;
    "credit": bigint;
    "cashed_out": boolean;
    "reached_personhood": boolean;
    "has_ever_reached_personhood": boolean;
    "recognition": Enum<{
        "ExternallyRecognized": undefined;
        "NotRecognized": undefined;
        "Suspended": bigint;
        "Recognized": bigint;
    }>;
    "last_attended_game"?: Anonymize<I4arjljr6dpflb>;
};
export type I26np7pq4hc9kt = Array<{
    "population_size_threshold": number;
    "score_threshold": number;
}>;
export type Idrbto15rld189 = Array<{
    "population_size_threshold": number;
    "window": number;
    "allowed_misses": number;
}>;
export type I6lggg4mrl1u2s = [number, Anonymize<Iavh3dqjok18o8>];
export type I3nqube2n1nohj = {
    "remaining_balance": bigint;
    "point_price": bigint;
    "remainder": bigint;
    "total_points": number;
};
export type Idodgrto60av5h = {
    "finish_at": number;
    "credit": bigint;
};
export type Id26d02t80vjh = Array<{
    "remaining": number;
    "amount_per_round": bigint;
    "duration": number;
}>;
export type I4009rejbekrdq = {
    "key": SizedHex<32>;
    "suspended": boolean;
};
export type I81vbsdqasdsr1 = {
    "ring_vrf_key": SizedHex<32>;
    "method": Enum<{
        "UniqueDevice": SS58String;
    }>;
};
export type I23bplm6qtgrpd = {
    "identifier_key": SizedHex<65>;
    "full_username"?: Anonymize<Iabpgqcjikia83>;
    "lite_username": Uint8Array;
    "credibility": Enum<{
        "Lite": undefined;
        "Person": {
            "alias": SizedHex<32>;
            "last_update": bigint;
            "demoted": boolean;
        };
    }>;
};
export type Ifopum5rctcidn = {
    "account_id": SS58String;
    "seq": number;
    "since": bigint;
};
export type I9jea06984vfti = [SizedHex<4>, SizedHex<32>];
export type I8vqqii9cbfqng = [SS58String, Anonymize<Ib55cg44k2chb5>];
export type Ib55cg44k2chb5 = [SizedHex<4>, number, SizedHex<32>];
export type Id77vvrgqmru2o = {
    "account_id": SS58String;
    "reference": {
        "period": number;
        "seq": number;
    };
};
export type Ic66kva37scc9l = Array<{
    "account": SS58String;
    "joined_at": bigint;
}>;
export type I1fa62uavcqia6 = Array<SizedHex<96>>;
export type I7hvvp2oeegqa0 = [Anonymize<Idvob66qflhcgd>, number];
export type Ie3d56aup8po4r = {
    "owner": Anonymize<I9lcj3313n9e9v>;
    "mode": Enum<{
        "AppendOnly": undefined;
        "Flexible": undefined;
    }>;
    "ring_size": Anonymize<Idvob66qflhcgd>;
    "self_inclusion_delay"?: Anonymize<I35p85j063s0il>;
};
export type I9lcj3313n9e9v = AnonymousEnum<{
    "External": Anonymize<If9iqq7i64mur8>;
    "Local": SS58String;
}>;
export type I3136o2hmi4al3 = {
    "root": SizedHex<768>;
    "revision": number;
    "intermediate": SizedHex<848>;
};
export type I4pact7n2e9a0i = [SizedHex<32>, number];
export type Iff5ulsdvgntip = {
    "root": SizedHex<768>;
    "archived_at": bigint;
};
export type Iara29l6qkt9is = [SizedHex<32>, number, SizedHex<4>];
export type I2t447bb26t9i6 = [SizedHex<32>, number, number];
export type I831tj5voub6u0 = {
    "total": number;
    "included": number;
    "immutable_since"?: Anonymize<I35p85j063s0il>;
};
export type I54g1hqjgru9ba = AnonymousEnum<{
    "Onboarding": {
        "queue_page": number;
        "queued_at": bigint;
    };
    "Included": {
        "ring_index": number;
        "ring_page": number;
        "ring_position": number;
    };
    "Suspended": undefined;
}>;
export type I2ccsdtloqt0h4 = FixedSizeArray<2, SizedHex<32>>;
export type I766emmc9ccni0 = AnonymousEnum<{
    "AppendOnly": undefined;
    "Mutating": number;
}>;
export type I2l7r05e3266s4 = {
    "reason": Enum<{
        "FailedDispatch": {
            "retries": number;
        };
    }>;
    "until": bigint;
};
export type I5eoome1iv99mc = [number, number, SizedHex<32>];
export type I6msd8eb5ee1ee = {
    "collections": Anonymize<I94prpltebu6vs>;
    "last_init_sequence": bigint;
    "pallet_index": number;
};
export type I94prpltebu6vs = Array<[SizedHex<32>, Anonymize<Idvob66qflhcgd>]>;
export type I5b6v7o79lps5k = {
    "write_page": number;
    "send_page": number;
    "last_update_block": number;
};
export type I4hus3s8lblmj7 = [number, SizedHex<32>, number];
export type Iff773s2hdisds = {
    "collections": Anonymize<I94prpltebu6vs>;
    "current_collection_index": number;
    "after_ring_index"?: Anonymize<I4arjljr6dpflb>;
    "sequence": bigint;
    "source_time": bigint;
    "pallet_index": number;
};
export type Ieenjgm8k62jr1 = {
    "sequence": bigint;
    "source_time": bigint;
    "sealed_at": number;
    "remaining_subscribers": number;
};
export type I92h4q810prvth = {
    "id": SizedHex<32>;
    "info": Anonymize<Iel17tf43q056o>;
    "status": Enum<{
        "Scheduled": undefined;
        "Registering": {
            "total_participants": number;
        };
        "DrawWinners": {
            "total_participants": number;
            "effective_winners": number;
            "winners_added": number;
            "from_winner_key": SizedHex<32>;
        };
        "Claiming": {
            "total_participants": number;
            "effective_winners": number;
            "claimed": number;
        };
        "ClearingRegistrations": {
            "total_participants": number;
            "effective_winners": number;
            "claimed": number;
            "cleaned_registrations": number;
        };
        "ClearingWinners": {
            "total_participants": number;
            "effective_winners": number;
            "claimed": number;
            "cleaned_winners": number;
        };
        "Finalizing": {
            "effective_winners": number;
            "claimed": number;
        };
    }>;
};
export type Iel17tf43q056o = {
    "prize": Anonymize<Icgupsga2s8p0f>;
    "registration_starts": bigint;
    "draw_time": bigint;
    "end_time": bigint;
};
export type Ieso6d402ilf6g = [SizedHex<8>, SizedHex<32>];
export type Id5m5ie1nmrke2 = [SizedHex<32>, SizedHex<32>];
export type I58ai4tjcgea3g = [SizedHex<32>, Anonymize<I6cunlo5qsnfm5>];
export type Ibto3ou3o2r7sv = {
    "subject": SizedHex<32>;
    "subject_alias": SizedHex<32>;
    "direction": Anonymize<Ia31ehvm9n25pi>;
    "last_used_at": bigint;
};
export type I94nsao83dbuk9 = AnonymousEnum<{
    "Inactive": undefined;
    "CreatingAsset": undefined;
    "XcmFundsTransfer": undefined;
    "VerifyingFunds": undefined;
    "FundingPots": undefined;
    "SettingPeopleLiteAttestationAllowances": undefined;
    "SchedulingMobRulePayouts": undefined;
    "SchedulingScorePayouts": undefined;
    "Done": undefined;
}>;
export type Iepbsvlk3qceij = AnonymousEnum<{
    "Active": {
        "index": number;
        "inner_cursor"?: Anonymize<Iabpgqcjikia83>;
        "started_at": number;
    };
    "Stuck": undefined;
}>;
export type In7a38730s6qs = {
    "base_block": Anonymize<I4q39t5hn830vp>;
    "max_block": Anonymize<I4q39t5hn830vp>;
    "per_class": {
        "normal": {
            "base_extrinsic": Anonymize<I4q39t5hn830vp>;
            "max_extrinsic"?: Anonymize<Iasb8k6ash5mjn>;
            "max_total"?: Anonymize<Iasb8k6ash5mjn>;
            "reserved"?: Anonymize<Iasb8k6ash5mjn>;
        };
        "operational": {
            "base_extrinsic": Anonymize<I4q39t5hn830vp>;
            "max_extrinsic"?: Anonymize<Iasb8k6ash5mjn>;
            "max_total"?: Anonymize<Iasb8k6ash5mjn>;
            "reserved"?: Anonymize<Iasb8k6ash5mjn>;
        };
        "mandatory": {
            "base_extrinsic": Anonymize<I4q39t5hn830vp>;
            "max_extrinsic"?: Anonymize<Iasb8k6ash5mjn>;
            "max_total"?: Anonymize<Iasb8k6ash5mjn>;
            "reserved"?: Anonymize<Iasb8k6ash5mjn>;
        };
    };
};
export type Ibtil0ss5munbk = {
    "max": {
        "normal": number;
        "operational": number;
        "mandatory": number;
    };
    "max_header_size"?: Anonymize<I4arjljr6dpflb>;
};
export type I9s0ave7t0vnrk = {
    "read": bigint;
    "write": bigint;
};
export type I4fo08joqmcqnm = {
    "spec_name": string;
    "impl_name": string;
    "authoring_version": number;
    "spec_version": number;
    "impl_version": number;
    "apis": Array<[SizedHex<8>, number]>;
    "transaction_version": number;
    "system_version": number;
};
export type I7qcffr6se5g9 = {
    "max_count": number;
    "max_size": number;
};
export type Iekve0i6djpd9f = AnonymousEnum<{
    /**
     * Make some on-chain remark.
     *
     * Can be executed by every `origin`.
     */
    "remark": Anonymize<I8ofcg5rbj0g2c>;
    /**
     * Set the number of pages in the WebAssembly environment's heap.
     */
    "set_heap_pages": Anonymize<I4adgbll7gku4i>;
    /**
     * Set the new runtime code.
     */
    "set_code": Anonymize<I6pjjpfvhvcfru>;
    /**
     * Set the new runtime code without doing any checks of the given `code`.
     *
     * Note that runtime upgrades will not run if this is called with a not-increasing spec
     * version!
     */
    "set_code_without_checks": Anonymize<I6pjjpfvhvcfru>;
    /**
     * Set some items of storage.
     */
    "set_storage": Anonymize<I9pj91mj79qekl>;
    /**
     * Kill some items from storage.
     */
    "kill_storage": Anonymize<I39uah9nss64h9>;
    /**
     * Kill all storage items with a key that starts with the given prefix.
     *
     * **NOTE:** We rely on the Root origin to provide us the number of subkeys under
     * the prefix we are removing to accurately calculate the weight of this function.
     */
    "kill_prefix": Anonymize<Ik64dknsq7k08>;
    /**
     * Make some on-chain remark and emit event.
     */
    "remark_with_event": Anonymize<I8ofcg5rbj0g2c>;
    /**
     * Authorize an upgrade to a given `code_hash` for the runtime. The runtime can be supplied
     * later.
     *
     * This call requires Root origin.
     */
    "authorize_upgrade": Anonymize<Ib51vk42m1po4n>;
    /**
     * Authorize an upgrade to a given `code_hash` for the runtime. The runtime can be supplied
     * later.
     *
     * WARNING: This authorizes an upgrade that will take place without any safety checks, for
     * example that the spec name remains the same and that the version number increases. Not
     * recommended for normal use. Use `authorize_upgrade` instead.
     *
     * This call requires Root origin.
     */
    "authorize_upgrade_without_checks": Anonymize<Ib51vk42m1po4n>;
    /**
     * Provide the preimage (runtime binary) `code` for an upgrade that has been authorized.
     *
     * If the authorization required a version check, this call will ensure the spec name
     * remains unchanged and that the spec version has increased.
     *
     * Depending on the runtime's `OnSetCode` configuration, this function may directly apply
     * the new `code` in the same block or attempt to schedule the upgrade.
     *
     * All origins are allowed.
     */
    "apply_authorized_upgrade": Anonymize<I6pjjpfvhvcfru>;
}>;
export type I8ofcg5rbj0g2c = {
    "remark": Uint8Array;
};
export type I4adgbll7gku4i = {
    "pages": bigint;
};
export type I6pjjpfvhvcfru = {
    "code": Uint8Array;
};
export type I9pj91mj79qekl = {
    "items": Array<FixedSizeArray<2, Uint8Array>>;
};
export type I39uah9nss64h9 = {
    "keys": Anonymize<Itom7fk49o0c9>;
};
export type Ik64dknsq7k08 = {
    "prefix": Uint8Array;
    "subkeys": number;
};
export type Ib51vk42m1po4n = {
    "code_hash": SizedHex<32>;
};
export type I3u72uvpuo4qrt = AnonymousEnum<{
    /**
     * Set the current validation data.
     *
     * This should be invoked exactly once per block. It will panic at the finalization
     * phase if the call was not invoked.
     *
     * The dispatch origin for this call must be `Inherent`
     *
     * As a side effect, this function upgrades the current validation function
     * if the appropriate time has come.
     */
    "set_validation_data": Anonymize<Ial23jn8hp0aen>;
    "sudo_send_upward_message": Anonymize<Ifpj261e8s63m3>;
}>;
export type Ial23jn8hp0aen = {
    "data": {
        "validation_data": Anonymize<Ifn6q3equiq9qi>;
        "relay_chain_state": Anonymize<Itom7fk49o0c9>;
        "relay_parent_descendants": Array<Anonymize<Ic952bubvq4k7d>>;
        "collator_peer_id"?: Anonymize<Iabpgqcjikia83>;
    };
    "inbound_messages_data": {
        "downward_messages": {
            "full_messages": Array<{
                "sent_at": number;
                "msg": Uint8Array;
            }>;
            "hashed_messages": Array<Anonymize<Icqnh9ino03itn>>;
        };
        "horizontal_messages": {
            "full_messages": Array<[number, {
                "sent_at": number;
                "data": Uint8Array;
            }]>;
            "hashed_messages": Array<[number, Anonymize<Icqnh9ino03itn>]>;
        };
    };
};
export type Ic952bubvq4k7d = {
    "parent_hash": SizedHex<32>;
    "number": number;
    "state_root": SizedHex<32>;
    "extrinsics_root": SizedHex<32>;
    "digest": Anonymize<I4mddgoa69c0a2>;
};
export type Icqnh9ino03itn = {
    "sent_at": number;
    "msg_hash": SizedHex<32>;
};
export type Ifpj261e8s63m3 = {
    "message": Uint8Array;
};
export type I7d75gqfg6jh9c = AnonymousEnum<{
    /**
     * Set the current time.
     *
     * This call should be invoked exactly once per block. It will panic at the finalization
     * phase, if this call hasn't been invoked by that time.
     *
     * The timestamp should be greater than the previous one by the amount specified by
     * [`Config::MinimumPeriod`].
     *
     * The dispatch origin for this call must be _None_.
     *
     * This dispatch class is _Mandatory_ to ensure it gets executed in the block. Be aware
     * that changing the complexity of this call could result exhausting the resources in a
     * block to execute any other calls.
     *
     * ## Complexity
     * - `O(1)` (Note that implementations of `OnTimestampSet` must also be `O(1)`)
     * - 1 storage read and 1 storage mutation (codec `O(1)` because of `DidUpdate::take` in
     * `on_finalize`)
     * - 1 event handler `on_timestamp_set`. Must be `O(1)`.
     */
    "set": Anonymize<Idcr6u6361oad9>;
}>;
export type Idcr6u6361oad9 = {
    "now": bigint;
};
export type I9svldsp29mh87 = AnonymousEnum<{
    /**
     * Transfer some liquid free balance to another account.
     *
     * `transfer_allow_death` will set the `FreeBalance` of the sender and receiver.
     * If the sender's account is below the existential deposit as a result
     * of the transfer, the account will be reaped.
     *
     * The dispatch origin for this call must be `Signed` by the transactor.
     */
    "transfer_allow_death": Anonymize<I4ktuaksf5i1gk>;
    /**
     * Exactly as `transfer_allow_death`, except the origin must be root and the source account
     * may be specified.
     */
    "force_transfer": Anonymize<I9bqtpv2ii35mp>;
    /**
     * Same as the [`transfer_allow_death`] call, but with a check that the transfer will not
     * kill the origin account.
     *
     * 99% of the time you want [`transfer_allow_death`] instead.
     *
     * [`transfer_allow_death`]: struct.Pallet.html#method.transfer
     */
    "transfer_keep_alive": Anonymize<I4ktuaksf5i1gk>;
    /**
     * Transfer the entire transferable balance from the caller account.
     *
     * NOTE: This function only attempts to transfer _transferable_ balances. This means that
     * any locked, reserved, or existential deposits (when `keep_alive` is `true`), will not be
     * transferred by this function. To ensure that this function results in a killed account,
     * you might need to prepare the account by removing any reference counters, storage
     * deposits, etc...
     *
     * The dispatch origin of this call must be Signed.
     *
     * - `dest`: The recipient of the transfer.
     * - `keep_alive`: A boolean to determine if the `transfer_all` operation should send all
     * of the funds the account has, causing the sender account to be killed (false), or
     * transfer everything except at least the existential deposit, which will guarantee to
     * keep the sender account alive (true).
     */
    "transfer_all": Anonymize<I9j7pagd6d4bda>;
    /**
     * Unreserve some balance from a user by force.
     *
     * Can only be called by ROOT.
     */
    "force_unreserve": Anonymize<I2h9pmio37r7fb>;
    /**
     * Upgrade a specified account.
     *
     * - `origin`: Must be `Signed`.
     * - `who`: The account to be upgraded.
     *
     * This will waive the transaction fee if at least all but 10% of the accounts needed to
     * be upgraded. (We let some not have to be upgraded just in order to allow for the
     * possibility of churn).
     */
    "upgrade_accounts": Anonymize<Ibmr18suc9ikh9>;
    /**
     * Set the regular balance of a given account.
     *
     * The dispatch origin for this call is `root`.
     */
    "force_set_balance": Anonymize<I9iq22t0burs89>;
    /**
     * Adjust the total issuance in a saturating way.
     *
     * Can only be called by root and always needs a positive `delta`.
     *
     * # Example
     */
    "force_adjust_total_issuance": Anonymize<I5u8olqbbvfnvf>;
    /**
     * Burn the specified liquid free balance from the origin account.
     *
     * If the origin's account ends up below the existential deposit as a result
     * of the burn and `keep_alive` is false, the account will be reaped.
     *
     * Unlike sending funds to a _burn_ address, which merely makes the funds inaccessible,
     * this `burn` operation will reduce total issuance by the amount _burned_.
     */
    "burn": Anonymize<I5utcetro501ir>;
}>;
export type I4ktuaksf5i1gk = {
    "dest": MultiAddress;
    "value": bigint;
};
export type MultiAddress = Enum<{
    "Id": SS58String;
    "Index": undefined;
    "Raw": Uint8Array;
    "Address32": SizedHex<32>;
    "Address20": SizedHex<20>;
}>;
export declare const MultiAddress: GetEnum<MultiAddress>;
export type I9bqtpv2ii35mp = {
    "source": MultiAddress;
    "dest": MultiAddress;
    "value": bigint;
};
export type I9j7pagd6d4bda = {
    "dest": MultiAddress;
    "keep_alive": boolean;
};
export type I2h9pmio37r7fb = {
    "who": MultiAddress;
    "amount": bigint;
};
export type Ibmr18suc9ikh9 = {
    "who": Anonymize<Ia2lhg7l2hilo3>;
};
export type I9iq22t0burs89 = {
    "who": MultiAddress;
    "new_free": bigint;
};
export type I5u8olqbbvfnvf = {
    "direction": BalancesAdjustmentDirection;
    "delta": bigint;
};
export type BalancesAdjustmentDirection = Enum<{
    "Increase": undefined;
    "Decrease": undefined;
}>;
export declare const BalancesAdjustmentDirection: GetEnum<BalancesAdjustmentDirection>;
export type I5utcetro501ir = {
    "value": bigint;
    "keep_alive": boolean;
};
export type I46ohf9ad4t2nj = AnonymousEnum<{
    /**
     * Allow to clean usage associated with an entity when it is zero or when there is no
     * longer any allowance for the origin.
     */
    "clean_usage": Anonymize<Iea5hvin03frku>;
}>;
export type Iu9seb88fh81e = AnonymousEnum<{
    /**
     * Issue a new class of fungible assets from a public origin.
     *
     * This new asset class has no assets initially and its owner is the origin.
     *
     * The origin must conform to the configured `CreateOrigin` and have sufficient funds free.
     *
     * Funds of sender are reserved by `AssetDeposit`.
     *
     * Parameters:
     * - `id`: The identifier of the new asset. This must not be currently in use to identify
     * an existing asset. If [`NextAssetId`] is set, then this must be equal to it.
     * - `admin`: The admin of this class of assets. The admin is the initial address of each
     * member of the asset class's admin team.
     * - `min_balance`: The minimum balance of this new asset that any single account must
     * have. If an account's balance is reduced below this, then it collapses to zero.
     *
     * Emits `Created` event when successful.
     *
     * Weight: `O(1)`
     */
    "create": Anonymize<I7t2thek61ghou>;
    /**
     * Issue a new class of fungible assets from a privileged origin.
     *
     * This new asset class has no assets initially.
     *
     * The origin must conform to `ForceOrigin`.
     *
     * Unlike `create`, no funds are reserved.
     *
     * - `id`: The identifier of the new asset. This must not be currently in use to identify
     * an existing asset. If [`NextAssetId`] is set, then this must be equal to it.
     * - `owner`: The owner of this class of assets. The owner has full superuser permissions
     * over this asset, but may later change and configure the permissions using
     * `transfer_ownership` and `set_team`.
     * - `min_balance`: The minimum balance of this new asset that any single account must
     * have. If an account's balance is reduced below this, then it collapses to zero.
     *
     * Emits `ForceCreated` event when successful.
     *
     * Weight: `O(1)`
     */
    "force_create": Anonymize<I61tdrsafr1vf3>;
    /**
     * Start the process of destroying a fungible asset class.
     *
     * `start_destroy` is the first in a series of extrinsics that should be called, to allow
     * destruction of an asset class.
     *
     * The origin must conform to `ForceOrigin` or must be `Signed` by the asset's `owner`.
     *
     * - `id`: The identifier of the asset to be destroyed. This must identify an existing
     * asset.
     *
     * It will fail with either [`Error::ContainsHolds`] or [`Error::ContainsFreezes`] if
     * an account contains holds or freezes in place.
     */
    "start_destroy": Anonymize<Ibsk5g3rhm45pu>;
    /**
     * Destroy all accounts associated with a given asset.
     *
     * `destroy_accounts` should only be called after `start_destroy` has been called, and the
     * asset is in a `Destroying` state.
     *
     * Due to weight restrictions, this function may need to be called multiple times to fully
     * destroy all accounts. It will destroy `RemoveItemsLimit` accounts at a time.
     *
     * - `id`: The identifier of the asset to be destroyed. This must identify an existing
     * asset.
     *
     * Each call emits the `Event::DestroyedAccounts` event.
     */
    "destroy_accounts": Anonymize<Ibsk5g3rhm45pu>;
    /**
     * Destroy all approvals associated with a given asset up to the max (T::RemoveItemsLimit).
     *
     * `destroy_approvals` should only be called after `start_destroy` has been called, and the
     * asset is in a `Destroying` state.
     *
     * Due to weight restrictions, this function may need to be called multiple times to fully
     * destroy all approvals. It will destroy `RemoveItemsLimit` approvals at a time.
     *
     * - `id`: The identifier of the asset to be destroyed. This must identify an existing
     * asset.
     *
     * Each call emits the `Event::DestroyedApprovals` event.
     */
    "destroy_approvals": Anonymize<Ibsk5g3rhm45pu>;
    /**
     * Complete destroying asset and unreserve currency.
     *
     * `finish_destroy` should only be called after `start_destroy` has been called, and the
     * asset is in a `Destroying` state. All accounts or approvals should be destroyed before
     * hand.
     *
     * - `id`: The identifier of the asset to be destroyed. This must identify an existing
     * asset.
     *
     * Each successful call emits the `Event::Destroyed` event.
     */
    "finish_destroy": Anonymize<Ibsk5g3rhm45pu>;
    /**
     * Mint assets of a particular class.
     *
     * The origin must be Signed and the sender must be the Issuer of the asset `id`.
     *
     * - `id`: The identifier of the asset to have some amount minted.
     * - `beneficiary`: The account to be credited with the minted assets.
     * - `amount`: The amount of the asset to be minted.
     *
     * Emits `Issued` event when successful.
     *
     * Weight: `O(1)`
     * Modes: Pre-existing balance of `beneficiary`; Account pre-existence of `beneficiary`.
     */
    "mint": Anonymize<Icfoe9q8d4vs8f>;
    /**
     * Reduce the balance of `who` by as much as possible up to `amount` assets of `id`.
     *
     * Origin must be Signed and the sender should be the Manager of the asset `id`.
     *
     * Bails with `NoAccount` if the `who` is already dead.
     *
     * - `id`: The identifier of the asset to have some amount burned.
     * - `who`: The account to be debited from.
     * - `amount`: The maximum amount by which `who`'s balance should be reduced.
     *
     * Emits `Burned` with the actual amount burned. If this takes the balance to below the
     * minimum for the asset, then the amount burned is increased to take it to zero.
     *
     * Weight: `O(1)`
     * Modes: Post-existence of `who`; Pre & post Zombie-status of `who`.
     */
    "burn": Anonymize<Ibrfmvjrg4trnb>;
    /**
     * Move some assets from the sender account to another.
     *
     * Origin must be Signed.
     *
     * - `id`: The identifier of the asset to have some amount transferred.
     * - `target`: The account to be credited.
     * - `amount`: The amount by which the sender's balance of assets should be reduced and
     * `target`'s balance increased. The amount actually transferred may be slightly greater in
     * the case that the transfer would otherwise take the sender balance above zero but below
     * the minimum balance. Must be greater than zero.
     *
     * Emits `Transferred` with the actual amount transferred. If this takes the source balance
     * to below the minimum for the asset, then the amount transferred is increased to take it
     * to zero.
     *
     * Weight: `O(1)`
     * Modes: Pre-existence of `target`; Post-existence of sender; Account pre-existence of
     * `target`.
     */
    "transfer": Anonymize<Iedih7t34maii9>;
    /**
     * Move some assets from the sender account to another, keeping the sender account alive.
     *
     * Origin must be Signed.
     *
     * - `id`: The identifier of the asset to have some amount transferred.
     * - `target`: The account to be credited.
     * - `amount`: The amount by which the sender's balance of assets should be reduced and
     * `target`'s balance increased. The amount actually transferred may be slightly greater in
     * the case that the transfer would otherwise take the sender balance above zero but below
     * the minimum balance. Must be greater than zero.
     *
     * Emits `Transferred` with the actual amount transferred. If this takes the source balance
     * to below the minimum for the asset, then the amount transferred is increased to take it
     * to zero.
     *
     * Weight: `O(1)`
     * Modes: Pre-existence of `target`; Post-existence of sender; Account pre-existence of
     * `target`.
     */
    "transfer_keep_alive": Anonymize<Iedih7t34maii9>;
    /**
     * Move some assets from one account to another.
     *
     * Origin must be Signed and the sender should be the Admin of the asset `id`.
     *
     * - `id`: The identifier of the asset to have some amount transferred.
     * - `source`: The account to be debited.
     * - `dest`: The account to be credited.
     * - `amount`: The amount by which the `source`'s balance of assets should be reduced and
     * `dest`'s balance increased. The amount actually transferred may be slightly greater in
     * the case that the transfer would otherwise take the `source` balance above zero but
     * below the minimum balance. Must be greater than zero.
     *
     * Emits `Transferred` with the actual amount transferred. If this takes the source balance
     * to below the minimum for the asset, then the amount transferred is increased to take it
     * to zero.
     *
     * Weight: `O(1)`
     * Modes: Pre-existence of `dest`; Post-existence of `source`; Account pre-existence of
     * `dest`.
     */
    "force_transfer": Anonymize<I4e902qbfel1f1>;
    /**
     * Disallow further unprivileged transfers of an asset `id` from an account `who`. `who`
     * must already exist as an entry in `Account`s of the asset. If you want to freeze an
     * account that does not have an entry, use `touch_other` first.
     *
     * Origin must be Signed and the sender should be the Freezer of the asset `id`.
     *
     * - `id`: The identifier of the asset to be frozen.
     * - `who`: The account to be frozen.
     *
     * Emits `Frozen`.
     *
     * Weight: `O(1)`
     */
    "freeze": Anonymize<Ie4met0joi8sv0>;
    /**
     * Allow unprivileged transfers to and from an account again.
     *
     * Origin must be Signed and the sender should be the Admin of the asset `id`.
     *
     * - `id`: The identifier of the asset to be frozen.
     * - `who`: The account to be unfrozen.
     *
     * Emits `Thawed`.
     *
     * Weight: `O(1)`
     */
    "thaw": Anonymize<Ie4met0joi8sv0>;
    /**
     * Disallow further unprivileged transfers for the asset class.
     *
     * Origin must be Signed and the sender should be the Freezer of the asset `id`.
     *
     * - `id`: The identifier of the asset to be frozen.
     *
     * Emits `Frozen`.
     *
     * Weight: `O(1)`
     */
    "freeze_asset": Anonymize<Ibsk5g3rhm45pu>;
    /**
     * Allow unprivileged transfers for the asset again.
     *
     * Origin must be Signed and the sender should be the Admin of the asset `id`.
     *
     * - `id`: The identifier of the asset to be thawed.
     *
     * Emits `Thawed`.
     *
     * Weight: `O(1)`
     */
    "thaw_asset": Anonymize<Ibsk5g3rhm45pu>;
    /**
     * Change the Owner of an asset.
     *
     * Origin must be Signed and the sender should be the Owner of the asset `id`.
     *
     * - `id`: The identifier of the asset.
     * - `owner`: The new Owner of this asset.
     *
     * Emits `OwnerChanged`.
     *
     * Weight: `O(1)`
     */
    "transfer_ownership": Anonymize<I1t8vq6a06ohhu>;
    /**
     * Change the Issuer, Admin and Freezer of an asset.
     *
     * Origin must be Signed and the sender should be the Owner of the asset `id`.
     *
     * - `id`: The identifier of the asset to be frozen.
     * - `issuer`: The new Issuer of this asset.
     * - `admin`: The new Admin of this asset.
     * - `freezer`: The new Freezer of this asset.
     *
     * Emits `TeamChanged`.
     *
     * Weight: `O(1)`
     */
    "set_team": Anonymize<Icvt3pdunbinm7>;
    /**
     * Set the metadata for an asset.
     *
     * Origin must be Signed and the sender should be the Owner of the asset `id`.
     *
     * Funds of sender are reserved according to the formula:
     * `MetadataDepositBase + MetadataDepositPerByte * (name.len + symbol.len)` taking into
     * account any already reserved funds.
     *
     * - `id`: The identifier of the asset to update.
     * - `name`: The user friendly name of this asset. Limited in length by `StringLimit`.
     * - `symbol`: The exchange symbol for this asset. Limited in length by `StringLimit`.
     * - `decimals`: The number of decimals this asset uses to represent one unit.
     *
     * Emits `MetadataSet`.
     *
     * Weight: `O(1)`
     */
    "set_metadata": Anonymize<I9ui3n41balr2q>;
    /**
     * Clear the metadata for an asset.
     *
     * Origin must be Signed and the sender should be the Owner of the asset `id`.
     *
     * Any deposit is freed for the asset owner.
     *
     * - `id`: The identifier of the asset to clear.
     *
     * Emits `MetadataCleared`.
     *
     * Weight: `O(1)`
     */
    "clear_metadata": Anonymize<Ibsk5g3rhm45pu>;
    /**
     * Force the metadata for an asset to some value.
     *
     * Origin must be ForceOrigin.
     *
     * Any deposit is left alone.
     *
     * - `id`: The identifier of the asset to update.
     * - `name`: The user friendly name of this asset. Limited in length by `StringLimit`.
     * - `symbol`: The exchange symbol for this asset. Limited in length by `StringLimit`.
     * - `decimals`: The number of decimals this asset uses to represent one unit.
     *
     * Emits `MetadataSet`.
     *
     * Weight: `O(N + S)` where N and S are the length of the name and symbol respectively.
     */
    "force_set_metadata": Anonymize<I89sl7btgl24g2>;
    /**
     * Clear the metadata for an asset.
     *
     * Origin must be ForceOrigin.
     *
     * Any deposit is returned.
     *
     * - `id`: The identifier of the asset to clear.
     *
     * Emits `MetadataCleared`.
     *
     * Weight: `O(1)`
     */
    "force_clear_metadata": Anonymize<Ibsk5g3rhm45pu>;
    /**
     * Alter the attributes of a given asset.
     *
     * Origin must be `ForceOrigin`.
     *
     * - `id`: The identifier of the asset.
     * - `owner`: The new Owner of this asset.
     * - `issuer`: The new Issuer of this asset.
     * - `admin`: The new Admin of this asset.
     * - `freezer`: The new Freezer of this asset.
     * - `min_balance`: The minimum balance of this new asset that any single account must
     * have. If an account's balance is reduced below this, then it collapses to zero.
     * - `is_sufficient`: Whether a non-zero balance of this asset is deposit of sufficient
     * value to account for the state bloat associated with its balance storage. If set to
     * `true`, then non-zero balances may be stored without a `consumer` reference (and thus
     * an ED in the Balances pallet or whatever else is used to control user-account state
     * growth).
     * - `is_frozen`: Whether this asset class is frozen except for permissioned/admin
     * instructions.
     *
     * Emits `AssetStatusChanged` with the identity of the asset.
     *
     * Weight: `O(1)`
     */
    "force_asset_status": Anonymize<I3u6g26k9kn96u>;
    /**
     * Approve an amount of asset for transfer by a delegated third-party account.
     *
     * Origin must be Signed.
     *
     * Ensures that `ApprovalDeposit` worth of `Currency` is reserved from signing account
     * for the purpose of holding the approval. If some non-zero amount of assets is already
     * approved from signing account to `delegate`, then it is topped up or unreserved to
     * meet the right value.
     *
     * NOTE: The signing account does not need to own `amount` of assets at the point of
     * making this call.
     *
     * - `id`: The identifier of the asset.
     * - `delegate`: The account to delegate permission to transfer asset.
     * - `amount`: The amount of asset that may be transferred by `delegate`. If there is
     * already an approval in place, then this acts additively.
     *
     * Emits `ApprovedTransfer` on success.
     *
     * Weight: `O(1)`
     */
    "approve_transfer": Anonymize<If1invp94rsjms>;
    /**
     * Cancel all of some asset approved for delegated transfer by a third-party account.
     *
     * Origin must be Signed and there must be an approval in place between signer and
     * `delegate`.
     *
     * Unreserves any deposit previously reserved by `approve_transfer` for the approval.
     *
     * - `id`: The identifier of the asset.
     * - `delegate`: The account delegated permission to transfer asset.
     *
     * Emits `ApprovalCancelled` on success.
     *
     * Weight: `O(1)`
     */
    "cancel_approval": Anonymize<Ie5nc19gtiv5sv>;
    /**
     * Cancel all of some asset approved for delegated transfer by a third-party account.
     *
     * Origin must be either ForceOrigin or Signed origin with the signer being the Admin
     * account of the asset `id`.
     *
     * Unreserves any deposit previously reserved by `approve_transfer` for the approval.
     *
     * - `id`: The identifier of the asset.
     * - `delegate`: The account delegated permission to transfer asset.
     *
     * Emits `ApprovalCancelled` on success.
     *
     * Weight: `O(1)`
     */
    "force_cancel_approval": Anonymize<Iald3dgvt1hjkb>;
    /**
     * Transfer some asset balance from a previously delegated account to some third-party
     * account.
     *
     * Origin must be Signed and there must be an approval in place by the `owner` to the
     * signer.
     *
     * If the entire amount approved for transfer is transferred, then any deposit previously
     * reserved by `approve_transfer` is unreserved.
     *
     * - `id`: The identifier of the asset.
     * - `owner`: The account which previously approved for a transfer of at least `amount` and
     * from which the asset balance will be withdrawn.
     * - `destination`: The account to which the asset balance of `amount` will be transferred.
     * - `amount`: The amount of assets to transfer.
     *
     * Emits `TransferredApproved` on success.
     *
     * Weight: `O(1)`
     */
    "transfer_approved": Anonymize<Iurrhahet4gno>;
    /**
     * Create an asset account for non-provider assets.
     *
     * A deposit will be taken from the signer account.
     *
     * - `origin`: Must be Signed; the signer account must have sufficient funds for a deposit
     * to be taken.
     * - `id`: The identifier of the asset for the account to be created.
     *
     * Emits `Touched` event when successful.
     */
    "touch": Anonymize<Ibsk5g3rhm45pu>;
    /**
     * Return the deposit (if any) of an asset account or a consumer reference (if any) of an
     * account.
     *
     * The origin must be Signed.
     *
     * - `id`: The identifier of the asset for which the caller would like the deposit
     * refunded.
     * - `allow_burn`: If `true` then assets may be destroyed in order to complete the refund.
     *
     * It will fail with either [`Error::ContainsHolds`] or [`Error::ContainsFreezes`] if
     * the asset account contains holds or freezes in place.
     *
     * Emits `Refunded` event when successful.
     */
    "refund": Anonymize<I5tamv2nk8bj8o>;
    /**
     * Sets the minimum balance of an asset.
     *
     * Only works if there aren't any accounts that are holding the asset or if
     * the new value of `min_balance` is less than the old one.
     *
     * Origin must be Signed and the sender has to be the Owner of the
     * asset `id`.
     *
     * - `id`: The identifier of the asset.
     * - `min_balance`: The new value of `min_balance`.
     *
     * Emits `AssetMinBalanceChanged` event when successful.
     */
    "set_min_balance": Anonymize<I8apq8e7c7qcpp>;
    /**
     * Create an asset account for `who`.
     *
     * A deposit will be taken from the signer account.
     *
     * - `origin`: Must be Signed; the signer account must have sufficient funds for a deposit
     * to be taken.
     * - `id`: The identifier of the asset for the account to be created, the asset status must
     * be live.
     * - `who`: The account to be created.
     *
     * Emits `Touched` event when successful.
     */
    "touch_other": Anonymize<Ie4met0joi8sv0>;
    /**
     * Return the deposit (if any) of a target asset account. Useful if you are the depositor.
     *
     * The origin must be Signed and either the account owner, depositor, or asset `Admin`. In
     * order to burn a non-zero balance of the asset, the caller must be the account and should
     * use `refund`.
     *
     * - `id`: The identifier of the asset for the account holding a deposit.
     * - `who`: The account to refund.
     *
     * It will fail with either [`Error::ContainsHolds`] or [`Error::ContainsFreezes`] if
     * the asset account contains holds or freezes in place.
     *
     * Emits `Refunded` event when successful.
     */
    "refund_other": Anonymize<Ie4met0joi8sv0>;
    /**
     * Disallow further unprivileged transfers of an asset `id` to and from an account `who`.
     *
     * Origin must be Signed and the sender should be the Freezer of the asset `id`.
     *
     * - `id`: The identifier of the account's asset.
     * - `who`: The account to be unblocked.
     *
     * Emits `Blocked`.
     *
     * Weight: `O(1)`
     */
    "block": Anonymize<Ie4met0joi8sv0>;
    /**
     * Transfer the entire transferable balance from the caller asset account.
     *
     * NOTE: This function only attempts to transfer _transferable_ balances. This means that
     * any held, frozen, or minimum balance (when `keep_alive` is `true`), will not be
     * transferred by this function. To ensure that this function results in a killed account,
     * you might need to prepare the account by removing any reference counters, storage
     * deposits, etc...
     *
     * The dispatch origin of this call must be Signed.
     *
     * - `id`: The identifier of the asset for the account holding a deposit.
     * - `dest`: The recipient of the transfer.
     * - `keep_alive`: A boolean to determine if the `transfer_all` operation should send all
     * of the funds the asset account has, causing the sender asset account to be killed
     * (false), or transfer everything except at least the minimum balance, which will
     * guarantee to keep the sender asset account alive (true).
     */
    "transfer_all": Anonymize<Id1e31ij0c35fv>;
    /**
     * Sets the trusted reserve information of an asset.
     *
     * Origin must be the Owner of the asset `id`. The origin must conform to the configured
     * `CreateOrigin` or be the signed `owner` configured during asset creation.
     *
     * - `id`: The identifier of the asset.
     * - `reserves`: The full list of trusted reserves information.
     *
     * Emits `AssetMinBalanceChanged` event when successful.
     */
    "set_reserves": Anonymize<Ic6vatc0h2tbq8>;
}>;
export type I7t2thek61ghou = {
    "id": Anonymize<If9iqq7i64mur8>;
    "admin": MultiAddress;
    "min_balance": bigint;
};
export type I61tdrsafr1vf3 = {
    "id": Anonymize<If9iqq7i64mur8>;
    "owner": MultiAddress;
    "is_sufficient": boolean;
    "min_balance": bigint;
};
export type Ibsk5g3rhm45pu = {
    "id": Anonymize<If9iqq7i64mur8>;
};
export type Icfoe9q8d4vs8f = {
    "id": Anonymize<If9iqq7i64mur8>;
    "beneficiary": MultiAddress;
    "amount": bigint;
};
export type Ibrfmvjrg4trnb = {
    "id": Anonymize<If9iqq7i64mur8>;
    "who": MultiAddress;
    "amount": bigint;
};
export type Iedih7t34maii9 = {
    "id": Anonymize<If9iqq7i64mur8>;
    "target": MultiAddress;
    "amount": bigint;
};
export type I4e902qbfel1f1 = {
    "id": Anonymize<If9iqq7i64mur8>;
    "source": MultiAddress;
    "dest": MultiAddress;
    "amount": bigint;
};
export type Ie4met0joi8sv0 = {
    "id": Anonymize<If9iqq7i64mur8>;
    "who": MultiAddress;
};
export type I1t8vq6a06ohhu = {
    "id": Anonymize<If9iqq7i64mur8>;
    "owner": MultiAddress;
};
export type Icvt3pdunbinm7 = {
    "id": Anonymize<If9iqq7i64mur8>;
    "issuer": MultiAddress;
    "admin": MultiAddress;
    "freezer": MultiAddress;
};
export type I9ui3n41balr2q = {
    "id": Anonymize<If9iqq7i64mur8>;
    "name": Uint8Array;
    "symbol": Uint8Array;
    "decimals": number;
};
export type I89sl7btgl24g2 = {
    "id": Anonymize<If9iqq7i64mur8>;
    "name": Uint8Array;
    "symbol": Uint8Array;
    "decimals": number;
    "is_frozen": boolean;
};
export type I3u6g26k9kn96u = {
    "id": Anonymize<If9iqq7i64mur8>;
    "owner": MultiAddress;
    "issuer": MultiAddress;
    "admin": MultiAddress;
    "freezer": MultiAddress;
    "min_balance": bigint;
    "is_sufficient": boolean;
    "is_frozen": boolean;
};
export type If1invp94rsjms = {
    "id": Anonymize<If9iqq7i64mur8>;
    "delegate": MultiAddress;
    "amount": bigint;
};
export type Ie5nc19gtiv5sv = {
    "id": Anonymize<If9iqq7i64mur8>;
    "delegate": MultiAddress;
};
export type Iald3dgvt1hjkb = {
    "id": Anonymize<If9iqq7i64mur8>;
    "owner": MultiAddress;
    "delegate": MultiAddress;
};
export type Iurrhahet4gno = {
    "id": Anonymize<If9iqq7i64mur8>;
    "owner": MultiAddress;
    "destination": MultiAddress;
    "amount": bigint;
};
export type I5tamv2nk8bj8o = {
    "id": Anonymize<If9iqq7i64mur8>;
    "allow_burn": boolean;
};
export type I8apq8e7c7qcpp = {
    "id": Anonymize<If9iqq7i64mur8>;
    "min_balance": bigint;
};
export type Id1e31ij0c35fv = {
    "id": Anonymize<If9iqq7i64mur8>;
    "dest": MultiAddress;
    "keep_alive": boolean;
};
export type Ic6vatc0h2tbq8 = {
    "id": Anonymize<If9iqq7i64mur8>;
    "reserves": Anonymize<If2801grpltbp8>;
};
export type I5lh6k2tq92l6m = AnonymousEnum<{
    /**
     * Initialize a conversion rate to native balance for the given asset.
     *
     * ## Complexity
     * - O(1)
     */
    "create": Anonymize<I72jcvr86rnvv8>;
    /**
     * Update the conversion rate to native balance for the given asset.
     *
     * ## Complexity
     * - O(1)
     */
    "update": Anonymize<I72jcvr86rnvv8>;
    /**
     * Remove an existing conversion rate to native balance for the given asset.
     *
     * ## Complexity
     * - O(1)
     */
    "remove": Anonymize<I90c919drss29e>;
}>;
export type I9dpq5287dur8b = AnonymousEnum<{
    /**
     * Set the list of invulnerable (fixed) collators. These collators must do some
     * preparation, namely to have registered session keys.
     *
     * The call will remove any accounts that have not registered keys from the set. That is,
     * it is non-atomic; the caller accepts all `AccountId`s passed in `new` _individually_ as
     * acceptable Invulnerables, and is not proposing a _set_ of new Invulnerables.
     *
     * This call does not maintain mutual exclusivity of `Invulnerables` and `Candidates`. It
     * is recommended to use a batch of `add_invulnerable` and `remove_invulnerable` instead. A
     * `batch_all` can also be used to enforce atomicity. If any candidates are included in
     * `new`, they should be removed with `remove_invulnerable_candidate` after execution.
     *
     * Must be called by the `UpdateOrigin`.
     */
    "set_invulnerables": Anonymize<Ifccifqltb5obi>;
    /**
     * Set the ideal number of non-invulnerable collators. If lowering this number, then the
     * number of running collators could be higher than this figure. Aside from that edge case,
     * there should be no other way to have more candidates than the desired number.
     *
     * The origin for this call must be the `UpdateOrigin`.
     */
    "set_desired_candidates": Anonymize<Iadtsfv699cq8b>;
    /**
     * Set the candidacy bond amount.
     *
     * If the candidacy bond is increased by this call, all current candidates which have a
     * deposit lower than the new bond will be kicked from the list and get their deposits
     * back.
     *
     * The origin for this call must be the `UpdateOrigin`.
     */
    "set_candidacy_bond": Anonymize<Ialpmgmhr3gk5r>;
    /**
     * Register this account as a collator candidate. The account must (a) already have
     * registered session keys and (b) be able to reserve the `CandidacyBond`.
     *
     * This call is not available to `Invulnerable` collators.
     */
    "register_as_candidate": undefined;
    /**
     * Deregister `origin` as a collator candidate. Note that the collator can only leave on
     * session change. The `CandidacyBond` will be unreserved immediately.
     *
     * This call will fail if the total number of candidates would drop below
     * `MinEligibleCollators`.
     */
    "leave_intent": undefined;
    /**
     * Add a new account `who` to the list of `Invulnerables` collators. `who` must have
     * registered session keys. If `who` is a candidate, they will be removed.
     *
     * The origin for this call must be the `UpdateOrigin`.
     */
    "add_invulnerable": Anonymize<I4cbvqmqadhrea>;
    /**
     * Remove an account `who` from the list of `Invulnerables` collators. `Invulnerables` must
     * be sorted.
     *
     * The origin for this call must be the `UpdateOrigin`.
     */
    "remove_invulnerable": Anonymize<I4cbvqmqadhrea>;
    /**
     * Update the candidacy bond of collator candidate `origin` to a new amount `new_deposit`.
     *
     * Setting a `new_deposit` that is lower than the current deposit while `origin` is
     * occupying a top-`DesiredCandidates` slot is not allowed.
     *
     * This call will fail if `origin` is not a collator candidate, the updated bond is lower
     * than the minimum candidacy bond, and/or the amount cannot be reserved.
     */
    "update_bond": Anonymize<I3sdol54kg5jaq>;
    /**
     * The caller `origin` replaces a candidate `target` in the collator candidate list by
     * reserving `deposit`. The amount `deposit` reserved by the caller must be greater than
     * the existing bond of the target it is trying to replace.
     *
     * This call will fail if the caller is already a collator candidate or invulnerable, the
     * caller does not have registered session keys, the target is not a collator candidate,
     * and/or the `deposit` amount cannot be reserved.
     */
    "take_candidate_slot": Anonymize<I8fougodaj6di6>;
}>;
export type Ifccifqltb5obi = {
    "new": Anonymize<Ia2lhg7l2hilo3>;
};
export type Iadtsfv699cq8b = {
    "max": number;
};
export type Ialpmgmhr3gk5r = {
    "bond": bigint;
};
export type I3sdol54kg5jaq = {
    "new_deposit": bigint;
};
export type I8fougodaj6di6 = {
    "deposit": bigint;
    "target": SS58String;
};
export type I77dda7hps0u37 = AnonymousEnum<{
    /**
     * Sets the session key(s) of the function caller to `keys`.
     *
     * Allows an account to set its session key prior to becoming a validator.
     * This doesn't take effect until the next session.
     *
     * - `origin`: The dispatch origin of this function must be signed.
     * - `keys`: The new session keys to set. These are the public keys of all sessions keys
     * setup in the runtime.
     * - `proof`: The proof that `origin` has access to the private keys of `keys`. See
     * [`impl_opaque_keys`](sp_runtime::impl_opaque_keys) for more information about the
     * proof format.
     */
    "set_keys": Anonymize<I81vt5eq60l4b6>;
    /**
     * Removes any session key(s) of the function caller.
     *
     * This doesn't take effect until the next session.
     *
     * The dispatch origin of this function must be Signed and the account must be either be
     * convertible to a validator ID using the chain's typical addressing system (this usually
     * means being a controller account) or directly convertible into a validator ID (which
     * usually means being a stash account).
     */
    "purge_keys": undefined;
}>;
export type I81vt5eq60l4b6 = {
    "keys": SizedHex<32>;
    "proof": Uint8Array;
};
export type Ib7tahn20bvsep = AnonymousEnum<{
    /**
     * Suspends all XCM executions for the XCMP queue, regardless of the sender's origin.
     *
     * - `origin`: Must pass `ControllerOrigin`.
     */
    "suspend_xcm_execution": undefined;
    /**
     * Resumes all XCM executions for the XCMP queue.
     *
     * Note that this function doesn't change the status of the in/out bound channels.
     *
     * - `origin`: Must pass `ControllerOrigin`.
     */
    "resume_xcm_execution": undefined;
    /**
     * Overwrites the number of pages which must be in the queue for the other side to be
     * told to suspend their sending.
     *
     * - `origin`: Must pass `Root`.
     * - `new`: Desired value for `QueueConfigData.suspend_value`
     */
    "update_suspend_threshold": Anonymize<I3vh014cqgmrfd>;
    /**
     * Overwrites the number of pages which must be in the queue after which we drop any
     * further messages from the channel.
     *
     * - `origin`: Must pass `Root`.
     * - `new`: Desired value for `QueueConfigData.drop_threshold`
     */
    "update_drop_threshold": Anonymize<I3vh014cqgmrfd>;
    /**
     * Overwrites the number of pages which the queue must be reduced to before it signals
     * that message sending may recommence after it has been suspended.
     *
     * - `origin`: Must pass `Root`.
     * - `new`: Desired value for `QueueConfigData.resume_threshold`
     */
    "update_resume_threshold": Anonymize<I3vh014cqgmrfd>;
}>;
export type I3vh014cqgmrfd = {
    "new": number;
};
export type I6k1inef986368 = AnonymousEnum<{
    "send": Anonymize<Ia5cotcvi888ln>;
    /**
     * Teleport some assets from the local chain to some destination chain.
     *
     * **This function is deprecated: Use `limited_teleport_assets` instead.**
     *
     * Fee payment on the destination side is made from the asset in the `assets` vector of
     * index `fee_asset_item`. The weight limit for fees is not provided and thus is unlimited,
     * with all fees taken as needed from the asset.
     *
     * - `origin`: Must be capable of withdrawing the `assets` and executing XCM.
     * - `dest`: Destination context for the assets. Will typically be `[Parent,
     * Parachain(..)]` to send from parachain to parachain, or `[Parachain(..)]` to send from
     * relay to parachain.
     * - `beneficiary`: A beneficiary location for the assets in the context of `dest`. Will
     * generally be an `AccountId32` value.
     * - `assets`: The assets to be withdrawn. This should include the assets used to pay the
     * fee on the `dest` chain.
     * - `fee_asset_item`: The index into `assets` of the item which should be used to pay
     * fees.
     */
    "teleport_assets": Anonymize<I21jsa919m88fd>;
    /**
     * Transfer some assets from the local chain to the destination chain through their local,
     * destination or remote reserve.
     *
     * `assets` must have same reserve location and may not be teleportable to `dest`.
     * - `assets` have local reserve: transfer assets to sovereign account of destination
     * chain and forward a notification XCM to `dest` to mint and deposit reserve-based
     * assets to `beneficiary`.
     * - `assets` have destination reserve: burn local assets and forward a notification to
     * `dest` chain to withdraw the reserve assets from this chain's sovereign account and
     * deposit them to `beneficiary`.
     * - `assets` have remote reserve: burn local assets, forward XCM to reserve chain to move
     * reserves from this chain's SA to `dest` chain's SA, and forward another XCM to `dest`
     * to mint and deposit reserve-based assets to `beneficiary`.
     *
     * **This function is deprecated: Use `limited_reserve_transfer_assets` instead.**
     *
     * Fee payment on the destination side is made from the asset in the `assets` vector of
     * index `fee_asset_item`. The weight limit for fees is not provided and thus is unlimited,
     * with all fees taken as needed from the asset.
     *
     * - `origin`: Must be capable of withdrawing the `assets` and executing XCM.
     * - `dest`: Destination context for the assets. Will typically be `[Parent,
     * Parachain(..)]` to send from parachain to parachain, or `[Parachain(..)]` to send from
     * relay to parachain.
     * - `beneficiary`: A beneficiary location for the assets in the context of `dest`. Will
     * generally be an `AccountId32` value.
     * - `assets`: The assets to be withdrawn. This should include the assets used to pay the
     * fee on the `dest` (and possibly reserve) chains.
     * - `fee_asset_item`: The index into `assets` of the item which should be used to pay
     * fees.
     */
    "reserve_transfer_assets": Anonymize<I21jsa919m88fd>;
    /**
     * Execute an XCM message from a local, signed, origin.
     *
     * An event is deposited indicating whether `msg` could be executed completely or only
     * partially.
     *
     * No more than `max_weight` will be used in its attempted execution. If this is less than
     * the maximum amount of weight that the message could take to be executed, then no
     * execution attempt will be made.
     */
    "execute": Anonymize<Iegif7m3upfe1k>;
    /**
     * Extoll that a particular destination can be communicated with through a particular
     * version of XCM.
     *
     * - `origin`: Must be an origin specified by AdminOrigin.
     * - `location`: The destination that is being described.
     * - `xcm_version`: The latest version of XCM that `location` supports.
     */
    "force_xcm_version": Anonymize<I9kt8c221c83ln>;
    /**
     * Set a safe XCM version (the version that XCM should be encoded with if the most recent
     * version a destination can accept is unknown).
     *
     * - `origin`: Must be an origin specified by AdminOrigin.
     * - `maybe_xcm_version`: The default XCM encoding version, or `None` to disable.
     */
    "force_default_xcm_version": Anonymize<Ic76kfh5ebqkpl>;
    /**
     * Ask a location to notify us regarding their XCM version and any changes to it.
     *
     * - `origin`: Must be an origin specified by AdminOrigin.
     * - `location`: The location to which we should subscribe for XCM version notifications.
     */
    "force_subscribe_version_notify": Anonymize<Icscpmubum33bq>;
    /**
     * Require that a particular destination should no longer notify us regarding any XCM
     * version changes.
     *
     * - `origin`: Must be an origin specified by AdminOrigin.
     * - `location`: The location to which we are currently subscribed for XCM version
     * notifications which we no longer desire.
     */
    "force_unsubscribe_version_notify": Anonymize<Icscpmubum33bq>;
    /**
     * Transfer some assets from the local chain to the destination chain through their local,
     * destination or remote reserve.
     *
     * `assets` must have same reserve location and may not be teleportable to `dest`.
     * - `assets` have local reserve: transfer assets to sovereign account of destination
     * chain and forward a notification XCM to `dest` to mint and deposit reserve-based
     * assets to `beneficiary`.
     * - `assets` have destination reserve: burn local assets and forward a notification to
     * `dest` chain to withdraw the reserve assets from this chain's sovereign account and
     * deposit them to `beneficiary`.
     * - `assets` have remote reserve: burn local assets, forward XCM to reserve chain to move
     * reserves from this chain's SA to `dest` chain's SA, and forward another XCM to `dest`
     * to mint and deposit reserve-based assets to `beneficiary`.
     *
     * Fee payment on the destination side is made from the asset in the `assets` vector of
     * index `fee_asset_item`, up to enough to pay for `weight_limit` of weight. If more weight
     * is needed than `weight_limit`, then the operation will fail and the sent assets may be
     * at risk.
     *
     * - `origin`: Must be capable of withdrawing the `assets` and executing XCM.
     * - `dest`: Destination context for the assets. Will typically be `[Parent,
     * Parachain(..)]` to send from parachain to parachain, or `[Parachain(..)]` to send from
     * relay to parachain.
     * - `beneficiary`: A beneficiary location for the assets in the context of `dest`. Will
     * generally be an `AccountId32` value.
     * - `assets`: The assets to be withdrawn. This should include the assets used to pay the
     * fee on the `dest` (and possibly reserve) chains.
     * - `fee_asset_item`: The index into `assets` of the item which should be used to pay
     * fees.
     * - `weight_limit`: The remote-side weight limit, if any, for the XCM fee purchase.
     */
    "limited_reserve_transfer_assets": Anonymize<I21d2olof7eb60>;
    /**
     * Teleport some assets from the local chain to some destination chain.
     *
     * Fee payment on the destination side is made from the asset in the `assets` vector of
     * index `fee_asset_item`, up to enough to pay for `weight_limit` of weight. If more weight
     * is needed than `weight_limit`, then the operation will fail and the sent assets may be
     * at risk.
     *
     * - `origin`: Must be capable of withdrawing the `assets` and executing XCM.
     * - `dest`: Destination context for the assets. Will typically be `[Parent,
     * Parachain(..)]` to send from parachain to parachain, or `[Parachain(..)]` to send from
     * relay to parachain.
     * - `beneficiary`: A beneficiary location for the assets in the context of `dest`. Will
     * generally be an `AccountId32` value.
     * - `assets`: The assets to be withdrawn. This should include the assets used to pay the
     * fee on the `dest` chain.
     * - `fee_asset_item`: The index into `assets` of the item which should be used to pay
     * fees.
     * - `weight_limit`: The remote-side weight limit, if any, for the XCM fee purchase.
     */
    "limited_teleport_assets": Anonymize<I21d2olof7eb60>;
    /**
     * Set or unset the global suspension state of the XCM executor.
     *
     * - `origin`: Must be an origin specified by AdminOrigin.
     * - `suspended`: `true` to suspend, `false` to resume.
     */
    "force_suspension": Anonymize<Ibgm4rnf22lal1>;
    /**
     * Transfer some assets from the local chain to the destination chain through their local,
     * destination or remote reserve, or through teleports.
     *
     * Fee payment on the destination side is made from the asset in the `assets` vector of
     * index `fee_asset_item` (hence referred to as `fees`), up to enough to pay for
     * `weight_limit` of weight. If more weight is needed than `weight_limit`, then the
     * operation will fail and the sent assets may be at risk.
     *
     * `assets` (excluding `fees`) must have same reserve location or otherwise be teleportable
     * to `dest`, no limitations imposed on `fees`.
     * - for local reserve: transfer assets to sovereign account of destination chain and
     * forward a notification XCM to `dest` to mint and deposit reserve-based assets to
     * `beneficiary`.
     * - for destination reserve: burn local assets and forward a notification to `dest` chain
     * to withdraw the reserve assets from this chain's sovereign account and deposit them
     * to `beneficiary`.
     * - for remote reserve: burn local assets, forward XCM to reserve chain to move reserves
     * from this chain's SA to `dest` chain's SA, and forward another XCM to `dest` to mint
     * and deposit reserve-based assets to `beneficiary`.
     * - for teleports: burn local assets and forward XCM to `dest` chain to mint/teleport
     * assets and deposit them to `beneficiary`.
     *
     * - `origin`: Must be capable of withdrawing the `assets` and executing XCM.
     * - `dest`: Destination context for the assets. Will typically be `X2(Parent,
     * Parachain(..))` to send from parachain to parachain, or `X1(Parachain(..))` to send
     * from relay to parachain.
     * - `beneficiary`: A beneficiary location for the assets in the context of `dest`. Will
     * generally be an `AccountId32` value.
     * - `assets`: The assets to be withdrawn. This should include the assets used to pay the
     * fee on the `dest` (and possibly reserve) chains.
     * - `fee_asset_item`: The index into `assets` of the item which should be used to pay
     * fees.
     * - `weight_limit`: The remote-side weight limit, if any, for the XCM fee purchase.
     */
    "transfer_assets": Anonymize<I21d2olof7eb60>;
    /**
     * Claims assets trapped on this pallet because of leftover assets during XCM execution.
     *
     * - `origin`: Anyone can call this extrinsic.
     * - `assets`: The exact assets that were trapped. Use the version to specify what version
     * was the latest when they were trapped.
     * - `beneficiary`: The location/account where the claimed assets will be deposited.
     */
    "claim_assets": Anonymize<Ie68np0vpihith>;
    /**
     * Transfer assets from the local chain to the destination chain using explicit transfer
     * types for assets and fees.
     *
     * `assets` must have same reserve location or may be teleportable to `dest`. Caller must
     * provide the `assets_transfer_type` to be used for `assets`:
     * - `TransferType::LocalReserve`: transfer assets to sovereign account of destination
     * chain and forward a notification XCM to `dest` to mint and deposit reserve-based
     * assets to `beneficiary`.
     * - `TransferType::DestinationReserve`: burn local assets and forward a notification to
     * `dest` chain to withdraw the reserve assets from this chain's sovereign account and
     * deposit them to `beneficiary`.
     * - `TransferType::RemoteReserve(reserve)`: burn local assets, forward XCM to `reserve`
     * chain to move reserves from this chain's SA to `dest` chain's SA, and forward another
     * XCM to `dest` to mint and deposit reserve-based assets to `beneficiary`. Typically
     * the remote `reserve` is Asset Hub.
     * - `TransferType::Teleport`: burn local assets and forward XCM to `dest` chain to
     * mint/teleport assets and deposit them to `beneficiary`.
     *
     * On the destination chain, as well as any intermediary hops, `BuyExecution` is used to
     * buy execution using transferred `assets` identified by `remote_fees_id`.
     * Make sure enough of the specified `remote_fees_id` asset is included in the given list
     * of `assets`. `remote_fees_id` should be enough to pay for `weight_limit`. If more weight
     * is needed than `weight_limit`, then the operation will fail and the sent assets may be
     * at risk.
     *
     * `remote_fees_id` may use different transfer type than rest of `assets` and can be
     * specified through `fees_transfer_type`.
     *
     * The caller needs to specify what should happen to the transferred assets once they reach
     * the `dest` chain. This is done through the `custom_xcm_on_dest` parameter, which
     * contains the instructions to execute on `dest` as a final step.
     * This is usually as simple as:
     * `Xcm(vec![DepositAsset { assets: Wild(AllCounted(assets.len())), beneficiary }])`,
     * but could be something more exotic like sending the `assets` even further.
     *
     * - `origin`: Must be capable of withdrawing the `assets` and executing XCM.
     * - `dest`: Destination context for the assets. Will typically be `[Parent,
     * Parachain(..)]` to send from parachain to parachain, or `[Parachain(..)]` to send from
     * relay to parachain, or `(parents: 2, (GlobalConsensus(..), ..))` to send from
     * parachain across a bridge to another ecosystem destination.
     * - `assets`: The assets to be withdrawn. This should include the assets used to pay the
     * fee on the `dest` (and possibly reserve) chains.
     * - `assets_transfer_type`: The XCM `TransferType` used to transfer the `assets`.
     * - `remote_fees_id`: One of the included `assets` to be used to pay fees.
     * - `fees_transfer_type`: The XCM `TransferType` used to transfer the `fees` assets.
     * - `custom_xcm_on_dest`: The XCM to be executed on `dest` chain as the last step of the
     * transfer, which also determines what happens to the assets on the destination chain.
     * - `weight_limit`: The remote-side weight limit, if any, for the XCM fee purchase.
     */
    "transfer_assets_using_type_and_then": Anonymize<I9bnv6lu0crf1q>;
    /**
     * Authorize another `aliaser` location to alias into the local `origin` making this call.
     * The `aliaser` is only authorized until the provided `expiry` block number.
     * The call can also be used for a previously authorized alias in order to update its
     * `expiry` block number.
     *
     * Usually useful to allow your local account to be aliased into from a remote location
     * also under your control (like your account on another chain).
     *
     * WARNING: make sure the caller `origin` (you) trusts the `aliaser` location to act in
     * their/your name. Once authorized using this call, the `aliaser` can freely impersonate
     * `origin` in XCM programs executed on the local chain.
     */
    "add_authorized_alias": Anonymize<Iauhjqifrdklq7>;
    /**
     * Remove a previously authorized `aliaser` from the list of locations that can alias into
     * the local `origin` making this call.
     */
    "remove_authorized_alias": Anonymize<Ie1uso9m8rt5cf>;
    /**
     * Remove all previously authorized `aliaser`s that can alias into the local `origin`
     * making this call.
     */
    "remove_all_authorized_aliases": undefined;
}>;
export type Ia5cotcvi888ln = {
    "dest": XcmVersionedLocation;
    "message": XcmVersionedXcm;
};
export type XcmVersionedXcm = Enum<{
    "V3": Anonymize<Ianvng4e08j9ii>;
    "V4": Anonymize<Iegrepoo0c1jc5>;
    "V5": Anonymize<Ict03eedr8de9s>;
}>;
export declare const XcmVersionedXcm: GetEnum<XcmVersionedXcm>;
export type Ianvng4e08j9ii = Array<XcmV3Instruction>;
export type XcmV3Instruction = Enum<{
    "WithdrawAsset": Anonymize<Iai6dhqiq3bach>;
    "ReserveAssetDeposited": Anonymize<Iai6dhqiq3bach>;
    "ReceiveTeleportedAsset": Anonymize<Iai6dhqiq3bach>;
    "QueryResponse": {
        "query_id": bigint;
        "response": XcmV3Response;
        "max_weight": Anonymize<I4q39t5hn830vp>;
        "querier"?: Anonymize<Ia9cgf4r40b26h>;
    };
    "TransferAsset": {
        "assets": Anonymize<Iai6dhqiq3bach>;
        "beneficiary": Anonymize<I4c0s5cioidn76>;
    };
    "TransferReserveAsset": {
        "assets": Anonymize<Iai6dhqiq3bach>;
        "dest": Anonymize<I4c0s5cioidn76>;
        "xcm": Anonymize<Ianvng4e08j9ii>;
    };
    "Transact": Anonymize<I92p6l5cs3fr50>;
    "HrmpNewChannelOpenRequest": Anonymize<I5uhhrjqfuo4e5>;
    "HrmpChannelAccepted": Anonymize<Ifij4jam0o7sub>;
    "HrmpChannelClosing": Anonymize<Ieeb4svd9i8fji>;
    "ClearOrigin": undefined;
    "DescendOrigin": XcmV3Junctions;
    "ReportError": Anonymize<I4r3v6e91d1qbs>;
    "DepositAsset": {
        "assets": XcmV3MultiassetMultiAssetFilter;
        "beneficiary": Anonymize<I4c0s5cioidn76>;
    };
    "DepositReserveAsset": {
        "assets": XcmV3MultiassetMultiAssetFilter;
        "dest": Anonymize<I4c0s5cioidn76>;
        "xcm": Anonymize<Ianvng4e08j9ii>;
    };
    "ExchangeAsset": {
        "give": XcmV3MultiassetMultiAssetFilter;
        "want": Anonymize<Iai6dhqiq3bach>;
        "maximal": boolean;
    };
    "InitiateReserveWithdraw": {
        "assets": XcmV3MultiassetMultiAssetFilter;
        "reserve": Anonymize<I4c0s5cioidn76>;
        "xcm": Anonymize<Ianvng4e08j9ii>;
    };
    "InitiateTeleport": {
        "assets": XcmV3MultiassetMultiAssetFilter;
        "dest": Anonymize<I4c0s5cioidn76>;
        "xcm": Anonymize<Ianvng4e08j9ii>;
    };
    "ReportHolding": {
        "response_info": Anonymize<I4r3v6e91d1qbs>;
        "assets": XcmV3MultiassetMultiAssetFilter;
    };
    "BuyExecution": {
        "fees": Anonymize<Idcm24504c8bkk>;
        "weight_limit": XcmV3WeightLimit;
    };
    "RefundSurplus": undefined;
    "SetErrorHandler": Anonymize<Ianvng4e08j9ii>;
    "SetAppendix": Anonymize<Ianvng4e08j9ii>;
    "ClearError": undefined;
    "ClaimAsset": {
        "assets": Anonymize<Iai6dhqiq3bach>;
        "ticket": Anonymize<I4c0s5cioidn76>;
    };
    "Trap": bigint;
    "SubscribeVersion": Anonymize<Ieprdqqu7ildvr>;
    "UnsubscribeVersion": undefined;
    "BurnAsset": Anonymize<Iai6dhqiq3bach>;
    "ExpectAsset": Anonymize<Iai6dhqiq3bach>;
    "ExpectOrigin"?: Anonymize<Ia9cgf4r40b26h>;
    "ExpectError"?: Anonymize<I7sltvf8v2nure>;
    "ExpectTransactStatus": XcmV3MaybeErrorCode;
    "QueryPallet": Anonymize<Iba5bdbapp16oo>;
    "ExpectPallet": Anonymize<Id7mf37dkpgfjs>;
    "ReportTransactStatus": Anonymize<I4r3v6e91d1qbs>;
    "ClearTransactStatus": undefined;
    "UniversalOrigin": XcmV3Junction;
    "ExportMessage": {
        "network": XcmV3JunctionNetworkId;
        "destination": XcmV3Junctions;
        "xcm": Anonymize<Ianvng4e08j9ii>;
    };
    "LockAsset": {
        "asset": Anonymize<Idcm24504c8bkk>;
        "unlocker": Anonymize<I4c0s5cioidn76>;
    };
    "UnlockAsset": {
        "asset": Anonymize<Idcm24504c8bkk>;
        "target": Anonymize<I4c0s5cioidn76>;
    };
    "NoteUnlockable": {
        "asset": Anonymize<Idcm24504c8bkk>;
        "owner": Anonymize<I4c0s5cioidn76>;
    };
    "RequestUnlock": {
        "asset": Anonymize<Idcm24504c8bkk>;
        "locker": Anonymize<I4c0s5cioidn76>;
    };
    "SetFeesMode": Anonymize<I4nae9rsql8fa7>;
    "SetTopic": SizedHex<32>;
    "ClearTopic": undefined;
    "AliasOrigin": Anonymize<I4c0s5cioidn76>;
    "UnpaidExecution": Anonymize<I40d50jeai33oq>;
}>;
export declare const XcmV3Instruction: GetEnum<XcmV3Instruction>;
export type Ia9cgf4r40b26h = (Anonymize<I4c0s5cioidn76>) | undefined;
export type I92p6l5cs3fr50 = {
    "origin_kind": XcmV2OriginKind;
    "require_weight_at_most": Anonymize<I4q39t5hn830vp>;
    "call": Uint8Array;
};
export type I4r3v6e91d1qbs = {
    "destination": Anonymize<I4c0s5cioidn76>;
    "query_id": bigint;
    "max_weight": Anonymize<I4q39t5hn830vp>;
};
export type XcmV3MultiassetMultiAssetFilter = Enum<{
    "Definite": Anonymize<Iai6dhqiq3bach>;
    "Wild": XcmV3MultiassetWildMultiAsset;
}>;
export declare const XcmV3MultiassetMultiAssetFilter: GetEnum<XcmV3MultiassetMultiAssetFilter>;
export type XcmV3MultiassetWildMultiAsset = Enum<{
    "All": undefined;
    "AllOf": {
        "id": XcmV3MultiassetAssetId;
        "fun": XcmV2MultiassetWildFungibility;
    };
    "AllCounted": number;
    "AllOfCounted": {
        "id": XcmV3MultiassetAssetId;
        "fun": XcmV2MultiassetWildFungibility;
        "count": number;
    };
}>;
export declare const XcmV3MultiassetWildMultiAsset: GetEnum<XcmV3MultiassetWildMultiAsset>;
export type Iba5bdbapp16oo = {
    "module_name": Uint8Array;
    "response_info": Anonymize<I4r3v6e91d1qbs>;
};
export type I40d50jeai33oq = {
    "weight_limit": XcmV3WeightLimit;
    "check_origin"?: Anonymize<Ia9cgf4r40b26h>;
};
export type Iegrepoo0c1jc5 = Array<XcmV4Instruction>;
export type XcmV4Instruction = Enum<{
    "WithdrawAsset": Anonymize<I50mli3hb64f9b>;
    "ReserveAssetDeposited": Anonymize<I50mli3hb64f9b>;
    "ReceiveTeleportedAsset": Anonymize<I50mli3hb64f9b>;
    "QueryResponse": {
        "query_id": bigint;
        "response": XcmV4Response;
        "max_weight": Anonymize<I4q39t5hn830vp>;
        "querier"?: Anonymize<Ia9cgf4r40b26h>;
    };
    "TransferAsset": {
        "assets": Anonymize<I50mli3hb64f9b>;
        "beneficiary": Anonymize<I4c0s5cioidn76>;
    };
    "TransferReserveAsset": {
        "assets": Anonymize<I50mli3hb64f9b>;
        "dest": Anonymize<I4c0s5cioidn76>;
        "xcm": Anonymize<Iegrepoo0c1jc5>;
    };
    "Transact": Anonymize<I92p6l5cs3fr50>;
    "HrmpNewChannelOpenRequest": Anonymize<I5uhhrjqfuo4e5>;
    "HrmpChannelAccepted": Anonymize<Ifij4jam0o7sub>;
    "HrmpChannelClosing": Anonymize<Ieeb4svd9i8fji>;
    "ClearOrigin": undefined;
    "DescendOrigin": XcmV3Junctions;
    "ReportError": Anonymize<I4r3v6e91d1qbs>;
    "DepositAsset": {
        "assets": XcmV4AssetAssetFilter;
        "beneficiary": Anonymize<I4c0s5cioidn76>;
    };
    "DepositReserveAsset": {
        "assets": XcmV4AssetAssetFilter;
        "dest": Anonymize<I4c0s5cioidn76>;
        "xcm": Anonymize<Iegrepoo0c1jc5>;
    };
    "ExchangeAsset": {
        "give": XcmV4AssetAssetFilter;
        "want": Anonymize<I50mli3hb64f9b>;
        "maximal": boolean;
    };
    "InitiateReserveWithdraw": {
        "assets": XcmV4AssetAssetFilter;
        "reserve": Anonymize<I4c0s5cioidn76>;
        "xcm": Anonymize<Iegrepoo0c1jc5>;
    };
    "InitiateTeleport": {
        "assets": XcmV4AssetAssetFilter;
        "dest": Anonymize<I4c0s5cioidn76>;
        "xcm": Anonymize<Iegrepoo0c1jc5>;
    };
    "ReportHolding": {
        "response_info": Anonymize<I4r3v6e91d1qbs>;
        "assets": XcmV4AssetAssetFilter;
    };
    "BuyExecution": {
        "fees": Anonymize<Ia5l7mu5a6v49o>;
        "weight_limit": XcmV3WeightLimit;
    };
    "RefundSurplus": undefined;
    "SetErrorHandler": Anonymize<Iegrepoo0c1jc5>;
    "SetAppendix": Anonymize<Iegrepoo0c1jc5>;
    "ClearError": undefined;
    "ClaimAsset": {
        "assets": Anonymize<I50mli3hb64f9b>;
        "ticket": Anonymize<I4c0s5cioidn76>;
    };
    "Trap": bigint;
    "SubscribeVersion": Anonymize<Ieprdqqu7ildvr>;
    "UnsubscribeVersion": undefined;
    "BurnAsset": Anonymize<I50mli3hb64f9b>;
    "ExpectAsset": Anonymize<I50mli3hb64f9b>;
    "ExpectOrigin"?: Anonymize<Ia9cgf4r40b26h>;
    "ExpectError"?: Anonymize<I7sltvf8v2nure>;
    "ExpectTransactStatus": XcmV3MaybeErrorCode;
    "QueryPallet": Anonymize<Iba5bdbapp16oo>;
    "ExpectPallet": Anonymize<Id7mf37dkpgfjs>;
    "ReportTransactStatus": Anonymize<I4r3v6e91d1qbs>;
    "ClearTransactStatus": undefined;
    "UniversalOrigin": XcmV3Junction;
    "ExportMessage": {
        "network": XcmV3JunctionNetworkId;
        "destination": XcmV3Junctions;
        "xcm": Anonymize<Iegrepoo0c1jc5>;
    };
    "LockAsset": {
        "asset": Anonymize<Ia5l7mu5a6v49o>;
        "unlocker": Anonymize<I4c0s5cioidn76>;
    };
    "UnlockAsset": {
        "asset": Anonymize<Ia5l7mu5a6v49o>;
        "target": Anonymize<I4c0s5cioidn76>;
    };
    "NoteUnlockable": {
        "asset": Anonymize<Ia5l7mu5a6v49o>;
        "owner": Anonymize<I4c0s5cioidn76>;
    };
    "RequestUnlock": {
        "asset": Anonymize<Ia5l7mu5a6v49o>;
        "locker": Anonymize<I4c0s5cioidn76>;
    };
    "SetFeesMode": Anonymize<I4nae9rsql8fa7>;
    "SetTopic": SizedHex<32>;
    "ClearTopic": undefined;
    "AliasOrigin": Anonymize<I4c0s5cioidn76>;
    "UnpaidExecution": Anonymize<I40d50jeai33oq>;
}>;
export declare const XcmV4Instruction: GetEnum<XcmV4Instruction>;
export type XcmV4AssetAssetFilter = Enum<{
    "Definite": Anonymize<I50mli3hb64f9b>;
    "Wild": XcmV4AssetWildAsset;
}>;
export declare const XcmV4AssetAssetFilter: GetEnum<XcmV4AssetAssetFilter>;
export type XcmV4AssetWildAsset = Enum<{
    "All": undefined;
    "AllOf": {
        "id": Anonymize<I4c0s5cioidn76>;
        "fun": XcmV2MultiassetWildFungibility;
    };
    "AllCounted": number;
    "AllOfCounted": {
        "id": Anonymize<I4c0s5cioidn76>;
        "fun": XcmV2MultiassetWildFungibility;
        "count": number;
    };
}>;
export declare const XcmV4AssetWildAsset: GetEnum<XcmV4AssetWildAsset>;
export type I21jsa919m88fd = {
    "dest": XcmVersionedLocation;
    "beneficiary": XcmVersionedLocation;
    "assets": XcmVersionedAssets;
    "fee_asset_item": number;
};
export type Iegif7m3upfe1k = {
    "message": XcmVersionedXcm;
    "max_weight": Anonymize<I4q39t5hn830vp>;
};
export type Ic76kfh5ebqkpl = {
    "maybe_xcm_version"?: Anonymize<I4arjljr6dpflb>;
};
export type Icscpmubum33bq = {
    "location": XcmVersionedLocation;
};
export type I21d2olof7eb60 = {
    "dest": XcmVersionedLocation;
    "beneficiary": XcmVersionedLocation;
    "assets": XcmVersionedAssets;
    "fee_asset_item": number;
    "weight_limit": XcmV3WeightLimit;
};
export type Ibgm4rnf22lal1 = {
    "suspended": boolean;
};
export type Ie68np0vpihith = {
    "assets": XcmVersionedAssets;
    "beneficiary": XcmVersionedLocation;
};
export type I9bnv6lu0crf1q = {
    "dest": XcmVersionedLocation;
    "assets": XcmVersionedAssets;
    "assets_transfer_type": Enum<{
        "Teleport": undefined;
        "LocalReserve": undefined;
        "DestinationReserve": undefined;
        "RemoteReserve": XcmVersionedLocation;
    }>;
    "remote_fees_id": XcmVersionedAssetId;
    "fees_transfer_type": Enum<{
        "Teleport": undefined;
        "LocalReserve": undefined;
        "DestinationReserve": undefined;
        "RemoteReserve": XcmVersionedLocation;
    }>;
    "custom_xcm_on_dest": XcmVersionedXcm;
    "weight_limit": XcmV3WeightLimit;
};
export type Iauhjqifrdklq7 = {
    "aliaser": XcmVersionedLocation;
    "expires"?: Anonymize<I35p85j063s0il>;
};
export type Ie1uso9m8rt5cf = {
    "aliaser": XcmVersionedLocation;
};
export type Ic2uoe7jdksosp = AnonymousEnum<{
    /**
     * Remove a page which has no more messages remaining to be processed or is stale.
     */
    "reap_page": Anonymize<I40pqum1mu8qg3>;
    /**
     * Execute an overweight message.
     *
     * Temporary processing errors will be propagated whereas permanent errors are treated
     * as success condition.
     *
     * - `origin`: Must be `Signed`.
     * - `message_origin`: The origin from which the message to be executed arrived.
     * - `page`: The page in the queue in which the message to be executed is sitting.
     * - `index`: The index into the queue of the message to be executed.
     * - `weight_limit`: The maximum amount of weight allowed to be consumed in the execution
     * of the message.
     *
     * Benchmark complexity considerations: O(index + weight_limit).
     */
    "execute_overweight": Anonymize<I1r4c2ghbtvjuc>;
}>;
export type I40pqum1mu8qg3 = {
    "message_origin": Anonymize<Iejeo53sea6n4q>;
    "page_index": number;
};
export type I1r4c2ghbtvjuc = {
    "message_origin": Anonymize<Iejeo53sea6n4q>;
    "page": number;
    "index": number;
    "weight_limit": Anonymize<I4q39t5hn830vp>;
};
export type I18l7q9tni37e3 = AnonymousEnum<{
    /**
     * Send a batch of dispatch calls.
     *
     * May be called from any origin except `None`.
     *
     * - `calls`: The calls to be dispatched from the same origin. The number of call must not
     * exceed the constant: `batched_calls_limit` (available in constant metadata).
     *
     * If origin is root then the calls are dispatched without checking origin filter. (This
     * includes bypassing `frame_system::Config::BaseCallFilter`).
     *
     * ## Complexity
     * - O(C) where C is the number of calls to be batched.
     *
     * This will return `Ok` in all circumstances. To determine the success of the batch, an
     * event is deposited. If a call failed and the batch was interrupted, then the
     * `BatchInterrupted` event is deposited, along with the number of successful calls made
     * and the error of the failed call. If all were successful, then the `BatchCompleted`
     * event is deposited.
     */
    "batch": Anonymize<I31fb7db4bv6ln>;
    /**
     * Send a call through an indexed pseudonym of the sender.
     *
     * Filter from origin are passed along. The call will be dispatched with an origin which
     * use the same filter as the origin of this call.
     *
     * NOTE: If you need to ensure that any account-based filtering is not honored (i.e.
     * because you expect `proxy` to have been used prior in the call stack and you do not want
     * the call restrictions to apply to any sub-accounts), then use `as_multi_threshold_1`
     * in the Multisig pallet instead.
     *
     * NOTE: Prior to version *12, this was called `as_limited_sub`.
     *
     * The dispatch origin for this call must be _Signed_.
     */
    "as_derivative": Anonymize<I6prj085oihphp>;
    /**
     * Send a batch of dispatch calls and atomically execute them.
     * The whole transaction will rollback and fail if any of the calls failed.
     *
     * May be called from any origin except `None`.
     *
     * - `calls`: The calls to be dispatched from the same origin. The number of call must not
     * exceed the constant: `batched_calls_limit` (available in constant metadata).
     *
     * If origin is root then the calls are dispatched without checking origin filter. (This
     * includes bypassing `frame_system::Config::BaseCallFilter`).
     *
     * ## Complexity
     * - O(C) where C is the number of calls to be batched.
     */
    "batch_all": Anonymize<I31fb7db4bv6ln>;
    /**
     * Dispatches a function call with a provided origin.
     *
     * The dispatch origin for this call must be _Root_.
     *
     * ## Complexity
     * - O(1).
     */
    "dispatch_as": Anonymize<I44m1vft5l6o06>;
    /**
     * Send a batch of dispatch calls.
     * Unlike `batch`, it allows errors and won't interrupt.
     *
     * May be called from any origin except `None`.
     *
     * - `calls`: The calls to be dispatched from the same origin. The number of call must not
     * exceed the constant: `batched_calls_limit` (available in constant metadata).
     *
     * If origin is root then the calls are dispatch without checking origin filter. (This
     * includes bypassing `frame_system::Config::BaseCallFilter`).
     *
     * ## Complexity
     * - O(C) where C is the number of calls to be batched.
     */
    "force_batch": Anonymize<I31fb7db4bv6ln>;
    /**
     * Dispatch a function call with a specified weight.
     *
     * This function does not check the weight of the call, and instead allows the
     * Root origin to specify the weight of the call.
     *
     * The dispatch origin for this call must be _Root_.
     */
    "with_weight": Anonymize<Iabas7l138cqgj>;
    /**
     * Dispatch a fallback call in the event the main call fails to execute.
     * May be called from any origin except `None`.
     *
     * This function first attempts to dispatch the `main` call.
     * If the `main` call fails, the `fallback` is attemted.
     * if the fallback is successfully dispatched, the weights of both calls
     * are accumulated and an event containing the main call error is deposited.
     *
     * In the event of a fallback failure the whole call fails
     * with the weights returned.
     *
     * - `main`: The main call to be dispatched. This is the primary action to execute.
     * - `fallback`: The fallback call to be dispatched in case the `main` call fails.
     *
     * ## Dispatch Logic
     * - If the origin is `root`, both the main and fallback calls are executed without
     * applying any origin filters.
     * - If the origin is not `root`, the origin filter is applied to both the `main` and
     * `fallback` calls.
     *
     * ## Use Case
     * - Some use cases might involve submitting a `batch` type call in either main, fallback
     * or both.
     */
    "if_else": Anonymize<I6e58ba477s4l4>;
    /**
     * Dispatches a function call with a provided origin.
     *
     * Almost the same as [`Pallet::dispatch_as`] but forwards any error of the inner call.
     *
     * The dispatch origin for this call must be _Root_.
     */
    "dispatch_as_fallible": Anonymize<I44m1vft5l6o06>;
}>;
export type I31fb7db4bv6ln = {
    "calls": Array<TxCallData>;
};
export type I6prj085oihphp = {
    "index": number;
    "call": TxCallData;
};
export type I44m1vft5l6o06 = {
    "as_origin": Anonymize<I2vjn8o312puvk>;
    "call": TxCallData;
};
export type Iabas7l138cqgj = {
    "call": TxCallData;
    "weight": Anonymize<I4q39t5hn830vp>;
};
export type I6e58ba477s4l4 = {
    "main": TxCallData;
    "fallback": TxCallData;
};
export type I796mh2u66sf32 = AnonymousEnum<{
    /**
     * Immediately dispatch a multi-signature call using a single approval from the caller.
     *
     * The dispatch origin for this call must be _Signed_.
     *
     * - `other_signatories`: The accounts (other than the sender) who are part of the
     * multi-signature, but do not participate in the approval process.
     * - `call`: The call to be executed.
     *
     * Result is equivalent to the dispatched result.
     *
     * ## Complexity
     * O(Z + C) where Z is the length of the call and C its execution weight.
     */
    "as_multi_threshold_1": Anonymize<Iccoh7s156h15i>;
    /**
     * Register approval for a dispatch to be made from a deterministic composite account if
     * approved by a total of `threshold - 1` of `other_signatories`.
     *
     * **If the approval threshold is met (including the sender's approval), this will
     * immediately execute the call.** This is the only way to execute a multisig call -
     * `approve_as_multi` will never trigger execution.
     *
     * Payment: `DepositBase` will be reserved if this is the first approval, plus
     * `threshold` times `DepositFactor`. It is returned once this dispatch happens or
     * is cancelled.
     *
     * The dispatch origin for this call must be _Signed_.
     *
     * - `threshold`: The total number of approvals for this dispatch before it is executed.
     * - `other_signatories`: The accounts (other than the sender) who can approve this
     * dispatch. May not be empty.
     * - `maybe_timepoint`: If this is the first approval, then this must be `None`. If it is
     * not the first approval, then it must be `Some`, with the timepoint (block number and
     * transaction index) of the first approval transaction.
     * - `call`: The call to be executed.
     *
     * NOTE: For intermediate approvals (not the final approval), you should generally use
     * `approve_as_multi` instead, since it only requires a hash of the call and is more
     * efficient.
     *
     * Result is equivalent to the dispatched result if `threshold` is exactly `1`. Otherwise
     * on success, result is `Ok` and the result from the interior call, if it was executed,
     * may be found in the deposited `MultisigExecuted` event.
     *
     * ## Complexity
     * - `O(S + Z + Call)`.
     * - Up to one balance-reserve or unreserve operation.
     * - One passthrough operation, one insert, both `O(S)` where `S` is the number of
     * signatories. `S` is capped by `MaxSignatories`, with weight being proportional.
     * - One call encode & hash, both of complexity `O(Z)` where `Z` is tx-len.
     * - One encode & hash, both of complexity `O(S)`.
     * - Up to one binary search and insert (`O(logS + S)`).
     * - I/O: 1 read `O(S)`, up to 1 mutate `O(S)`. Up to one remove.
     * - One event.
     * - The weight of the `call`.
     * - Storage: inserts one item, value size bounded by `MaxSignatories`, with a deposit
     * taken for its lifetime of `DepositBase + threshold * DepositFactor`.
     */
    "as_multi": Anonymize<I3kqaqg9krebsk>;
    /**
     * Register approval for a dispatch to be made from a deterministic composite account if
     * approved by a total of `threshold - 1` of `other_signatories`.
     *
     * **This function will NEVER execute the call, even if the approval threshold is
     * reached.** It only registers approval. To actually execute the call, `as_multi` must
     * be called with the full call data by any of the signatories.
     *
     * This function is more efficient than `as_multi` for intermediate approvals since it
     * only requires the call hash, not the full call data.
     *
     * Payment: `DepositBase` will be reserved if this is the first approval, plus
     * `threshold` times `DepositFactor`. It is returned once this dispatch happens or
     * is cancelled.
     *
     * The dispatch origin for this call must be _Signed_.
     *
     * - `threshold`: The total number of approvals for this dispatch before it is executed.
     * - `other_signatories`: The accounts (other than the sender) who can approve this
     * dispatch. May not be empty.
     * - `maybe_timepoint`: If this is the first approval, then this must be `None`. If it is
     * not the first approval, then it must be `Some`, with the timepoint (block number and
     * transaction index) of the first approval transaction.
     * - `call_hash`: The hash of the call to be executed.
     *
     * NOTE: To execute the call after approvals are gathered, any signatory must call
     * `as_multi` with the full call data. This function cannot execute the call.
     *
     * ## Complexity
     * - `O(S)`.
     * - Up to one balance-reserve or unreserve operation.
     * - One passthrough operation, one insert, both `O(S)` where `S` is the number of
     * signatories. `S` is capped by `MaxSignatories`, with weight being proportional.
     * - One encode & hash, both of complexity `O(S)`.
     * - Up to one binary search and insert (`O(logS + S)`).
     * - I/O: 1 read `O(S)`, up to 1 mutate `O(S)`. Up to one remove.
     * - One event.
     * - Storage: inserts one item, value size bounded by `MaxSignatories`, with a deposit
     * taken for its lifetime of `DepositBase + threshold * DepositFactor`.
     */
    "approve_as_multi": Anonymize<Ideaemvoneh309>;
    /**
     * Cancel a pre-existing, on-going multisig transaction. Any deposit reserved previously
     * for this operation will be unreserved on success.
     *
     * The dispatch origin for this call must be _Signed_.
     *
     * - `threshold`: The total number of approvals for this dispatch before it is executed.
     * - `other_signatories`: The accounts (other than the sender) who can approve this
     * dispatch. May not be empty.
     * - `timepoint`: The timepoint (block number and transaction index) of the first approval
     * transaction for this dispatch.
     * - `call_hash`: The hash of the call to be executed.
     *
     * ## Complexity
     * - `O(S)`.
     * - Up to one balance-reserve or unreserve operation.
     * - One passthrough operation, one insert, both `O(S)` where `S` is the number of
     * signatories. `S` is capped by `MaxSignatories`, with weight being proportional.
     * - One encode & hash, both of complexity `O(S)`.
     * - One event.
     * - I/O: 1 read `O(S)`, one remove.
     * - Storage: removes one item.
     */
    "cancel_as_multi": Anonymize<I3d9o9d7epp66v>;
    /**
     * Poke the deposit reserved for an existing multisig operation.
     *
     * The dispatch origin for this call must be _Signed_ and must be the original depositor of
     * the multisig operation.
     *
     * The transaction fee is waived if the deposit amount has changed.
     *
     * - `threshold`: The total number of approvals needed for this multisig.
     * - `other_signatories`: The accounts (other than the sender) who are part of the
     * multisig.
     * - `call_hash`: The hash of the call this deposit is reserved for.
     *
     * Emits `DepositPoked` if successful.
     */
    "poke_deposit": Anonymize<I6lqh1vgb4mcja>;
}>;
export type Iccoh7s156h15i = {
    "other_signatories": Anonymize<Ia2lhg7l2hilo3>;
    "call": TxCallData;
};
export type I3kqaqg9krebsk = {
    "threshold": number;
    "other_signatories": Anonymize<Ia2lhg7l2hilo3>;
    "maybe_timepoint"?: Anonymize<I95jfd8j5cr5eh>;
    "call": TxCallData;
    "max_weight": Anonymize<I4q39t5hn830vp>;
};
export type I95jfd8j5cr5eh = (Anonymize<Itvprrpb0nm3o>) | undefined;
export type Ideaemvoneh309 = {
    "threshold": number;
    "other_signatories": Anonymize<Ia2lhg7l2hilo3>;
    "maybe_timepoint"?: Anonymize<I95jfd8j5cr5eh>;
    "call_hash": SizedHex<32>;
    "max_weight": Anonymize<I4q39t5hn830vp>;
};
export type I3d9o9d7epp66v = {
    "threshold": number;
    "other_signatories": Anonymize<Ia2lhg7l2hilo3>;
    "timepoint": Anonymize<Itvprrpb0nm3o>;
    "call_hash": SizedHex<32>;
};
export type I6lqh1vgb4mcja = {
    "threshold": number;
    "other_signatories": Anonymize<Ia2lhg7l2hilo3>;
    "call_hash": SizedHex<32>;
};
export type I6ghfo82p64r0k = AnonymousEnum<{
    /**
     * Authenticates the sudo key and dispatches a function call with `Root` origin.
     */
    "sudo": Anonymize<Iejcklm1m5ig5m>;
    /**
     * Authenticates the sudo key and dispatches a function call with `Root` origin.
     * This function does not check the weight of the call, and instead allows the
     * Sudo user to specify the weight of the call.
     *
     * The dispatch origin for this call must be _Signed_.
     */
    "sudo_unchecked_weight": Anonymize<Iabas7l138cqgj>;
    /**
     * Authenticates the current sudo key and sets the given AccountId (`new`) as the new sudo
     * key.
     */
    "set_key": Anonymize<I8k3rnvpeeh4hv>;
    /**
     * Authenticates the sudo key and dispatches a function call with `Signed` origin from
     * a given account.
     *
     * The dispatch origin for this call must be _Signed_.
     */
    "sudo_as": Anonymize<I440d6i17jrfje>;
    /**
     * Permanently removes the sudo key.
     *
     * **This cannot be un-done.**
     */
    "remove_key": undefined;
}>;
export type Iejcklm1m5ig5m = {
    "call": TxCallData;
};
export type I8k3rnvpeeh4hv = {
    "new": MultiAddress;
};
export type I440d6i17jrfje = {
    "who": MultiAddress;
    "call": TxCallData;
};
export type I6jpmdjrl5du29 = AnonymousEnum<{
    /**
     * Dispatch the given `call` from an account that the sender is authorised for through
     * `add_proxy`.
     *
     * The dispatch origin for this call must be _Signed_.
     *
     * Parameters:
     * - `real`: The account that the proxy will make a call on behalf of.
     * - `force_proxy_type`: Specify the exact proxy type to be used and checked for this call.
     * - `call`: The call to be made by the `real` account.
     */
    "proxy": Anonymize<I9v6oij2c2ajai>;
    /**
     * Register a proxy account for the sender that is able to make calls on its behalf.
     *
     * The dispatch origin for this call must be _Signed_.
     *
     * Parameters:
     * - `proxy`: The account that the `caller` would like to make a proxy.
     * - `proxy_type`: The permissions allowed for this proxy account.
     * - `delay`: The announcement period required of the initial proxy. Will generally be
     * zero.
     */
    "add_proxy": Anonymize<I6hk7temg1mga7>;
    /**
     * Unregister a proxy account for the sender.
     *
     * The dispatch origin for this call must be _Signed_.
     *
     * Parameters:
     * - `proxy`: The account that the `caller` would like to remove as a proxy.
     * - `proxy_type`: The permissions currently enabled for the removed proxy account.
     */
    "remove_proxy": Anonymize<I6hk7temg1mga7>;
    /**
     * Unregister all proxy accounts for the sender.
     *
     * The dispatch origin for this call must be _Signed_.
     *
     * WARNING: This may be called on accounts created by `create_pure`, however if done, then
     * the unreserved fees will be inaccessible. **All access to this account will be lost.**
     */
    "remove_proxies": undefined;
    /**
     * Spawn a fresh new account that is guaranteed to be otherwise inaccessible, and
     * initialize it with a proxy of `proxy_type` for `origin` sender.
     *
     * Requires a `Signed` origin.
     *
     * - `proxy_type`: The type of the proxy that the sender will be registered as over the
     * new account. This will almost always be the most permissive `ProxyType` possible to
     * allow for maximum flexibility.
     * - `index`: A disambiguation index, in case this is called multiple times in the same
     * transaction (e.g. with `utility::batch`). Unless you're using `batch` you probably just
     * want to use `0`.
     * - `delay`: The announcement period required of the initial proxy. Will generally be
     * zero.
     *
     * Fails with `Duplicate` if this has already been called in this transaction, from the
     * same sender, with the same parameters.
     *
     * Fails if there are insufficient funds to pay for deposit.
     */
    "create_pure": Anonymize<I2lbmfajhc5gdu>;
    /**
     * Removes a previously spawned pure proxy.
     *
     * WARNING: **All access to this account will be lost.** Any funds held in it will be
     * inaccessible.
     *
     * Requires a `Signed` origin, and the sender account must have been created by a call to
     * `create_pure` with corresponding parameters.
     *
     * - `spawner`: The account that originally called `create_pure` to create this account.
     * - `index`: The disambiguation index originally passed to `create_pure`. Probably `0`.
     * - `proxy_type`: The proxy type originally passed to `create_pure`.
     * - `height`: The height of the chain when the call to `create_pure` was processed.
     * - `ext_index`: The extrinsic index in which the call to `create_pure` was processed.
     *
     * Fails with `NoPermission` in case the caller is not a previously created pure
     * account whose `create_pure` call has corresponding parameters.
     */
    "kill_pure": Anonymize<I2siheq6f2djrd>;
    /**
     * Publish the hash of a proxy-call that will be made in the future.
     *
     * This must be called some number of blocks before the corresponding `proxy` is attempted
     * if the delay associated with the proxy relationship is greater than zero.
     *
     * No more than `MaxPending` announcements may be made at any one time.
     *
     * This will take a deposit of `AnnouncementDepositFactor` as well as
     * `AnnouncementDepositBase` if there are no other pending announcements.
     *
     * The dispatch origin for this call must be _Signed_ and a proxy of `real`.
     *
     * Parameters:
     * - `real`: The account that the proxy will make a call on behalf of.
     * - `call_hash`: The hash of the call to be made by the `real` account.
     */
    "announce": Anonymize<I2eb501t8s6hsq>;
    /**
     * Remove a given announcement.
     *
     * May be called by a proxy account to remove a call they previously announced and return
     * the deposit.
     *
     * The dispatch origin for this call must be _Signed_.
     *
     * Parameters:
     * - `real`: The account that the proxy will make a call on behalf of.
     * - `call_hash`: The hash of the call to be made by the `real` account.
     */
    "remove_announcement": Anonymize<I2eb501t8s6hsq>;
    /**
     * Remove the given announcement of a delegate.
     *
     * May be called by a target (proxied) account to remove a call that one of their delegates
     * (`delegate`) has announced they want to execute. The deposit is returned.
     *
     * The dispatch origin for this call must be _Signed_.
     *
     * Parameters:
     * - `delegate`: The account that previously announced the call.
     * - `call_hash`: The hash of the call to be made.
     */
    "reject_announcement": Anonymize<Ianmuoljk2sk1u>;
    /**
     * Dispatch the given `call` from an account that the sender is authorized for through
     * `add_proxy`.
     *
     * Removes any corresponding announcement(s).
     *
     * The dispatch origin for this call must be _Signed_.
     *
     * Parameters:
     * - `real`: The account that the proxy will make a call on behalf of.
     * - `force_proxy_type`: Specify the exact proxy type to be used and checked for this call.
     * - `call`: The call to be made by the `real` account.
     */
    "proxy_announced": Anonymize<I3dqpogh1f1c93>;
    /**
     * Poke / Adjust deposits made for proxies and announcements based on current values.
     * This can be used by accounts to possibly lower their locked amount.
     *
     * The dispatch origin for this call must be _Signed_.
     *
     * The transaction fee is waived if the deposit amount has changed.
     *
     * Emits `DepositPoked` if successful.
     */
    "poke_deposit": undefined;
}>;
export type I9v6oij2c2ajai = {
    "real": MultiAddress;
    "force_proxy_type"?: Anonymize<Icdvjlkfnoshag>;
    "call": TxCallData;
};
export type Icdvjlkfnoshag = (Anonymize<Ieuemnllefri8h>) | undefined;
export type I6hk7temg1mga7 = {
    "delegate": MultiAddress;
    "proxy_type": Anonymize<Ieuemnllefri8h>;
    "delay": number;
};
export type I2lbmfajhc5gdu = {
    "proxy_type": Anonymize<Ieuemnllefri8h>;
    "delay": number;
    "index": number;
};
export type I2siheq6f2djrd = {
    "spawner": MultiAddress;
    "proxy_type": Anonymize<Ieuemnllefri8h>;
    "index": number;
    "height": number;
    "ext_index": number;
};
export type I2eb501t8s6hsq = {
    "real": MultiAddress;
    "call_hash": SizedHex<32>;
};
export type Ianmuoljk2sk1u = {
    "delegate": MultiAddress;
    "call_hash": SizedHex<32>;
};
export type I3dqpogh1f1c93 = {
    "delegate": MultiAddress;
    "real": MultiAddress;
    "force_proxy_type"?: Anonymize<Icdvjlkfnoshag>;
    "call": TxCallData;
};
export type I2ig59mlqf9md7 = AnonymousEnum<{
    /**
     * Add a registrar to the system.
     *
     * The dispatch origin for this call must be `T::RegistrarOrigin`.
     *
     * - `account`: the account of the registrar.
     *
     * Emits `RegistrarAdded` if successful.
     */
    "add_registrar": Anonymize<Ic6cqd9g0t65v0>;
    /**
     * Set an account's identity information and reserve the appropriate deposit.
     *
     * If the account already has identity information, the deposit is taken as part payment
     * for the new deposit.
     *
     * The dispatch origin for this call must be _Signed_.
     *
     * - `info`: The identity information.
     *
     * Emits `IdentitySet` if successful.
     */
    "set_identity": Anonymize<I5sv83ib1q5mod>;
    /**
     * Set the sub-accounts of the sender.
     *
     * Payment: Any aggregate balance reserved by previous `set_subs` calls will be returned
     * and an amount `SubAccountDeposit` will be reserved for each item in `subs`.
     *
     * The dispatch origin for this call must be _Signed_ and the sender must have a registered
     * identity.
     *
     * - `subs`: The identity's (new) sub-accounts.
     */
    "set_subs": Anonymize<Ia9mkdf6l44shb>;
    /**
     * Clear an account's identity info and all sub-accounts and return all deposits.
     *
     * Payment: All reserved balances on the account are returned.
     *
     * The dispatch origin for this call must be _Signed_ and the sender must have a registered
     * identity.
     *
     * Emits `IdentityCleared` if successful.
     */
    "clear_identity": undefined;
    /**
     * Request a judgement from a registrar.
     *
     * Payment: At most `max_fee` will be reserved for payment to the registrar if judgement
     * given.
     *
     * The dispatch origin for this call must be _Signed_ and the sender must have a
     * registered identity.
     *
     * - `reg_index`: The index of the registrar whose judgement is requested.
     * - `max_fee`: The maximum fee that may be paid. This should just be auto-populated as:
     *
     * ```nocompile
     * Self::registrars().get(reg_index).unwrap().fee
     * ```
     *
     * Emits `JudgementRequested` if successful.
     */
    "request_judgement": Anonymize<I9l2s4klu0831o>;
    /**
     * Cancel a previous request.
     *
     * Payment: A previously reserved deposit is returned on success.
     *
     * The dispatch origin for this call must be _Signed_ and the sender must have a
     * registered identity.
     *
     * - `reg_index`: The index of the registrar whose judgement is no longer requested.
     *
     * Emits `JudgementUnrequested` if successful.
     */
    "cancel_request": Anonymize<I2ctrt5nqb8o7c>;
    /**
     * Set the fee required for a judgement to be requested from a registrar.
     *
     * The dispatch origin for this call must be _Signed_ and the sender must be the account
     * of the registrar whose index is `index`.
     *
     * - `index`: the index of the registrar whose fee is to be set.
     * - `fee`: the new fee.
     */
    "set_fee": Anonymize<I711qahikocb1c>;
    /**
     * Change the account associated with a registrar.
     *
     * The dispatch origin for this call must be _Signed_ and the sender must be the account
     * of the registrar whose index is `index`.
     *
     * - `index`: the index of the registrar whose fee is to be set.
     * - `new`: the new account ID.
     */
    "set_account_id": Anonymize<I6o1er683vod1j>;
    /**
     * Set the field information for a registrar.
     *
     * The dispatch origin for this call must be _Signed_ and the sender must be the account
     * of the registrar whose index is `index`.
     *
     * - `index`: the index of the registrar whose fee is to be set.
     * - `fields`: the fields that the registrar concerns themselves with.
     */
    "set_fields": Anonymize<Id6gojh30v9ib2>;
    /**
     * Provide a judgement for an account's identity.
     *
     * The dispatch origin for this call must be _Signed_ and the sender must be the account
     * of the registrar whose index is `reg_index`.
     *
     * - `reg_index`: the index of the registrar whose judgement is being made.
     * - `target`: the account whose identity the judgement is upon. This must be an account
     * with a registered identity.
     * - `judgement`: the judgement of the registrar of index `reg_index` about `target`.
     * - `identity`: The hash of the [`IdentityInformationProvider`] for that the judgement is
     * provided.
     *
     * Note: Judgements do not apply to a username.
     *
     * Emits `JudgementGiven` if successful.
     */
    "provide_judgement": Anonymize<Ibk29mtr51rukj>;
    /**
     * Remove an account's identity and sub-account information and slash the deposits.
     *
     * Payment: Reserved balances from `set_subs` and `set_identity` are slashed and handled by
     * `Slash`. Verification request deposits are not returned; they should be cancelled
     * manually using `cancel_request`.
     *
     * The dispatch origin for this call must match `T::ForceOrigin`.
     *
     * - `target`: the account whose identity the judgement is upon. This must be an account
     * with a registered identity.
     *
     * Emits `IdentityKilled` if successful.
     */
    "kill_identity": Anonymize<Id9uqtigc0il3v>;
    /**
     * Add the given account to the sender's subs.
     *
     * Payment: Balance reserved by a previous `set_subs` call for one sub will be repatriated
     * to the sender.
     *
     * The dispatch origin for this call must be _Signed_ and the sender must have a registered
     * sub identity of `sub`.
     */
    "add_sub": Anonymize<Ic68lsi7chpv5k>;
    /**
     * Alter the associated name of the given sub-account.
     *
     * The dispatch origin for this call must be _Signed_ and the sender must have a registered
     * sub identity of `sub`.
     */
    "rename_sub": Anonymize<Ic68lsi7chpv5k>;
    /**
     * Remove the given account from the sender's subs.
     *
     * Payment: Balance reserved by a previous `set_subs` call for one sub will be repatriated
     * to the sender.
     *
     * The dispatch origin for this call must be _Signed_ and the sender must have a registered
     * sub identity of `sub`.
     */
    "remove_sub": Anonymize<Iek0boln8pgnko>;
    /**
     * Remove the sender as a sub-account.
     *
     * Payment: Balance reserved by a previous `set_subs` call for one sub will be repatriated
     * to the sender (*not* the original depositor).
     *
     * The dispatch origin for this call must be _Signed_ and the sender must have a registered
     * super-identity.
     *
     * NOTE: This should not normally be used, but is provided in the case that the non-
     * controller of an account is maliciously registered as a sub-account.
     */
    "quit_sub": undefined;
    /**
     * Add an `AccountId` with permission to grant usernames with a given `suffix` appended.
     *
     * The authority can grant up to `allocation` usernames. To top up the allocation or
     * change the account used to grant usernames, this call can be used with the updated
     * parameters to overwrite the existing configuration.
     */
    "add_username_authority": Anonymize<I452bkd71b385t>;
    /**
     * Remove `authority` from the username authorities.
     */
    "remove_username_authority": Anonymize<Ie83f0p0ke1f4u>;
    /**
     * Set the username for `who`. Must be called by a username authority.
     *
     * If `use_allocation` is set, the authority must have a username allocation available to
     * spend. Otherwise, the authority will need to put up a deposit for registering the
     * username.
     *
     * Users can either pre-sign their usernames or
     * accept them later.
     *
     * Usernames must:
     * - Only contain lowercase ASCII characters or digits.
     * - When combined with the suffix of the issuing authority be _less than_ the
     * `MaxUsernameLength`.
     */
    "set_username_for": Anonymize<Ib9nmpn9ru9aeh>;
    /**
     * Accept a given username that an `authority` granted. The call must include the full
     * username, as in `username.suffix`. Authorities cannot grant usernames to people, only
     * to regular accounts.
     */
    "accept_username": Anonymize<Ie5l999tf7t2te>;
    /**
     * Remove an expired username approval. The username was approved by an authority but never
     * accepted by the user and must now be beyond its expiration. The call must include the
     * full username, as in `username.suffix`.
     */
    "remove_expired_approval": Anonymize<Ie5l999tf7t2te>;
    /**
     * Set a given username as the primary. The username should include the suffix. Only
     * regular accounts can set their primary username, as people can only have one username,
     * granted through a system allocation.
     */
    "set_primary_username": Anonymize<Ie5l999tf7t2te>;
    /**
     * Start the process of removing a username by placing it in the unbinding usernames map.
     * Once the grace period has passed, the username can be deleted by calling
     * [remove_username](crate::Call::remove_username).
     */
    "unbind_username": Anonymize<Ie5l999tf7t2te>;
    /**
     * Permanently delete a username which has been unbinding for longer than the grace period.
     * Caller is refunded the fee if the username expired and the removal was successful.
     */
    "remove_username": Anonymize<Ie5l999tf7t2te>;
    /**
     * Call with [ForceOrigin](crate::Config::ForceOrigin) privileges which deletes a username
     * and slashes any deposit associated with it.
     */
    "kill_username": Anonymize<Ie5l999tf7t2te>;
    /**
     * Sets the username and on-chain account for a person, along with an empty identity which
     * can only be populated using an oracle through the social credential verification system.
     * The chosen username must be domainless.
     *
     * The sender must sign the alias using the key associated with the provided on-chain
     * account to prove ownership.
     *
     * The dispatch origin for this call must be the contextual alias of the person and the
     * sender must not have already registered their identity and username.
     *
     * Emits `PersonalIdentitySet` if successful.
     */
    "set_personal_identity": Anonymize<I6b6ng21g2eap6>;
    /**
     * Open a case for an oracle to judge a social credential of a person.
     *
     * The dispatch origin for this call must be the contextual alias of the person and the
     * sender must have a registered identity.
     *
     * Emits `EvidenceSubmitted` if successful.
     */
    "submit_personal_credential_evidence": Anonymize<Ia5eqng70q48q6>;
    /**
     * Callback to enforce the judgement of a social credential. This is to be called only by
     * the oracle that judged the case.
     */
    "personal_credential_judged": Anonymize<I79nh52dspn15s>;
    /**
     * Clear a person's identity info. The sender must pay a penalty through the associated
     * alias account for removing the identity.
     *
     * The dispatch origin for this call must be the contextual alias of the person and the
     * sender must have a registered identity.
     *
     * Emits `IdentityPersonalCleared` if successful.
     */
    "clear_personal_identity": undefined;
    /**
     * Report a username as invalid/offensive/wrong/anything else.
     *
     * The dispatch origin for this call must be a signed extrinsic.
     *
     * - `username`: The username to be reported.
     */
    "report_username": Anonymize<Ie5l999tf7t2te>;
    /**
     * Given judgement on a previously reported username either:
     * 1. In case username was found valid:
     * - slashes the amount deposited by the reporter,
     * - does nothing to the identity behind the reported username,
     * 2. In case username was found invalid:
     * - returns the deposited funds to the reporter,
     * - bans the identity behind the reported username.
     * Serves as a callback used upon judgement request to the oracle.
     * Must only be used by the statement oracle.
     */
    "reported_username_judged": Anonymize<I79nh52dspn15s>;
}>;
export type Ic6cqd9g0t65v0 = {
    "account": MultiAddress;
};
export type I5sv83ib1q5mod = {
    "info": Anonymize<Ibr5qtvptt8691>;
};
export type Ia9mkdf6l44shb = {
    "subs": Array<Anonymize<I910puuahutflf>>;
};
export type I9l2s4klu0831o = {
    "reg_index": number;
    "max_fee": bigint;
};
export type I2ctrt5nqb8o7c = {
    "reg_index": number;
};
export type I711qahikocb1c = {
    "index": number;
    "fee": bigint;
};
export type I6o1er683vod1j = {
    "index": number;
    "new": MultiAddress;
};
export type Id6gojh30v9ib2 = {
    "index": number;
    "fields": bigint;
};
export type Ibk29mtr51rukj = {
    "reg_index": number;
    "target": MultiAddress;
    "judgement": Anonymize<Icl2bbh90k7l2q>;
    "identity": SizedHex<32>;
};
export type Id9uqtigc0il3v = {
    "target": MultiAddress;
};
export type Ic68lsi7chpv5k = {
    "sub": MultiAddress;
    "data": IdentityData;
};
export type Iek0boln8pgnko = {
    "sub": MultiAddress;
};
export type I452bkd71b385t = {
    "authority": MultiAddress;
    "suffix": Uint8Array;
    "allocation": number;
};
export type Ie83f0p0ke1f4u = {
    "suffix": Uint8Array;
    "authority": MultiAddress;
};
export type Ib9nmpn9ru9aeh = {
    "who": MultiAddress;
    "username": Uint8Array;
    "signature"?: (Anonymize<I3fo6882e5tjh8>) | undefined;
    "use_allocation": boolean;
};
export type I3fo6882e5tjh8 = AnonymousEnum<{
    "Ed25519": SizedHex<64>;
    "Sr25519": SizedHex<64>;
    "Ecdsa": SizedHex<65>;
    "Eth": SizedHex<65>;
}>;
export type I6b6ng21g2eap6 = {
    "account": SS58String;
    "signature": Anonymize<I3fo6882e5tjh8>;
    "username": Uint8Array;
};
export type Ia5eqng70q48q6 = {
    "credential": Anonymize<Ifgk0bca7f05om>;
};
export type I79nh52dspn15s = {
    "ticket": number;
    "context": Uint8Array;
    "judgement": Anonymize<Id32895epm7otq>;
};
export type I5a8s1jvri01ss = AnonymousEnum<{
    /**
     * Dispatch a call under an alias using the `account <-> alias` mapping.
     *
     * This is a call version of the transaction extension `AsPersonalAliasWithAccount`.
     * It is recommended to use the transaction extension instead when suitable.
     */
    "under_alias": Anonymize<Iejcklm1m5ig5m>;
    /**
     * This transaction is refunded if successful and no alias was previously set.
     *
     * The call is valid from `call_valid_at` until
     * `call_valid_at + account_setup_time_tolerance`.
     * `account_setup_time_tolerance` is a constant available in the metadata.
     *
     * Parameters:
     * - `account`: The account to set the alias for.
     * - `call_valid_at`: The block number when the call becomes valid.
     */
    "set_alias_account": Anonymize<I6viutd279aov3>;
    /**
     * Remove the mapping from a particular alias to its registered account.
     */
    "unset_alias_account": undefined;
    /**
     * Recognize a set of people without any additional checks.
     *
     * The people are identified by the provided list of keys and will each be assigned, in
     * order, the next available personal ID.
     */
    "force_recognize_personhood": Anonymize<I6tuqjmsr5ahcq>;
    /**
     * Set a personal id account.
     *
     * The account can then be used to sign transactions on behalf of the personal id, and
     * provide replay protection with the nonce.
     *
     * This transaction is refunded if successful and no account was previously set for the
     * personal id.
     *
     * The call is valid from `call_valid_at` until
     * `call_valid_at + account_setup_time_tolerance`.
     * `account_setup_time_tolerance` is a constant available in the metadata.
     *
     * Parameters:
     * - `account`: The account to set the alias for.
     * - `call_valid_at`: The block number when the call becomes valid.
     */
    "set_personal_id_account": Anonymize<I6viutd279aov3>;
    /**
     * Unset the personal id account.
     */
    "unset_personal_id_account": undefined;
    /**
     * Create the people collection.
     *
     * This call is valid only if the collection doesn't exist yet. Once created,
     * this call cannot be executed again.
     *
     * The collection is created with a fixed configuration:
     * - Owner: Configured via `CollectionOwner` type
     * - Onboarding size: `PEOPLE_ONBOARDING_SIZE` (10)
     * - Mode: `Flexible`
     * - Ring size: `R2e9`
     */
    "create_people_collection": undefined;
    /**
     * Remove stale alias <-> account mappings.
     *
     * A mapping is stale when:
     * - its context has been removed from [`Config::AccountContexts`] (governance
     * reconfiguration, ended airdrop etc.), or
     * - its ring has been deleted.
     *
     * Revision mismatches do not render an alias stale. The user can continue
     * transacting via `AsPersonalAliasWithAccountRevised` without having to
     * redo account setup.
     *
     * Typically submitted by the OCW, but the dispatch does not trust
     * the caller. Each alias is re-validated via
     * [`Self::ensure_alias_is_stale`]; those that are not stale are
     * skipped.
     *
     * At most [`MAX_BULK_CLEANUP`] aliases are processed per call.
     *
     * The transaction source must be local or in-block. Thus, external
     * invocations are not permitted.
     */
    "clean_up_stale_aliases": Anonymize<I8k2cd3v73pgjh>;
}>;
export type I6viutd279aov3 = {
    "account": SS58String;
    "call_valid_at": number;
};
export type I8k2cd3v73pgjh = {
    "aliases": Array<Anonymize<Icq9999ubti4jr>>;
};
export type Id7gcu75dd10kk = AnonymousEnum<{
    /**
     * Feeless on success (determined only by top three lines).
     */
    "vote": Anonymize<Ia56ucs8f4gubv>;
    "close_case": Anonymize<Id1vp19i5a7adv>;
    /**
     * Origin must be `None`. The transaction is validated in `ValidateUnsigned`
     * when the source is local (e.g. from the offchain worker). For external transactions, use
     * `clean_vote_signed`.
     */
    "clean_vote": Anonymize<Ic01glfot2319>;
    "reap_case": Anonymize<Id1vp19i5a7adv>;
    "intervene": Anonymize<Ibi23t489qjaej>;
    /**
     * A person claims the mob credit associated with a correct vote on a case.
     * The case must be `Done`.
     */
    "claim_vote": Anonymize<Id1vp19i5a7adv>;
    /**
     * A person converts their claimed mob credit into a direct transfer.
     */
    "payout_rewards": Anonymize<I6a7ia4g91p320>;
    /**
     * A person claims multiple mob credits associated a correct vote on a case. The
     * case must be `Done`.
     */
    "claim_votes": Anonymize<I7iebj213rflmh>;
    "start_payout_round": undefined;
    "schedule_payout_rounds": Anonymize<I1c6o7t4005obp>;
    "remove_payout_schedule": Anonymize<I666bl2fqjkejo>;
    "claim_credit": undefined;
    "clean_points": Anonymize<I3sgg3ifcuhgsi>;
    "force_ripen_case": Anonymize<Id1vp19i5a7adv>;
    "touch_case": Anonymize<Id1vp19i5a7adv>;
    "clear_voting_penalty": undefined;
    /**
     * Origin must be signed.
     */
    "clean_vote_signed": Anonymize<Ic01glfot2319>;
}>;
export type Ia56ucs8f4gubv = {
    "case_index": number;
    "opinion": Anonymize<Id32895epm7otq>;
};
export type I6a7ia4g91p320 = {
    "destination": SS58String;
};
export type I7iebj213rflmh = {
    "case_indices": Anonymize<Icgljjb6j82uhn>;
};
export type I9t98vnr0hbhog = AnonymousEnum<{
    /**
     * - Declare intention to get a tattoo.
     * - Deposit is taken.
     * - `InkType` may not be `ProceduralDerivative`.
     */
    "apply": undefined;
    /**
     * - Open a judicial case to judge the `evidence`.
     * - Calls Judicial/`JudgeStatement(POI_HASH, evidence)`
     * - Needs `SignedExtension` to avoid upfront requirement for fee if `judgements == 0`.
     * - If `judgements > 0`, then an additional fee should be charged into Treasury.
     */
    "submit_evidence": Anonymize<I2t4r3qi2bbfq5>;
    /**
     * Is called by the Oracle when the evidence has been judged.
     */
    "judged": Anonymize<I79nh52dspn15s>;
    /**
     * - Gets a new `index`
     * - Puts an entry into `People`.
     * - Calls People/`newPerson(index, key)`
     *
     * # Arguments
     * * `key` - The personal identity to register.
     * * `destination` - The account receiving the candidate's referral reward.
     * * `proof_of_ownerhsip` - The signature of predefined prefix `"pop register using"`
     * concatenated with the sender account id.
     */
    "register_referred": Anonymize<I1kb7l7cim8dam>;
    /**
     * - Gets a new `index`
     * - Puts an entry into `People`.
     * - Calls People/`newPerson(index, key)`
     *
     * # Arguments
     * * `key` - The personal identity to register.
     * * `destination` - The account receiving rewards.
     * * `proof_of_ownerhsip` - The signature of predefined prefix `"pop register using"`
     * concatenated with the sender account id.
     *
     * # Warning:
     *
     * This call can pay two rewards to the same account for non-referred candidates.
     * The app is responsible for any additional privacy handling after transfer.
     */
    "register_non_referred": Anonymize<I1kb7l7cim8dam>;
    "reroll": undefined;
    /**
     * Commit to a design and authorize the storage for (possibly just initial) evidence.
     *
     * If a specific personal identity is required, then this can be placed in `require_id`.
     * This can be any unused/unreserved personal identity no greater than the `NextId`
     * counter.
     */
    "commit": Anonymize<I9cpejm8q1n41i>;
    "allocate_full": undefined;
    /**
     * Once a timeout passes, removes a candidate who is selected but not yet proven.
     * If the candidate was referred then referral is bad, if candidate applied with deposit,
     * deposit is slashed.
     */
    "timeout": Anonymize<Icbccs0ug47ilf>;
    /**
     * Remove a candidate who has not yet committed.
     */
    "flakeout": undefined;
    /**
     * Utilize a referral signature.
     *
     * The payload to be signed by the referrer using their registered key pair is the encoded
     * bytes of the account ID of the candidate.
     */
    "apply_with_signature": Anonymize<I48li8do1boqsk>;
    /**
     * Apply to the Proof-of-Ink process with an invitation.
     *
     * The payload to be signed by the inviter using their registered key pair is the encoded
     * bytes of the account ID of the candidate.
     */
    "apply_with_invitation": Anonymize<I8cj8rnq5f1nol>;
    /**
     * Add a design family. Must have privileged access to do this.
     */
    "add_design_family": Anonymize<Idnsos6tvi9tt6>;
    /**
     * Add a referral ticket associated with a person.
     *
     * Only one referral ticket may be active at any given time for one person. Calling this
     * extrinsic while a valid ticket is set will overwrite the existing ticket.
     *
     * If any pending referral rewards are present, they need to be registered first.
     */
    "set_referral_ticket": Anonymize<I95p7g3tmk59ap>;
    /**
     * Cancel a referral ticket associated with a person.
     */
    "cancel_referral_ticket": Anonymize<I95p7g3tmk59ap>;
    "register_successful_referral_reward": Anonymize<I6a7ia4g91p320>;
    /**
     * Grants invites to an account so they can distribute them.
     *
     * The origin must be `InvitationsOrigin.
     *
     * - `account`: The account to give invites to.
     * - `count`: The number of invites to give.
     */
    "grant_invites": Anonymize<Ibl1gaa0rn2c67>;
    /**
     * Remove all invites given to an account.
     *
     * The origin must be `InvitationsOrigin`.
     *
     * - `account`: The account to remove all invites from.
     * - `limit`: The maximum number of pending invites to remove.
     */
    "remove_available_and_pending_invites": Anonymize<Id8vsjdockv55e>;
    /**
     * Invite an account.
     *
     * The origin must be signed by an account and have some invites left.
     *
     * - `ticket`: The invite ticket to set.
     */
    "set_invite_ticket": Anonymize<I95p7g3tmk59ap>;
    /**
     * Cancel an invitation.
     *
     * The origin must be signed by the account that owns the ticket to cancel.
     *
     * - `ticket`: The invite ticket to cancel.
     */
    "cancel_invite_ticket": Anonymize<I95p7g3tmk59ap>;
    /**
     * Set the configuration record. Must have privileged access to do this.
     */
    "set_configuration": Anonymize<I4s48t49obgv40>;
    /**
     * Set the values of the reimbursement awarded to referred candidates as well as their
     * referrers, along with the number of reimbursements for each value. These values are
     * stored in
     * reverse order of their priority, so the last value in the list will be the first one
     * to be used by the reimbursement system. The length of the two lists must be equal.
     *
     * WARNING!
     *
     * After the number of reimbursements is exhausted for a value in the list, the pallet
     * starts using the next value immediately for future transfers.
     */
    "set_reimbursement_values": Anonymize<I1b497vgt5ie3v>;
}>;
export type I2t4r3qi2bbfq5 = {
    "evidence": SizedHex<32>;
};
export type I1kb7l7cim8dam = {
    "key": SizedHex<32>;
    "destination": SS58String;
    "proof_of_ownership": SizedHex<64>;
};
export type I9cpejm8q1n41i = {
    "choice": Enum<{
        "DesignedElective": Anonymize<I9jd27rnpm8ttv>;
        "ProceduralAccount": number;
        "ProceduralPersonal": number;
        "Procedural": Anonymize<I5g2vv0ckl2m8b>;
        "ProceduralDerivative": [bigint, Anonymize<I35p85j063s0il>];
    }>;
    "require_id"?: Anonymize<I35p85j063s0il>;
};
export type I48li8do1boqsk = {
    "referrer": bigint;
    "signature": Anonymize<I3fo6882e5tjh8>;
    "ticket": SS58String;
};
export type I8cj8rnq5f1nol = {
    "inviter": SS58String;
    "ticket": SS58String;
    "signature": Anonymize<I3fo6882e5tjh8>;
};
export type I95p7g3tmk59ap = {
    "ticket": SS58String;
};
export type Id8vsjdockv55e = {
    "account": SS58String;
    "limit": number;
};
export type I1b497vgt5ie3v = {
    "referred_values": Anonymize<Ifip05kcrl65am>;
    "referrer_values": Anonymize<Ifip05kcrl65am>;
};
export type I3g84u7212cn6d = AnonymousEnum<{
    /**
     * Sign up for the game using an account and an invite.
     *
     * This is for new players or archived players, other players should use
     * [`Pallet::sign_up_with_account`] for free.
     *
     * A game must be ongoing and in its registration phase.
     *
     * `airdrop` optionally enters the player into this game's airdrop draw. Pass `None` to
     * skip it. When `Some`, it is the player's VRF, which both seeds their draw slot and
     * proves their identity path: the alias variant if the player is recognized (pallet-score
     * `recognition` is `Recognized` or `ExternallyRecognized`), otherwise the account variant.
     * See the documentation of [`AirdropVrf`] for more details.
     *
     * The origin must be a signed by an account and use the `GameAsInvited` extension.
     */
    "sign_up_with_invite": Anonymize<I5vj4b1eolhu8i>;
    /**
     * Sign up for the game using an account.
     *
     * If the player is new or archived, then a deposit will be taken from the signer.
     * Otherwise the call is free.
     *
     * A game must be ongoing and in its registration phase.
     *
     * `airdrop` optionally enters the player into this game's airdrop draw. Pass `None` to
     * skip it. When `Some`, it is the player's VRF, which both seeds their draw slot and
     * proves their identity path: the alias variant if the player is recognized (pallet-score
     * `recognition` is `Recognized` or `ExternallyRecognized`), otherwise the account variant.
     * See the documentation of [`AirdropVrf`] for more details.
     *
     * The origin must be signed by an account, or, be signed by an account and use
     * `ScoreAsParticipant` extension.
     */
    "sign_up_with_account": Anonymize<I5vj4b1eolhu8i>;
    /**
     * Sign up for the game.
     *
     * If a player is already recognized by another DIM, they can sign using their alias and
     * don't need any deposit or invite to prove their initial credibility.
     * On top of this their score is never going below personhood threshold and the player will
     * never get archived.
     *
     * A game must be ongoing and in its registration phase.
     *
     * The origin must be a personal alias.
     *
     * Parameters:
     * - `statement_account`: the account id to use to interact with the statement store during
     * the game.
     * - `sig`: the proof of ownership of the account `statement_account` by an alias, it is
     * the signature of the message `"pop:game:stmt_account_for_alias:"` concatenated to the
     * alias, and then hashed with `blake2_256` (blake2 256bit output). The base of the
     * message can be found in the constant: `proof_of_ownership_msg_base`.
     * - `airdrop`: optionally enters the player into this game's airdrop draw, Pass `None` to
     * skip it. When `Some`, it is the player's VRF, which both seeds their draw slot and
     * proves their identity path: the alias VRF must be used for alias-based players given
     * they are recognized in pallet-score participant information. See the documentation of
     * `AirdropVrf` for more details.
     */
    "sign_up_with_alias": Anonymize<If3trlhj4nhm3u>;
    /**
     * After the game, send the full report.
     *
     * The game must be ongoing and in its reporting phase.
     *
     * The origin must be an alias, or signed by an account, or signed by an account and use
     * `ScoreAsParticipant` extension.
     *
     * After the votes from the report are counted, the reporter and each of the reported
     * players whose attendance can now be determined are processed early. This lets the
     * game skip the player-process phase entirely when every player has been processed by
     * the end of reporting.
     */
    "report": Anonymize<I8dtsqbl6shss6>;
    /**
     * Offboard a player from the game.
     *
     * The origin must be an alias, or signed by an account, or signed by an account and use
     * `ScoreAsParticipant` extension.
     *
     * There must be no game or the existing game must be in registration phase and the player
     * must have not signed up for the game.
     */
    "offboard": undefined;
    /**
     * Kickout a kickable player that is not playing after `NonPlayingKickoutTime`.
     *
     * The origin must be signed by an account.
     *
     * - `player`: The player to kickout. It must be archived and kickable with
     * `archived_since` older than `NonPlayingKickoutTime`.
     */
    "kickout": Anonymize<Ifpsbvfoe7erus>;
    /**
     * Grant some invites to an account so they can distribute them.
     *
     * The origin must be `InviteIssuer`.
     *
     * - `account`: The account to grant invites to.
     * - `count`: The number of invites to grant.
     */
    "grant_invites": Anonymize<Ibl1gaa0rn2c67>;
    /**
     * Clear all invites given to an account.
     *
     * The origin must be `InviteIssuer`.
     *
     * - `account`: The account to remove all invites from.
     * - `limit`: The maximum number of pending invites to remove.
     */
    "remove_available_and_pending_invites": Anonymize<Id8vsjdockv55e>;
    /**
     * Invite an account.
     *
     * The origin must be signed by an account and have some invites left.
     *
     * - `ticket`: The invite ticket to set.
     */
    "set_invite_ticket": Anonymize<I95p7g3tmk59ap>;
    /**
     * Cancel an invite.
     *
     * The origin must be signed by the account that owns the ticket to cancel.
     *
     * - `ticket`: The invite ticket to cancel.
     */
    "cancel_invite_ticket": Anonymize<I95p7g3tmk59ap>;
    /**
     * Schedules new games according to provided schedules.
     * Schedules must be in chronological order, and after the ongoing game (if there is any).
     */
    "schedule_games": Anonymize<I4mfip5i7mpjk2>;
    "remove_scheduled_game": Anonymize<Ic9lb0ksm6bqp9>;
    /**
     * Update the configured play deposit amount for future account signups.
     */
    "set_play_deposit": Anonymize<I3qt1hgg4djhgb>;
    /**
     * Claim a prize from the airdrop event scheduled for `game_index`.
     *
     * Eligibility requires 2 conditions on the claimant to be recognized and have attended the
     * game. In more details:
     * * to be either recognized in pallet-score (`recognition.is_recognized()`) or to have
     * reached the personhood score (`reached_personhood`),
     * * AND for `game_index` to match the participant's `last_attended_game` — i.e. the most
     * recent game the claimant actually attended must be exactly the game the airdrop is
     * tied to. Subsequent game attendance overrides this information so the claim must be
     * made before attending another game.
     *
     * Claims against a cancelled game are rejected.
     */
    "claim_airdrop": Anonymize<I2254l15dgaup8>;
    /**
     * Force start the shuffle before its normal start time.
     *
     * This action can only be performed by the root origin and is only meant for testing.
     */
    "testnet_force_start_shuffle": undefined;
    /**
     * Force end a game's reporting phase before its normal end time.
     *
     * This action can only be performed by the root origin and is only meant for testing.
     */
    "testnet_force_end_reporting": undefined;
    /**
     * Override the game phase durations.
     *
     * Restricted to [`Config::ManagerOrigin`] (or root). Until reset, all future
     * game schedules use these phases instead of [`Config::DefaultPhaseDurations`].
     * To revert, the manager re-issues the call with the desired explicit
     * values — there is no separate clear extrinsic.
     *
     * Only callable while no game exists or the current game is still in its
     * Registration phase; otherwise fails with [`Error::InvalidGameState`]. This
     * prevents changing phase durations once players have committed to a game
     * whose timing is already locked in.
     */
    "set_game_phases": Anonymize<I7rcbn8l002fcc>;
    /**
     * Kill the current game, regardless of which phase it is in.
     *
     * Restricted to [`Config::ManagerOrigin`] (or root). Intended as an emergency
     * recovery lever when a game is stuck or its state has been corrupted.
     */
    "kill_current_game": undefined;
}>;
export type I5vj4b1eolhu8i = {
    "identifier_key": SizedHex<65>;
    "airdrop"?: Anonymize<I5up1790507e25>;
};
export type I5up1790507e25 = (Enum<{
    "Account": {
        "pre_output": SizedHex<32>;
        "proof": SizedHex<64>;
    };
    "Alias": Anonymize<I42om4bkmip9ue>;
}>) | undefined;
export type I42om4bkmip9ue = {
    "proof": Uint8Array;
    "ring_index": number;
    "revision": number;
};
export type If3trlhj4nhm3u = {
    "identifier_key": SizedHex<65>;
    "statement_account": SS58String;
    "sig": Anonymize<I3fo6882e5tjh8>;
    "airdrop"?: Anonymize<I5up1790507e25>;
};
export type I8dtsqbl6shss6 = {
    "full_report": Array<Array<Enum<{
        "Person": undefined;
        "NotPerson": undefined;
    }>>>;
};
export type Ifpsbvfoe7erus = {
    "player": SS58String;
};
export type I4mfip5i7mpjk2 = {
    "games_schedules": Anonymize<I9sbfhir4aitej>;
};
export type I2254l15dgaup8 = {
    "game_index": number;
    "beneficiary": SS58String;
};
export type I4h2fcgcv43u00 = AnonymousEnum<{
    /**
     * Schedule payout rounds.
     *
     * Called from `ManagerOrigin` or root.
     */
    "schedule_payout_rounds": Anonymize<Icpk5dvoekngbe>;
    /**
     * Remove a scheduled payout round.
     *
     * Called from `ManagerOrigin` or root.
     */
    "remove_payout_schedule": Anonymize<I666bl2fqjkejo>;
    /**
     * Start a new round.
     *
     * This is valid if the current round is finished, or if the current round doesn't have
     * planning and a schedule exists to plan it.
     *
     * This is a task, and can be called from anybody.
     */
    "transition_round": Anonymize<Iepoo00jurbs3c>;
    /**
     * Operate some round paying out.
     *
     * Drains round's participants, up to a limit. For each participant, add the calculated
     * reward (`base_reward + remainder_portion`) to their `credit` balance.
     *
     * Then, moves funds on the pot account from Payout to Credit, so they are owed to specific
     * participants rather than the round pool.
     *
     * Finally, release the leftover from the Payout hold back to the pot's free balance
     * (funds are recycled).
     *
     * This is a task, and can be called from anybody.
     *
     * * round_index: The index of the round to operate.
     * * limit: The maximum number of participants to operate in this call.
     */
    "operate_payout_round": Anonymize<I6vn2ukq88hmrf>;
    /**
     * Cash out half of the score, rounded up. Converts the score into points for the current
     * payout round. Caller must have never reached personhood since onboarding.
     *
     * It can be called once per game session (era).
     *
     * Origin must be signed or participant (signed extrinsic using ScoreAsParticipant
     * transaction extension)
     *
     * Alias origin is not allowed as they can't cash out.
     */
    "cash_out": undefined;
    /**
     * Redeem full accumulated credit, transferring it to the provided destination account.
     *
     * Credit is converted from points during payout processing.
     *
     * Origin must be a person alias, a signed account or a participant (signed extrinsic
     * using ScoreAsParticipant transaction extension).
     */
    "redeem_credit": Anonymize<I6a7ia4g91p320>;
    /**
     * Register as a person, or resume personhood after suspension.
     *
     * Requires score >= personhood threshold (or having previously reached it).
     *
     * If the participant was previously recognised and is now suspended, they must not provide
     * a key. The existing key is reused.
     *
     * If the participant was never recognised, they must provide a key and a proof of
     * ownership (`key` parameter): a signature over `"pop register using" ||
     * sender_account_id`.
     *
     * Origin must be signed or a participant (signed extrinsic using ScoreAsParticipant
     * transaction extension).
     */
    "register": Anonymize<Iea8e3kkhkfkdo>;
    /**
     * Set the absence grace schedule.
     *
     * Every tier must satisfy: `0 <= window <= 8` and `allowed_misses < window`.
     * `allowed_misses = 0` disables grace entirely (any absence immediately
     * suspends).
     *
     * Tiers must be provided in ascending order of `population_size_threshold`.
     *
     * An empty schedule disables the grace period entirely (immediate
     * suspension on any missed game). The new ratio takes effect at the start
     * of the next report session when `update_thresholds()` recalculates
     * `AbsenceGraceRatio`.
     *
     * Called from `ManagerOrigin` or root.
     */
    "set_absence_grace_schedule": Anonymize<I2onutgm9avq0n>;
    /**
     * Set the personhood-threshold schedule.
     *
     * Tiers must be:
     * - non-empty,
     * - sorted ascending by `population_size_threshold`,
     * - capped by a final tier with `population_size_threshold == u32::MAX`,
     * - per-tier: `0 < score_threshold <= MAX_PERSONHOOD_THRESHOLD` (= 21),
     * - have non-decreasing `score_threshold` across tiers.
     *
     * The new curve takes effect at the start of the next report session
     * when `update_thresholds()` recalculates `PersonhoodThreshold`.
     *
     * Already-recognized participants are NOT retroactively suspended:
     * the new bar only gates future score evaluations in `set_attendance`.
     *
     * Called from `ManagerOrigin` or root.
     */
    "set_personhood_threshold_schedule": Anonymize<I4270jaa2l0rr6>;
}>;
export type I6vn2ukq88hmrf = {
    "round_index": number;
    "limit": number;
};
export type Iea8e3kkhkfkdo = {
    "key"?: ([SizedHex<32>, SizedHex<64>]) | undefined;
};
export type I2onutgm9avq0n = {
    "schedule": Anonymize<Idrbto15rld189>;
};
export type I4270jaa2l0rr6 = {
    "schedule": Anonymize<I26np7pq4hc9kt>;
};
export type I3c4r0hatvif1e = AnonymousEnum<{
    /**
     * Reserve a number of personal IDs.
     */
    "reserve_ids": Anonymize<Iafscmv8tjf0ou>;
    /**
     * Renew a personal ID. The ID must not be in use.
     */
    "renew_id_reservation": Anonymize<I4ov6e94l79mbg>;
    /**
     * Cancel a personal ID reservation.
     */
    "cancel_id_reservation": Anonymize<I4ov6e94l79mbg>;
    /**
     * Grant personhood for a list of candidates that have reserved personal IDs.
     */
    "recognize_personhood": Anonymize<Ib5ou59k6na5qv>;
    /**
     * Suspend the personhood of a list of recognized people. The people must not currently be
     * suspended.
     */
    "suspend_personhood": Anonymize<I7qh4t1qniuepu>;
    /**
     * Resume someone's personhood. The person must currently be suspended.
     */
    "resume_personhood": Anonymize<I4ov6e94l79mbg>;
    /**
     * Start a mutation session in the underlying `People` interface. This call does not check
     * whether a mutation session is already ongoing and can start new sessions.
     */
    "start_mutation_session": undefined;
    /**
     * End a mutation session in the underlying `People` interface. This call can end multiple
     * mutation sessions, even ones not started by this pallet.
     *
     * This call will fail if no mutation session is ongoing.
     */
    "end_mutation_session": undefined;
}>;
export type Ib5ou59k6na5qv = {
    "ids_and_keys": Array<[bigint, SizedHex<32>]>;
};
export type I7qh4t1qniuepu = {
    "ids": Array<bigint>;
};
export type I6huceroqg8td3 = AnonymousEnum<{
    /**
     * Grant some attestation allowance to an account so they can attest people.
     *
     * The origin must be `AttestationAllowanceManager`.
     *
     * - `account`: The account to grant attestations to.
     * - `count`: The number of attestations to grant.
     */
    "increase_attestation_allowance": Anonymize<Ibl1gaa0rn2c67>;
    /**
     * Clear all attestation allowance for an account.
     *
     * The origin must be `AttestationAllowanceManager`.
     *
     * - `account`: The account to remove all attestations from.
     */
    "clear_attestation_allowance": Anonymize<Icbccs0ug47ilf>;
    /**
     * Attest an account.
     *
     * The origin must be signed by an account and have some attestation allowance left.
     *
     * The authority will have to get two signatures from the user:
     * - one created using their account key attesting to the ownership of the `candidate`
     * account;
     * - one created using their ring-vrf key attesting to the ownership of the `ring_vrf_key`
     * key.
     *
     * The message to be signed by both keys from which the signatures are generated is created
     * by concatenating the bytes "pop:people-lite:register using" with the encoded bytes of
     * the user's account (`candidate`), and the encoded bytes of the ring VRF key
     * (`ring_vrf_key`).
     *
     * On success, this call:
     * - stores lite registration data in `LitePeople`,
     * - adds the user's ring VRF key to the lite member collection.
     *
     * The lite member collection must already have been initialized by `on_poll`.
     *
     * - `candidate`: The candidate to be recognized as a lite person.
     * - `candidate_signature`: The signature, provided by the candidate, to allow the attester
     * to complete the registration process on their behalf.
     * - `ring_vrf_key`: The ring VRF key to be associated with the lite person.
     * - `ring_vrf_key_signature`: The ring VRF signature, provided by the candidate, to allow
     * the attester to complete the registration process. This also prove the ownership of
     * the ring VRF key by the candidate.
     * - consumer_registration: Optional parameter which can contain the necessary information
     * to forward a consumer registration request to the `LiteConsumerRegistrar` service. If
     * present, it also contains a signature created by the user in order to validate the
     * intent. More information on the signing payload generation available in
     * [types::LiteConsumerRegistrationParams::signing_payload].
     */
    "attest": Anonymize<Iddfuva7fle38r>;
    "dispatch_as_signer": Anonymize<Iejcklm1m5ig5m>;
    /**
     * Set the account associated with a lite alias.
     *
     * The call is valid from `valid_at_block` until
     * `valid_at_block + account_setup_block_tolerance`.
     */
    "set_alias_account": Anonymize<Iefam38o91ona9>;
    "unset_alias_account": undefined;
}>;
export type Iddfuva7fle38r = {
    "candidate": SS58String;
    "candidate_signature": Anonymize<I3fo6882e5tjh8>;
    "ring_vrf_key": SizedHex<32>;
    "proof_of_ownership": SizedHex<64>;
    "consumer_registration"?: ({
        "signature": Anonymize<I3fo6882e5tjh8>;
        "account": SS58String;
        "identifier_key": SizedHex<65>;
        "username": Uint8Array;
        "reserved_username"?: Anonymize<Iabpgqcjikia83>;
    }) | undefined;
};
export type Iefam38o91ona9 = {
    "account": SS58String;
    "valid_at_block": number;
};
export type I4n7unmaqs9i43 = AnonymousEnum<{
    /**
     * Register a lite person as a consumer.
     */
    "register_lite_person": Anonymize<Ifd8dbgpm7srdt>;
    /**
     * Register a proven person as a consumer.
     *
     * The person must link a previously recognized lite identity, which will be upgraded to a
     * full person consumer. In order to prove they hold the lite identity they want to link,
     * users must provide a `lite_identity_proof` signature, created by signing the alias bytes
     * using their lite consumer account.
     *
     * The consumer can choose if they want to have a new username or use an existing
     * reservation made in the name of the lite consumer who will be linked.
     */
    "register_person": Anonymize<Ifbug00rch8etj>;
    /**
     * Update a person's authorization by ensuring they can still authenticate as people.
     *
     * This call must be performed at least `MinPersonAuthUpdateInterval` seconds after the
     * last update in order to prevent spam.
     */
    "touch_person_authorization": undefined;
    /**
     * Remove an expired entry from a username reservation queue. The target entry is
     * identified by `account` and can be at any position in the queue.
     * Each call removes exactly one entry, so it must be called repeatedly to
     * clear multiple expired reservations.
     *
     * This is a permissionless call; the origin must be authorized. The `account`
     * parameter is also used for transaction pool deduplication, allowing parallel
     * submissions that target different expired entries in the same queue.
     */
    "remove_expired_username_reservation": Anonymize<I28tfrqrmts741>;
    /**
     * Update the communication identifier key of a consumer.
     *
     * The origin must be the account registered for that consumer, regardless of their
     * credibility.
     */
    "update_identifier_key": Anonymize<Ievhkup0angt51>;
    /**
     * Set the duration for which a username reservation is valid, in seconds.
     *
     * The origin must be root.
     */
    "set_username_reservation_duration": Anonymize<I1i6t85s8phv1c>;
    /**
     * Demote a full person to a lite person after their authorization has expired.
     *
     * This is a permissionless call; the origin must be authorized.
     */
    "demote_auth_expired": Anonymize<Icbccs0ug47ilf>;
    /**
     * Associate a statement account with a friend request context sequence.
     *
     * The associated account can submit statements while this friend request registration is
     * active.
     * The origin must be `Origin::FriendRequestAlias`, created by the `AsResources`
     * (`RegisterFriendRequestWithProof(..)`) transaction extension after proof validation.
     * On success, increases statement allowance and stores registration state
     * `{account_id, reference}`.
     *
     * Parameters:
     * * `reference`: friend request period/sequence pair.
     * - `reference.period` must be in the accepted period window: `[period(now -
     * FriendRequestGraceWindow), period(now)]`.
     * - `reference.seq` must be in `0..=FriendRequestSlotsPerPeriod`.
     * * `account_id`: statement account to authorize. Must not already be used by another
     * friend request registration.
     */
    "set_friend_request_statement_account_for_sequence": Anonymize<Id77vvrgqmru2o>;
    /**
     * Clear a stale friend request registration and revoke its statement allowance.
     *
     * This is a permissionless call; the origin must be authorized.
     * Succeeds only when the registration's period-derived expiry has elapsed.
     * On success, removes friend request registration state and decreases statement allowance.
     *
     * Parameters:
     * * `account`: statement account previously associated with a friend request registration.
     * * `seq`: friend request sequence to clear. Must match stored registration sequence and
     * be in `0..=FriendRequestSlotsPerPeriod`.
     */
    "clear_expired_friend_request_sequence": Anonymize<I5os021n9mtdcr>;
    /**
     * Claim an anonymous statement store allowance for a target account.
     *
     * The origin must be `Origin::StmtStoreAlias`, produced by the `AsResources`
     * (`RegisterStatementStoreAllowance(..)`) transaction extension after proof validation.
     * On success, increases the statement allowance for `target_account` and stores the
     * mapping in `StatementStoreAllowances`.
     *
     * Parameters:
     * * `period`: day number since Unix epoch. Must be in the accepted period window.
     * * `seq`: slot number within the period, bounded by the collection-specific limit.
     * * `target_account`: statement account to authorize.
     */
    "set_statement_store_account": Anonymize<I66tl4phltl6bg>;
    /**
     * Remove expired statement store allowances for a past period.
     *
     * This is a permissionless call; the origin must be authorized.
     * Removes up to `StmtStoreCleanupLimit` entries from `StatementStoreAllowances` for
     * the given `period`, decreasing the statement allowance for each removed account.
     */
    "clear_expired_stmt_store_allowances": Anonymize<I4t3pgt4ilgpf6>;
    /**
     * Claim long-term storage on a remote chain using an anonymous membership proof.
     *
     * The origin must be `Origin::LongTermStorageClaim(alias, collection)`, created by the
     * `AsResources` (`ClaimLongTermStorage(..)`) transaction extension after ring-VRF proof
     * validation.
     *
     * Parameters:
     * * `period`: the claiming period. Must be the current period or the previous one if
     * within the grace window.
     * * `counter`: the claim counter within the period. Must be less than
     * `LongTermStorageClaimsPerPeriod`. Each counter produces a distinct alias.
     * * `account_id`: the account to authorize for storage on the remote chain.
     */
    "claim_long_term_storage": Anonymize<Ifles5ioatcuip>;
    /**
     * Clear spent long-term storage aliases for an expired period.
     *
     * This is a permissionless call authorized via the `authorize` attribute. It can be
     * called by anyone once a period has fully expired (past the grace window).
     *
     * Parameters:
     * * `period`: the expired period to clear aliases for.
     * * `limit`: the maximum number of entries to remove in this call.
     */
    "clear_expired_long_term_storage_aliases": Anonymize<Id2jcn0qee7h6f>;
}>;
export type Ifd8dbgpm7srdt = {
    "identifier_key": SizedHex<65>;
    "username": Uint8Array;
    "reserved_username"?: Anonymize<Iabpgqcjikia83>;
};
export type Ifbug00rch8etj = {
    "linked_lite_identity": SS58String;
    "lite_identity_proof": Anonymize<I3fo6882e5tjh8>;
    "username_choice": Enum<{
        "Standalone": Uint8Array;
        "Reservation": Uint8Array;
    }>;
};
export type Ievhkup0angt51 = {
    "identifier_key": SizedHex<65>;
};
export type I5os021n9mtdcr = {
    "account": SS58String;
    "seq": number;
};
export type I66tl4phltl6bg = {
    "period": number;
    "seq": number;
    "target_account": SS58String;
};
export type I4t3pgt4ilgpf6 = {
    "period": number;
    "first_entry": SizedHex<32>;
};
export type Ifles5ioatcuip = {
    "period": number;
    "counter": number;
    "account_id": SS58String;
};
export type Id2jcn0qee7h6f = {
    "period": number;
    "limit": number;
};
export type I9sqknhnkp2m32 = AnonymousEnum<{
    /**
     * Adds a new page of chunks.
     *
     * The hash of the chunks must match the hash stored on-chain in `ChunkPageHashes`.
     * The call will fail if the page already exists on-chain.
     */
    "add_chunks": Anonymize<Ijgrep2ca50rk>;
    /**
     * Sets the expected hashes for chunk pages for a given ring exponent.
     *
     * Allows setting the expected hashes that chunks must match when added via
     * `add_chunks`.
     *
     * The origin must be `ManagerOrigin` or root.
     */
    "set_chunk_page_hashes": Anonymize<Iasnonvq8v9o5g>;
}>;
export type Ijgrep2ca50rk = {
    "ring_exponent": Anonymize<Idvob66qflhcgd>;
    "page_index": number;
    "encoded_chunks": Uint8Array;
};
export type Iasnonvq8v9o5g = {
    "ring_exponent": Anonymize<Idvob66qflhcgd>;
    "page_hashes": Anonymize<Ic5m5lp1oioo8r>;
};
export type Ierhmhea1o4d6a = AnonymousEnum<{
    /**
     * Merge the members in two rings into a single, new ring. In order for the rings to be
     * eligible for merging, they must be below 1/2 of max capacity, have no pending
     * suspensions and not be the top ring used for onboarding.
     */
    "merge_rings": Anonymize<I6mk90q9np5nf3>;
    /**
     * Force set the onboarding size for a collection. This call requires root privileges.
     */
    "set_onboarding_size": Anonymize<Ichkkipipv6vbf>;
    /**
     * Allow a member waiting in the onboarding queue to include themselves into a ring
     * after enough time has passed. This bypasses the normal cohort-based onboarding size
     * requirement.
     *
     * This call must be dispatched with a `SelfInclude` origin, authenticated by the
     * `AsMember` transaction extension. The rings must be in append-only mode.
     *
     * The `call_valid_at` parameter dictates the time window in which this transaction is
     * valid and represents the timestamp (in seconds since the UNIX epoch) when this call
     * becomes valid.
     */
    "self_include": Anonymize<Ie0n67dnlcbpcf>;
    /**
     * Build a ring root for a specific ring in a collection.
     *
     * Submitted by the OCW with a `to_include` snapshot from
     * [`Self::should_build_ring`]. Leftovers from later onboarding are picked up
     * on the next OCW tick, or by the member via [`Self::self_include`] when
     * cohort gating stalls onboarding.
     */
    "build_ring_authorized": Anonymize<I1bv5scdc27nbb>;
    /**
     * Onboard members from the onboarding queue for a specific collection.
     *
     * Submitted by the offchain worker.
     */
    "onboard_members_authorized": Anonymize<I12c2udla9t40g>;
    /**
     * Merge the top two onboarding queue pages for a specific collection.
     *
     * Submitted by the offchain worker.
     */
    "merge_queue_pages_authorized": Anonymize<I4eperb3q65q14>;
    /**
     * Remove suspended keys from a specific ring in a collection.
     *
     * Submitted by the offchain worker.
     */
    "remove_suspended_keys_authorized": Anonymize<Idpufnltgsuodp>;
    /**
     * Delete a page for a specific ring in a collection.
     *
     * Submitted by the offchain worker.
     */
    "delete_ring_page_authorized": Anonymize<I8lare4sf457ul>;
    /**
     * Enqueue a ring for deletion as part of collection deletion.
     *
     * Archives the ring root, notifies subscribers, removes ring metadata, and
     * enqueues ring pages into `RingDeletionQueue` for processing by
     * `delete_ring_page_authorized`.
     *
     * Submitted by the offchain worker.
     */
    "enqueue_ring_deletion_authorized": Anonymize<Idpufnltgsuodp>;
    /**
     * Delete an onboarding queue page as part of collection deletion.
     *
     * Removes all `Members` entries for the members in the page, then removes
     * the page itself. Can only proceed when all rings and ring pages have been
     * fully deleted.
     *
     * Submitted by the offchain worker.
     */
    "delete_onboarding_queue_page_authorized": Anonymize<I2gt0vglt3agsj>;
    /**
     * Finalize collection deletion.
     *
     * Removes all remaining per-collection storage and the owner's identifier
     * reference. Can only proceed when all rings, ring pages, and onboarding
     * queue pages have been fully deleted.
     *
     * Submitted by the offchain worker.
     */
    "finalize_collection_deletion_authorized": Anonymize<Idjiu7vp8ovdab>;
    /**
     * Mark a ring as stale so the offchain worker will rebuild it.
     *
     * Anyone can submit this transaction if the ring has members that are not
     * yet included in the root (`total > included`) and the ring is not already
     * marked stale. This is a recovery mechanism in case the `StaleRings` entry
     * was lost or never inserted.
     */
    "mark_ring_stale_authorized": Anonymize<Idpufnltgsuodp>;
    /**
     * Clean up expired old ring roots.
     *
     * Removes up to `limit` old ring roots for the given ring in the given
     * collection.
     *
     * The transaction source must be `Local` or `InBlock`.
     *
     * This is a maintenance call. Submitted by the offchain worker.
     */
    "clean_up_old_roots_authorized": Anonymize<I4maqh2jefgv7u>;
}>;
export type Ie0n67dnlcbpcf = {
    "identifier": SizedHex<32>;
    "member": SizedHex<32>;
    "call_valid_at": bigint;
};
export type I1bv5scdc27nbb = {
    "identifier": SizedHex<32>;
    "ring_index": number;
    "ring_exponent": Anonymize<Idvob66qflhcgd>;
    "revision": number;
    "to_include": number;
};
export type I12c2udla9t40g = {
    "identifier": SizedHex<32>;
    "ring_index": number;
    "head": number;
};
export type I4eperb3q65q14 = {
    "identifier": SizedHex<32>;
    "initial_head": number;
    "new_head": number;
};
export type I8lare4sf457ul = {
    "identifier": SizedHex<32>;
    "ring_index": number;
    "page_index": number;
};
export type I2gt0vglt3agsj = {
    "identifier": SizedHex<32>;
    "page_index": number;
};
export type I4maqh2jefgv7u = {
    "identifier": SizedHex<32>;
    "ring_index": number;
    "limit": number;
};
export type Ic5jkkq7dsbfh = AnonymousEnum<{
    /**
     * Split a coin into multiple coins.
     *
     * The origin must be a [Origin::Coin], which can be obtained from the transaction
     * extension [AsCoinage].
     *
     * The call is free and ages the resulting coins by one.
     *
     * The `split_into` parameter contains a vector of pairs, each pair containing a coin
     * value and a list of destination account ids. For each pair, a new coin with the given
     * value is created for each destination account id.
     *
     * Validity requirements:
     * (an invalid transaction won't be included in a block, the coin is not consumed)
     * * The coin's age must be less than [Config::MaximumAge].
     * * The coin value must be within the bounds defined by [Config::MinimumExponent] and
     * [Config::MaximumExponent].
     * * The total value of the new coins must equal the value of the origin coin.
     * * The number of outputs must not exceed [Config::MaxSplitOutputs].
     * * The age of the new coins is set to the age of the origin coin plus one.
     * * Each destination account must not already have a coin.
     */
    "split": Anonymize<Ibv24s7lkcbv1r>;
    /**
     * Transfer a coin to another account.
     *
     * The origin must be a [Origin::Coin], which can be obtained from the transaction
     * extension [AsCoinage].
     *
     * The call is free and ages the resulting coin by one.
     *
     * Validity requirements:
     * (an invalid transaction won't be included in a block, the coin is not consumed)
     * * The destination account must not already have a coin.
     * * The coin's age must be less than [Config::MaximumAge].
     */
    "transfer": Anonymize<Iadkk9nq2cqqve>;
    /**
     * Load coin into a recycler.
     *
     * The origin must be a [Origin::Coin], which can be obtained from the transaction
     * extension [AsCoinage].
     *
     * The call is free.
     *
     * The `member_key` parameter is the member key to be included in the recycler, and whose
     * alias is used to unload from the recycler.
     *
     * Validity requirements:
     * (an invalid transaction won't be included in a block, the coin is not consumed)
     * * The `member_key` must not already be used in another recycler.
     * * The `member_key` must be valid (i.e. well formed).
     * * The `proof_of_ownership` must be a valid signature of the coin's account id by the
     * `member_key`.
     * * The recycler collection for the coin's value must already exist
     */
    "load_recycler_with_coin": Anonymize<I1b55a83kk37g4>;
    /**
     * Load external asset into a recycler.
     *
     * The origin must be a signed origin.
     *
     * The transaction fee is refunded.
     *
     * The `preservation` parameter indicates how the asset transfer should preserve the
     * signer's account.
     *
     * The `value` parameter indicates the coin value to be loaded into the recycler.
     * The equivalent amount of the underlying asset is transferred from the signer to
     * the pallet account.
     *
     * The `member_key` parameter is the member key to be included in the recycler, and whose
     * alias is used to unload from the recycler.
     *
     * The `proof_of_ownership` parameter is the signature of the signer's account id by the
     * `member_key`.
     *
     * Requirements:
     * * The `member_key` must not already be used in another recycler.
     * * The `member_key` must be valid (i.e. well formed).
     * * The `value` must be within the bounds defined by [Config::MinimumExponent] and
     * [Config::MaximumExponent].
     * * The signer must have enough balance of the underlying asset to cover the equivalent
     * amount for the given coin value.
     * * The `proof_of_ownership` must be a valid signature of the signer's account id by the
     * `member_key`.
     */
    "load_recycler_with_external_asset": Anonymize<Icdnv1iut1hln7>;
    /**
     * Load external asset into a recycler (infallible, validated unpaid variant).
     *
     * The origin must be [Origin::InfallibleUnpaidSigned], which can be obtained from the
     * transaction extension variant [AsCoinage::InfallibleUnpaidSigned].
     *
     * The transaction extension validation phase must ensure:
     * - The `member_key` is valid and not already used in another recycler.
     * - The `proof_of_ownership` is a valid signature of the signer's account id by the
     * `member_key`.
     * - The `value` is within the bounds defined by [Config::MinimumExponent] and
     * [Config::MaximumExponent], and can be losslessly converted to an asset amount.
     * - The signer has enough balance of the underlying asset to cover the equivalent amount
     * for the given coin value (respecting `preservation`).
     * - The nonce is valid for replay protection.
     * - The recycler collection for `value` already exists.
     *
     * The call is free.
     */
    "load_recycler_with_external_asset_unpaid": Anonymize<Icdnv1iut1hln7>;
    /**
     * Batched variant of [`Self::load_recycler_with_external_asset_unpaid`].
     *
     * The origin must be [Origin::InfallibleUnpaidSigned], which can be obtained from the
     * transaction extension variant [AsCoinage::InfallibleUnpaidSigned]. The extension
     * validates each inner item and additionally checks within-batch member-key uniqueness
     * and that the signer's balance covers the sum of all inner asset amounts.
     *
     * This call dispatches each inner load by re-running the same checks the extension
     * just performed (see [`RecyclerManager::load`]). The redundancy matches the defensive
     * pattern used by [`Self::load_recycler_with_external_asset_unpaid`]: a dispatch path
     * that fails any of these checks is a logic bug in the extension, not a user error.
     *
     * The call is free.
     */
    "load_recycler_with_external_asset_unpaid_batch": Anonymize<I8a919tojdi2qf>;
    /**
     * Unload a recycler to mint a new coin.
     *
     * The origin must be a [Origin::UnloadToken] with `fee: UnloadFee::Prepaid`, which can be
     * obtained from the transaction extension [AsCoinage] using `AsUnloadTokenPeople`,
     * `AsUnloadTokenLitePeople`, or `AsUnloadTokenPaid` variants.
     *
     * This function allows a user to prove they own one or more coins in a recycler ring
     * without revealing which specific coins they own. It consolidates one or multiple inputs
     * into a single output coin.
     *
     * Parameters:
     * * `aliases`: the list of aliases corresponding to the member keys included in the
     * recycler. The proofs for these aliases are contained in the origin.
     * * `value` and `index`: identifies the recycler being unloaded.
     * * `_revision`: the recycler revision used for the alias_proofs.
     * * `to`: the destination account for the new coin.
     *
     * Requirements:
     * * The origin must be [Origin::UnloadToken] with `fee: UnloadFee::Prepaid`.
     * * The recycler identified by `value` and `index` must exist.
     * * The alias proofs provided in the origin must be valid for the recycler's revision.
     * * The `aliases` provided must match the aliases derived from the proofs.
     * * The aliases must not have been already unloaded from this recycler.
     * * The number of aliases must be a power of two.
     * * The resulting consolidated value must not exceed [Config::MaximumExponent].
     */
    "unload_recycler_into_coin": Anonymize<I8en8uvi5isgvj>;
    /**
     * Unload a recycler to withdraw the underlying external asset.
     *
     * The origin must be [Origin::UnloadToken], which can be obtained from the transaction
     * extension [AsCoinage].
     *
     * When `fee` is [UnloadFee::Prepaid] (via free or paid unload token), no fee is deducted.
     * When `fee` is [UnloadFee::FromOutput], the fee is deducted from the unloaded assets.
     *
     * This function allows a user to withdraw their coins back into the underlying
     * asset (e.g., stablecoin).
     *
     * Parameters:
     * * `aliases`: the list of aliases corresponding to the member keys included in the
     * recycler. The proofs for these aliases are contained in the origin.
     * * `value` and `index`: identifies the recycler being unloaded.
     * * `_revision`: the recycler revision used for the alias_proofs.
     * * `to`: the destination account for the underlying asset.
     *
     * Requirements:
     * * The origin must be [Origin::UnloadToken].
     * * The recycler identified by `value` and `index` must exist.
     * * The alias proofs provided in the origin must be valid for the recycler's revision.
     * * The aliases must not have been already unloaded (except for the first one when `fee`
     * is [UnloadFee::FromOutput], which was pre-marked in the extension).
     */
    "unload_recycler_into_external_asset": Anonymize<I8en8uvi5isgvj>;
    /**
     * Pay the fee to register a member key for a paid unload token using a coin.
     *
     * The origin must be a [Origin::Coin], which can be obtained from the transaction
     * extension [AsCoinage].
     *
     * The coin is consumed. The fee is deducted from the coin's value and transferred to
     * [Config::FeeDestination]. The remaining value of the coin is destroyed.
     *
     * If the call fails, the origin coin is still consumed.
     *
     * To protect the user against varying fees, if the coin's value is less than the fee, the
     * call is invalid (an invalid call never goes into a block).
     *
     * The `proof_of_ownership` is a signature of the caller's account ID by the `member_key`.
     * This ensures the caller controls the member key to prevent front-running.
     *
     * Requirements:
     * * The coin's age must be less than [Config::MaximumAge].
     * * The coin value must be sufficient to cover the fee.
     * * The `member_key` must be valid and not already used.
     * * The `proof_of_ownership` must be valid.
     */
    "pay_for_recycler_unload_fee_token_with_coin": Anonymize<I1b55a83kk37g4>;
    /**
     * Pay the fee to register a member key for a paid unload token using the native currency.
     *
     * The origin must be Signed.
     *
     * This adds the `member_key` to a "paid unload token ring". Being part of this ring
     * allows the user to later generate an anonymous `UnloadToken` to unload a recycler.
     *
     * The fee is transferred from the caller to [Config::FeeDestination].
     *
     * The `proof_of_ownership` is a signature of the caller's account ID by the `member_key`.
     * This ensures the caller controls the member key to prevent front-running.
     *
     * Requirements:
     * * The `member_key` must be valid and not already used.
     * * The `proof_of_ownership` must be valid.
     */
    "pay_for_recycler_unload_fee_token_with_native": Anonymize<I1b55a83kk37g4>;
    /**
     * Pay the fee to register a member key for a paid unload token using the underlying asset
     * i.e. the stablecoin.
     *
     * The origin must be Signed.
     *
     * This adds the `member_key` to a "paid unload token ring". Being part of this ring
     * allows the user to later generate an anonymous `UnloadToken` to unload a recycler.
     *
     * The fee is transferred from the caller to [Config::FeeDestination].
     *
     * The `proof_of_ownership` is a signature of the caller's account ID by the `member_key`.
     * This ensures the caller controls the member key to prevent front-running.
     *
     * Requirements:
     * * The `member_key` must be valid and not already used.
     * * The `proof_of_ownership` must be valid.
     */
    "pay_for_recycler_unload_fee_token_with_stable": Anonymize<I1b55a83kk37g4>;
    /**
     * Unload a recycler into a mix of external asset and fresh vouchers.
     *
     * The origin must be [Origin::UnloadToken], which can be obtained from the transaction
     * extension [AsCoinage].
     *
     * This function allows a user to offboard part of the unloaded value into the underlying
     * asset while reminting the rest as fresh recycler vouchers.
     *
     * When `fee` is [UnloadFee::Prepaid], `external_asset_amount` is transferred as-is.
     * When `fee` is [UnloadFee::FromOutput], the fee is deducted from the specified
     * `external_asset_amount`, so the recipient receives the remainder.
     *
     * Parameters:
     * * `aliases`: the list of aliases corresponding to the member keys included in the
     * recycler. The proofs for these aliases are contained in the origin.
     * * `value` and `index`: identifies the recycler being unloaded.
     * * `revision`: the recycler revision used for the alias proofs.
     * * `to`: the destination account for the external asset portion.
     * * `external_asset_amount`: the gross asset portion to offboard from the unloaded value.
     * * `new_vouchers`: the fresh recycler vouchers to mint from the remaining unloaded value.
     *
     * The total unloaded value must always equal the asset portion plus the voucher portion.
     * In `FromOutput` mode, the asset portion must be large enough to cover the unload fee.
     *
     * Requirements:
     * * The origin must be [Origin::UnloadToken].
     * * The recycler identified by `value` and `index` must exist.
     * * The alias proofs provided in the origin must be valid for the recycler's revision.
     * * The aliases must not have been already unloaded (except for the first one when `fee`
     * is [UnloadFee::FromOutput], which was pre-marked in the extension).
     * * `new_vouchers` must not be empty, and all voucher member keys must be valid and
     * unused.
     * * The total unloaded value must equal `external_asset_amount` plus the total asset value
     * of `new_vouchers`.
     * * When using [UnloadFee::FromOutput], `external_asset_amount` must cover the fee.
     */
    "unload_recycler_into_external_asset_and_vouchers": Anonymize<Ibg509ejf21uui>;
    /**
     * Unload a recycler to withdraw the underlying external asset (non-anonymous).
     *
     * Convenience wrapper around [Self::unload_recyclers_into_external_asset_non_anonymous]
     * for the single-recycler case.
     *
     * See [Self::unload_recyclers_into_external_asset_non_anonymous] for full documentation.
     */
    "unload_recycler_into_external_asset_non_anonymous": Anonymize<I59uphia91t9fq>;
    /**
     * Unload multiple recyclers to withdraw the underlying external asset (non-anonymous).
     *
     * This is a non-anonymous version of [Self::unload_recyclers_into_external_asset]
     * where the fee is paid explicitly by the signer rather than through the anonymous
     * unload token ring, and for multiple recyclers.
     *
     * The fee charged is one unload token fee per recycler (i.e., `inputs.len()`).
     *
     * Parameters:
     * * `inputs`: A list of inputs, specifying the recycler and aliases to unload.
     * * `alias_proofs`: the proofs for all aliases across all inputs, signed over a message
     * that includes the signer. The proofs must correspond sequentially to the aliases in
     * `inputs`.
     * * `to`: the destination account for the asset.
     * * `fee_currency`: whether to pay the fee in native currency or stable asset.
     *
     * Requirements:
     * * The origin must be Signed.
     * * All specified recyclers must exist.
     * * The alias proofs must correspond sequentially to the aliases in `inputs`.
     * * `inputs` must not be empty and each element must contain at least one alias.
     * * The signer must have sufficient balance to pay the fee (one fee per recycler).
     */
    "unload_recyclers_into_external_asset_non_anonymous": Anonymize<Iagbupr13a1rnf>;
    /**
     * Unload a recycler to mint multiple new coins (split).
     *
     * The origin must be a [Origin::UnloadToken] with `fee: UnloadFee::Prepaid`.
     *
     * This function combines the functionality of [Self::unload_recycler_into_coin] and
     * [Self::split] in a single atomic operation. The resulting coins' age is 1 because
     * the action of splitting age coins. This is also important because resulting coins
     * are not entirely fresh, they can be linked to other coins.
     *
     * Unlike [Self::unload_recycler_into_coin], this call does **not** require the number of
     * aliases to be a power of two.
     *
     * Parameters:
     * * `aliases`: the list of aliases corresponding to the member keys included in the
     * recycler. The proofs for these aliases are contained in the origin.
     * * `value` and `index`: identifies the recycler being unloaded.
     * * `revision`: the recycler revision used for the alias_proofs.
     * * `split_into`: a vector of pairs, each pair containing a coin value and a list of
     * destination account ids.
     * * `max_fee`: the maximum fee the caller is willing to pay, expressed in the underlying
     * asset balance. It must be equal to the difference between the total value of the
     * unloaded coins and the total value of the new coins defined in `split_into`.
     *
     * When using [UnloadFee::Prepaid], this must be 0.
     * When using [UnloadFee::FromOutput], this amount is deducted from the input: the
     * network fee is transferred to [Config::FeeDestination] and any remainder is burned.
     * The caller can query `get_paid_unload_token_fee_in_asset` to estimate the fee.
     *
     * This parameter serves as a safeguard: the transaction is rejected at validation if the
     * actual network fee exceeds `max_fee`, protecting the caller from excessive fee
     * increases that would render the argument `split_into` invalid (unloaded funds must be
     * higher than the split plus the fee).
     *
     * Requirements:
     * * The origin must be [Origin::UnloadToken].
     * * The recycler identified by `value` and `index` must exist.
     * * The alias proofs provided in the origin must be valid for the recycler's revision.
     * * The `aliases` provided must match the aliases derived from the proofs.
     * * The total value of the new coins defined in `split_into` plus `max_fee` must equal the
     * total value of the unloaded coins.
     * * `max_fee` must be a multiple of the minimum coin. (This is implied by the condition
     * above).
     * * Each destination account must not already have a coin.
     * * When using [UnloadFee::Prepaid], `max_fee` must be 0.
     * * When using [UnloadFee::FromOutput], `max_fee` must cover the network fee.
     */
    "unload_recycler_into_coins": Anonymize<I497d2v63rjmg>;
    /**
     * Directly offboard a fresh, 0-age coin into the underlying external asset.
     *
     * The origin must be a [Origin::Coin], obtained through [AsCoinage] using `AsCoin`.
     *
     * Because the coin must be fresh (`age == 0`), this call bypasses the
     * recycler/unload-token offboarding flow and releases the underlying asset directly.
     *
     * Parameters:
     * * `to`: destination account that receives the released underlying asset amount.
     *
     * Requirements:
     * * The origin must be [Origin::Coin].
     * * The coin must be fresh: `coin.age == 0`.
     * * The coin value must be representable as underlying-asset amount.
     */
    "direct_offboard_coin_into_external_asset": Anonymize<Iadkk9nq2cqqve>;
    /**
     * Set the underlying asset id used by the pallet.
     *
     * The origin must satisfy [`Config::UnderlyingAssetIdManager`]. The setter is
     * **single-use**: calling it again after the asset id has been set returns
     * [`Error::AssetIdAlreadySet`]. Changing the underlying asset after coins exist would
     * orphan the held balances of every in-flight coin, so the on-chain decision is
     * intentionally one-shot.
     *
     * The asset id must already exist in [`Config::Fungibles`].
     */
    "set_underlying_asset_id": Anonymize<I22bm4d7re21j9>;
    /**
     * Clean up an expired recycler.
     *
     * This is a maintenance call. The origin must be authorized and from local source.
     *
     * This removes an old recycler that has exceeded its expiration time.
     * Any remaining (not unloaded) value in the recycler is considered lost and added to
     * [TotalValueOfDestroyedCoins].
     */
    "clean_recycler": Anonymize<Icnkee0to4c5ac>;
    /**
     * Cleanup storage for consumed free unload tokens of old periods.
     *
     * This is a maintenance call. The origin must be authorized and from local source.
     */
    "clean_consumed_free_token": Anonymize<I7ts20td7b1pmf>;
    /**
     * Clean up a single ring in an expired paid unload token collection.
     *
     * This is a maintenance call. The origin must be authorized and from local source.
     * Rings must be cleaned sequentially (ring 0 first, then 1, etc.) before the
     * collection can be deleted via
     * [`delete_expired_paid_unload_token_collection`](Self::delete_expired_paid_unload_token_collection).
     */
    "clean_paid_unload_token_ring": Anonymize<I7315hlp5liq47>;
    /**
     * Clean up dust for recyclers.
     *
     * This is a maintenance call. The origin must be authorized and from local source.
     * Removes up to DUST_CLEANUP_BATCH_SIZE unloaded alias entries per call to bound the
     * operation.
     */
    "clean_recycler_dust": undefined;
    /**
     * Clean up dust for paid unload tokens.
     *
     * This is a maintenance call. The origin must be authorized and from local source.
     */
    "clean_paid_unload_token_dust": undefined;
    /**
     * Delete an expired paid unload token collection after all rings have been cleaned.
     *
     * This is a maintenance call. The origin must be authorized and from local source.
     * All rings must have been cleaned via
     * [`clean_paid_unload_token_ring`](Self::clean_paid_unload_token_ring) before this
     * can be called.
     */
    "delete_expired_paid_unload_token_collection": Anonymize<I7ts20td7b1pmf>;
}>;
export type Ibv24s7lkcbv1r = {
    "split_into": Anonymize<Iahm4pssu1c80p>;
};
export type Iahm4pssu1c80p = Array<[number, Anonymize<Ia2lhg7l2hilo3>]>;
export type Iadkk9nq2cqqve = {
    "to": SS58String;
};
export type I1b55a83kk37g4 = {
    "member_key": SizedHex<32>;
    "proof_of_ownership": SizedHex<64>;
};
export type Icdnv1iut1hln7 = {
    "preservation": Enum<{
        "Expendable": undefined;
        "Protect": undefined;
        "Preserve": undefined;
    }>;
    "value": number;
    "member_key": SizedHex<32>;
    "proof_of_ownership": SizedHex<64>;
};
export type I8a919tojdi2qf = {
    "items": Array<Anonymize<Icdnv1iut1hln7>>;
};
export type I8en8uvi5isgvj = {
    "aliases": Anonymize<Ic5m5lp1oioo8r>;
    "value": number;
    "index": number;
    "revision": number;
    "to": SS58String;
};
export type Ibg509ejf21uui = {
    "aliases": Anonymize<Ic5m5lp1oioo8r>;
    "value": number;
    "index": number;
    "revision": number;
    "to": SS58String;
    "external_asset_amount": bigint;
    "new_vouchers": Anonymize<Iqnbvitf7a7l3>;
};
export type I59uphia91t9fq = {
    "input": Anonymize<Iblrnm4k0nni51>;
    "alias_proofs": Anonymize<Itom7fk49o0c9>;
    "to": SS58String;
    "fee_currency": Anonymize<I1h1i9ifhurrkc>;
};
export type Iblrnm4k0nni51 = {
    "value": number;
    "index": number;
    "revision": number;
    "aliases": Anonymize<Ic5m5lp1oioo8r>;
};
export type Iagbupr13a1rnf = {
    "inputs": Array<Anonymize<Iblrnm4k0nni51>>;
    "alias_proofs": Anonymize<Itom7fk49o0c9>;
    "to": SS58String;
    "fee_currency": Anonymize<I1h1i9ifhurrkc>;
};
export type I497d2v63rjmg = {
    "aliases": Anonymize<Ic5m5lp1oioo8r>;
    "value": number;
    "index": number;
    "revision": number;
    "split_into": Anonymize<Iahm4pssu1c80p>;
    "max_fee": bigint;
};
export type I4fsg1b207pt46 = AnonymousEnum<{
    /**
     * Registers the parachain as a subscriber.
     * The initial state will be sent over shortly via XCM.
     *
     * ## Origin
     * Requires `ManageOrigin` (governance/root).
     *
     * ## Parameters
     * - `subscriber_parachain_id`: The ParaId of the subscribing parachain.
     * - `members_collections`: List of collection identifiers to subscribe to and their
     * respective ring exponents.
     * - `pallet_index`: Pallet index of members-subscriber on the subscriber chain.
     */
    "subscribe": Anonymize<Ic73rrpct6ckoa>;
    /**
     * Unsubscribes a parachain.
     *
     * ## Origin
     * - **Self-unsubscribe**: Subscriber parachain via XCM (`EnsureSubscriberOrigin`)
     * - **Governance unsubscribe**: Requires `ManageOrigin`
     *
     * ## Parameters
     * - `subscriber_parachain_id`: The ParaId to unsubscribe. Required for governance, ignored
     * for self-unsubscribe (derived from XCM origin).
     */
    "unsubscribe": Anonymize<Ib1hmb261fe7mh>;
    /**
     * Requests replay of specific ring roots.
     *
     * Permissionless — any signed origin can request a replay for any subscriber.
     * The subscriber parachain is identified by the `subscriber_parachain_id` parameter.
     *
     * Parameters:
     * - `subscriber_parachain_id`: The ParaId of the subscriber.
     * - `identifier`: Collection identifier.
     * - `ring_root_indices`: List of ring root indices, must be in strictly ascending order.
     */
    "request_replay": Anonymize<I9jfggcqa8oi6c>;
    /**
     * Enqueues pending updates into a sealed batch for distribution.
     *
     * Authorized call submitted by the offchain worker.
     */
    "enqueue_updates": Anonymize<I437snu8jbuaj2>;
    /**
     * Sends the current batch to a specific subscriber.
     *
     * Authorized maintenance call submitted by the offchain worker.
     */
    "send_batch": Anonymize<Ic44opm4fbhp4r>;
    /**
     * Sends one page of initialization data to a subscriber.
     *
     * Authorized maintenance call submitted by the offchain worker.
     */
    "send_init_page": Anonymize<Ia7k5rk3a67fgt>;
    /**
     * Abandons a stuck batch that exceeded `StuckBatchTimeout`.
     * Subscribers that did not receive the batch can recover via `request_replay`.
     *
     * Authorized maintenance call submitted by the offchain worker when a batch has
     * been active longer than `StuckBatchTimeout`.
     */
    "abandon_stuck_batch": undefined;
}>;
export type Ic73rrpct6ckoa = {
    "subscriber_parachain_id": number;
    "members_collections": Anonymize<I94prpltebu6vs>;
    "pallet_index": number;
};
export type Ib1hmb261fe7mh = {
    "subscriber_parachain_id"?: Anonymize<I4arjljr6dpflb>;
};
export type I9jfggcqa8oi6c = {
    "subscriber_parachain_id": number;
    "identifier": SizedHex<32>;
    "ring_root_indices": Anonymize<Icgljjb6j82uhn>;
};
export type I437snu8jbuaj2 = {
    "send_page": number;
};
export type Ic44opm4fbhp4r = {
    "para_id": number;
    "sequence": bigint;
};
export type Ia7k5rk3a67fgt = {
    "para_id": number;
    "current_collection_index": number;
    "after_ring_index"?: Anonymize<I4arjljr6dpflb>;
};
export type I2tirna56agkbd = AnonymousEnum<{
    /**
     * Schedule a new airdrop event. Origin must be `ManagerOrigin`. The prize allocation is
     * held in the pallet's pot account. The pot is assumed to be pre-funded.
     *
     * Cross-pallet callers should use the [`crate::types::Airdrop::schedule`] trait method
     * instead, which debits a caller-supplied `source` account.
     */
    "schedule_event": Anonymize<Ie9gieran6hmh7>;
    /**
     * Remove a previously scheduled event. The event must not have already
     * started, otherwise this call will fail.
     */
    "remove_scheduled_event": Anonymize<Ib4o08d7u3o37d>;
    /**
     * Enable an asset for use in airdrop events. The origin must be `ManagerOrigin` only.
     *
     * Transfers the asset's current minimum balance from `source` to the pallet's pot so the
     * pot's asset account stays alive while events hold prize funds against it.
     */
    "enable_asset": Anonymize<I2l0pq1htsnh8g>;
    /**
     * Disable an asset previously enabled with `enable_asset`. Refunds the originally-funded
     * amount from the pot to `beneficiary`. The origin must be `ManagerOrigin` only.
     *
     * The manager is responsible for ensuring no events still reference this asset before
     * disabling, but this is safe since scheduling an event is permissioned.
     */
    "disable_asset": Anonymize<Icg4lihlimlj9s>;
    /**
     * OCW-driven: transition `Scheduled → Registering` when
     * `registration_starts` is reached.
     */
    "start_registration_authorized": Anonymize<Ib4o08d7u3o37d>;
    /**
     * OCW-driven: at `draw_time`:
     * - close registration
     * - capture randomness
     * - compute the target winner count
     * - release the unused-slot prize allocation up-front
     * - transition `Registering → DrawWinners`
     *
     * The draw itself is performed in batches by `draw_winners_authorized`.
     */
    "close_registration_authorized": Anonymize<Ib4o08d7u3o37d>;
    /**
     * OCW-driven: draw up to `DrawLimit` winners per call.
     *
     * After all the winners are drawn, the transition to `Claiming` is performed by the
     * separate `close_drawing_authorized`.
     */
    "draw_winners_authorized": Anonymize<Ib4o08d7u3o37d>;
    /**
     * OCW-driven: once `draw_winners_authorized` has filled the winner set, transition the
     * event from `DrawWinners` to `Claiming`.
     */
    "close_drawing_authorized": Anonymize<Ib4o08d7u3o37d>;
    /**
     * OCW-driven: at `end_time` close claiming and enter the first clean-up phase.
     */
    "close_claiming_authorized": Anonymize<Ib4o08d7u3o37d>;
    /**
     * OCW-driven: First step of clean-up is to clear up to `ClearLimit` entries from
     * `Registrations`. When the storage is fully drained, transitions to `ClearingWinners`.
     */
    "clean_up_registrations_authorized": Anonymize<Ib4o08d7u3o37d>;
    /**
     * OCW-driven: Second step of clean-up is to clear up to `ClearLimit` entries from
     * `Winners`. When the storage is fully drained, transitions to `Finalizing`.
     */
    "clean_up_winners_authorized": Anonymize<Ib4o08d7u3o37d>;
    /**
     * OCW-driven: Third step of clean-up is to release the unclaimed prize allocation and
     * remove the event.
     */
    "finalize_authorized": Anonymize<Ib4o08d7u3o37d>;
}>;
export type Ie9gieran6hmh7 = {
    "event_id": SizedHex<32>;
    "info": Anonymize<Iel17tf43q056o>;
};
export type I2l0pq1htsnh8g = {
    "asset_id": Anonymize<If9iqq7i64mur8>;
    "source": SS58String;
};
export type Icg4lihlimlj9s = {
    "asset_id": Anonymize<If9iqq7i64mur8>;
    "beneficiary": SS58String;
};
export type I3vm8qsehc5fdj = AnonymousEnum<{
    /**
     * Bestow a vote.
     *
     * Accepts only the [`Origin::Voter`] origin, which is created by verifying a ring proof
     * in the [`VoterAuth`](extension::VoterAuth) transaction extension.
     */
    "bestow": Anonymize<Ie5m07j5sdjl2g>;
}>;
export type Ie5m07j5sdjl2g = {
    "vote": {
        "subject": SizedHex<32>;
        "point": number;
        "direction": Anonymize<Ia31ehvm9n25pi>;
    };
    "call_valid_from": bigint;
};
export type I4oqb168b2d4er = AnonymousEnum<{
    /**
     * Allows root to set a cursor to forcefully start, stop or forward the migration process.
     *
     * Should normally not be needed and is only in place as emergency measure. Note that
     * restarting the migration process in this manner will not call the
     * [`MigrationStatusHandler::started`] hook or emit an `UpgradeStarted` event.
     */
    "force_set_cursor": Anonymize<Ibou4u1engb441>;
    /**
     * Allows root to set an active cursor to forcefully start/forward the migration process.
     *
     * This is an edge-case version of [`Self::force_set_cursor`] that allows to set the
     * `started_at` value to the next block number. Otherwise this would not be possible, since
     * `force_set_cursor` takes an absolute block number. Setting `started_at` to `None`
     * indicates that the current block number plus one should be used.
     */
    "force_set_active_cursor": Anonymize<Id6nbvqoqdj4o2>;
    /**
     * Forces the onboarding of the migrations.
     *
     * This process happens automatically on a runtime upgrade. It is in place as an emergency
     * measurement. The cursor needs to be `None` for this to succeed.
     */
    "force_onboard_mbms": undefined;
    /**
     * Clears the `Historic` set.
     *
     * `map_cursor` must be set to the last value that was returned by the
     * `HistoricCleared` event. The first time `None` can be used. `limit` must be chosen in a
     * way that will result in a sensible weight.
     */
    "clear_historic": Anonymize<I95iqep3b8snn9>;
}>;
export type Ibou4u1engb441 = {
    "cursor"?: (Anonymize<Iepbsvlk3qceij>) | undefined;
};
export type Id6nbvqoqdj4o2 = {
    "index": number;
    "inner_cursor"?: Anonymize<Iabpgqcjikia83>;
    "started_at"?: Anonymize<I4arjljr6dpflb>;
};
export type I95iqep3b8snn9 = {
    "selector": Enum<{
        "Specific": Anonymize<Itom7fk49o0c9>;
        "Wildcard": {
            "limit"?: Anonymize<I4arjljr6dpflb>;
            "previous_cursor"?: Anonymize<Iabpgqcjikia83>;
        };
    }>;
};
export type I6052turo9tavh = (Anonymize<I3qklfjubrljqh>) | undefined;
export type Iemk0s5gdc9ruv = (Anonymize<I78s05f59eoi8b>) | undefined;
export type Ierfo0k32c1e50 = AnonymousEnum<{
    "System": Anonymize<Iekve0i6djpd9f>;
    "ParachainSystem": Anonymize<I3u72uvpuo4qrt>;
    "Timestamp": Anonymize<I7d75gqfg6jh9c>;
    "ParachainInfo": undefined;
    "Balances": Anonymize<I9svldsp29mh87>;
    "OriginRestriction": Anonymize<I46ohf9ad4t2nj>;
    "Assets": Anonymize<Iu9seb88fh81e>;
    "AssetRate": Anonymize<I5lh6k2tq92l6m>;
    "CollatorSelection": Anonymize<I9dpq5287dur8b>;
    "Session": Anonymize<I77dda7hps0u37>;
    "XcmpQueue": Anonymize<Ib7tahn20bvsep>;
    "PolkadotXcm": Anonymize<I6k1inef986368>;
    "CumulusXcm": undefined;
    "MessageQueue": Anonymize<Ic2uoe7jdksosp>;
    "Utility": Anonymize<I18l7q9tni37e3>;
    "Multisig": Anonymize<I796mh2u66sf32>;
    "Sudo": Anonymize<I6ghfo82p64r0k>;
    "Proxy": Anonymize<I6jpmdjrl5du29>;
    "Identity": Anonymize<I2ig59mlqf9md7>;
    "People": Anonymize<I5a8s1jvri01ss>;
    "MobRule": Anonymize<Id7gcu75dd10kk>;
    "ProofOfInk": Anonymize<I9t98vnr0hbhog>;
    "Game": Anonymize<I3g84u7212cn6d>;
    "Score": Anonymize<I4h2fcgcv43u00>;
    "DummyDim": Anonymize<I3c4r0hatvif1e>;
    "PeopleLite": Anonymize<I6huceroqg8td3>;
    "Resources": Anonymize<I4n7unmaqs9i43>;
    "ChunksManager": Anonymize<I9sqknhnkp2m32>;
    "Members": Anonymize<Ierhmhea1o4d6a>;
    "Coinage": Anonymize<Ic5jkkq7dsbfh>;
    "MembersNotifier": Anonymize<I4fsg1b207pt46>;
    "Airdrop": Anonymize<I2tirna56agkbd>;
    "Honour": Anonymize<I3vm8qsehc5fdj>;
    "MultiBlockMigrations": Anonymize<I4oqb168b2d4er>;
}>;
export type Iavc33atjrmdmp = FixedSizeArray<2, Anonymize<I4arjljr6dpflb>>;
export type I596b7bbfu4tap = (Anonymize<I831tj5voub6u0>) | undefined;
export type Ia4n949ohqh8lm = (Anonymize<I6sjgjftjavcbd>) | undefined;
export type I9vodnt2k1kha = AnonymousEnum<{
    "Yes": undefined;
    "No": undefined;
    "Stuck": undefined;
}>;
export type I4ao1le27fcisl = ({
    "current_migration": number;
    "total_migrations": number;
    "current_migration_steps": number;
    "current_migration_max_steps"?: Anonymize<I4arjljr6dpflb>;
}) | undefined;
export type Ih4ursllob8fg = {
    "ongoing": Anonymize<I9vodnt2k1kha>;
    "progress"?: Anonymize<I4ao1le27fcisl>;
    "prefixes": Anonymize<Itom7fk49o0c9>;
};
export type Iaqet9jc3ihboe = {
    "header": Anonymize<Ic952bubvq4k7d>;
    "extrinsics": Anonymize<Itom7fk49o0c9>;
};
export type I2v50gu3s1aqk6 = AnonymousEnum<{
    "AllExtrinsics": undefined;
    "OnlyInherents": undefined;
}>;
export type I4gil44d08grh = {
    "prefix": SizedHex<16>;
    "suffix": SizedHex<16>;
};
export type I7u915mvkdsb08 = ResultPayload<Uint8Array, Enum<{
    "NotImplemented": undefined;
    "NotFound": Anonymize<I4gil44d08grh>;
    "Codec": undefined;
}>>;
export type I4s8jc79vpdfj8 = ResultPayload<Anonymize<I90kprdmdpdfpl>, Anonymize<I5nrjkj9qumobs>>;
export type I5nrjkj9qumobs = AnonymousEnum<{
    "Invalid": Enum<{
        "Call": undefined;
        "Payment": undefined;
        "Future": undefined;
        "Stale": undefined;
        "BadProof": undefined;
        "AncientBirthBlock": undefined;
        "ExhaustsResources": undefined;
        "Custom": number;
        "BadMandatory": undefined;
        "MandatoryValidation": undefined;
        "BadSigner": undefined;
        "IndeterminateImplicit": undefined;
        "UnknownOrigin": undefined;
    }>;
    "Unknown": TransactionValidityUnknownTransaction;
}>;
export type TransactionValidityUnknownTransaction = Enum<{
    "CannotLookup": undefined;
    "NoUnsignedValidator": undefined;
    "Custom": number;
}>;
export declare const TransactionValidityUnknownTransaction: GetEnum<TransactionValidityUnknownTransaction>;
export type If7uv525tdvv7a = Array<[SizedHex<8>, Uint8Array]>;
export type I2an1fs2eiebjp = {
    "okay": boolean;
    "fatal_error": boolean;
    "errors": Anonymize<If7uv525tdvv7a>;
};
export type TransactionValidityTransactionSource = Enum<{
    "InBlock": undefined;
    "Local": undefined;
    "External": undefined;
}>;
export declare const TransactionValidityTransactionSource: GetEnum<TransactionValidityTransactionSource>;
export type I9ask1o4tfvcvs = ResultPayload<{
    "priority": bigint;
    "requires": Anonymize<Itom7fk49o0c9>;
    "provides": Anonymize<Itom7fk49o0c9>;
    "longevity": bigint;
    "propagate": boolean;
}, Anonymize<I5nrjkj9qumobs>>;
export type I4ph3d1eepnmr1 = {
    "keys": Uint8Array;
    "proof": Uint8Array;
};
export type Icerf8h8pdu8ss = (Array<[Uint8Array, SizedHex<4>]>) | undefined;
export type I6spmpef2c7svf = {
    "weight": Anonymize<I4q39t5hn830vp>;
    "class": DispatchClass;
    "partial_fee": bigint;
};
export type Iei2mvq0mjvt81 = {
    "inclusion_fee"?: ({
        "base_fee": bigint;
        "len_fee": bigint;
        "adjusted_weight_fee": bigint;
    }) | undefined;
    "tip": bigint;
};
export type Iftvbctbo05fu4 = ResultPayload<Array<XcmVersionedAssetId>, Anonymize<Iavct6f844hfju>>;
export type Iavct6f844hfju = AnonymousEnum<{
    "Unimplemented": undefined;
    "VersionedConversionFailed": undefined;
    "WeightNotComputable": undefined;
    "UnhandledXcmVersion": undefined;
    "AssetNotFound": undefined;
    "Unroutable": undefined;
}>;
export type Ic0c3req3mlc1l = ResultPayload<Anonymize<I4q39t5hn830vp>, Anonymize<Iavct6f844hfju>>;
export type I7ocn4njqde3v5 = ResultPayload<bigint, Anonymize<Iavct6f844hfju>>;
export type Iek7ha36da9mf5 = ResultPayload<XcmVersionedAssets, Anonymize<Iavct6f844hfju>>;
export type I1nnit8gqdhb62 = ResultPayload<{
    "execution_result": ResultPayload<Anonymize<Ia1u1r3n74r13c>, {
        "post_info": Anonymize<Ia1u1r3n74r13c>;
        "error": Anonymize<I8rjgvnsb8ltnm>;
    }>;
    "emitted_events": Anonymize<I78i4b3onocmj3>;
    "local_xcm"?: Anonymize<Ieqgqma27vbupd>;
    "forwarded_xcms": Anonymize<Ialhmrpub9sefe>;
}, Anonymize<I55ku9c5gk50hb>>;
export type Ia1u1r3n74r13c = {
    "actual_weight"?: Anonymize<Iasb8k6ash5mjn>;
    "pays_fee": Anonymize<Iehg04bj71rkd>;
};
export type I78i4b3onocmj3 = Array<Anonymize<I25kugfe7g1o8d>>;
export type Ieqgqma27vbupd = (XcmVersionedXcm) | undefined;
export type Ialhmrpub9sefe = Array<[XcmVersionedLocation, Array<XcmVersionedXcm>]>;
export type I55ku9c5gk50hb = AnonymousEnum<{
    "Unimplemented": undefined;
    "VersionedConversionFailed": undefined;
}>;
export type I60k51mebtj8tr = ResultPayload<{
    "execution_result": Anonymize<Ieqhmksji3pmv5>;
    "emitted_events": Anonymize<I78i4b3onocmj3>;
    "forwarded_xcms": Anonymize<Ialhmrpub9sefe>;
}, Anonymize<I55ku9c5gk50hb>>;
export type Ieh6nis3hdbtgi = ResultPayload<SS58String, Enum<{
    "Unsupported": undefined;
    "VersionedConversionFailed": undefined;
}>>;
export type Ic1d4u2opv3fst = {
    "upward_messages": Anonymize<Itom7fk49o0c9>;
    "horizontal_messages": Anonymize<I6r5cbv8ttrb09>;
    "new_validation_code"?: Anonymize<Iabpgqcjikia83>;
    "processed_downward_messages": number;
    "hrmp_watermark": number;
    "head_data": Uint8Array;
};
export type Ie9sr1iqcg3cgm = ResultPayload<undefined, string>;
export type I1mqgk2tmnn9i2 = (string) | undefined;
export type I6lr8sctk0bi4e = Array<string>;
export type I40k710moo3ghm = (SizedHex<64>) | undefined;
export type Id3vovj0ihlrsb = AnonymousEnum<{
    "Disabled": undefined;
    "Signed": {
        "signature": Anonymize<I3fo6882e5tjh8>;
        "account": SS58String;
    };
}>;
export type I6i9m7o2et1j4d = (Enum<{
    "AsPersonalAliasWithAccount": number;
    "AsPersonalAliasWithProof": Anonymize<Ia8trlrbbq3bl2>;
    "AsPersonalIdentityWithProof": [SizedHex<64>, bigint];
    "AsPersonalIdentityWithAccount": number;
    "AsPersonalAliasWithAccountRevised": Anonymize<I2jn44n1jlkkra>;
}>) | undefined;
export type Ia8trlrbbq3bl2 = [Uint8Array, number, SizedHex<32>];
export type I2jn44n1jlkkra = [number, Uint8Array, number, SizedHex<32>];
export type I4rnuci7kia2r1 = (Enum<{
    "AsApplyWithSig": number;
    "AsReferred": number;
    "AsInvited": number;
}>) | undefined;
export type I6k0juar2doko8 = ({
    "nonce": number;
    "inviter": SS58String;
    "ticket": SS58String;
    "signature": Anonymize<I3fo6882e5tjh8>;
}) | undefined;
export type I9187oseptvbg4 = (Enum<{
    "AsLitePerson": number;
    "AsLiteAliasWithAccount": number;
    "AsLiteAliasWithProof": Anonymize<Ia8trlrbbq3bl2>;
    "AsLiteAliasWithAccountRevised": Anonymize<I2jn44n1jlkkra>;
}>) | undefined;
export type Id5fnv3e135pfi = (Enum<{
    "SelfInclude": SizedHex<64>;
}>) | undefined;
export type I7ohvr4mqgjtpu = (Enum<{
    "AsCoin": undefined;
    "AsUnloadTokenPeople": {
        "proof": {
            "proof": Uint8Array;
            "ring": number;
        };
        "period": number;
        "counter": number;
        "alias_proofs": Anonymize<Itom7fk49o0c9>;
    };
    "AsUnloadTokenLitePeople": {
        "proof": {
            "proof": Uint8Array;
            "ring": number;
        };
        "period": number;
        "counter": number;
        "alias_proofs": Anonymize<Itom7fk49o0c9>;
    };
    "AsUnloadTokenPaid": {
        "proof": Uint8Array;
        "period": number;
        "paid_token_ring_index": number;
        "paid_token_ring_revision": number;
        "alias_proofs": Anonymize<Itom7fk49o0c9>;
    };
    "AsUnloadTokenFromOutput": {
        "fee_recycler_value": number;
        "fee_recycler_index": number;
        "fee_recycler_revision": number;
        "alias_proofs": Anonymize<Itom7fk49o0c9>;
    };
    "InfallibleUnpaidSigned": {
        "nonce": number;
    };
}>) | undefined;
export type I1aakk85jiarum = (Enum<{
    "RegisterFriendRequestWithProof": [Uint8Array, number];
    "RegisterFriendRequestForCollection": [Uint8Array, number, Anonymize<I7fnmgdak2nuqf>];
    "RegisterStatementStoreAllowance": [Uint8Array, number, Anonymize<I7fnmgdak2nuqf>];
    "ClaimLongTermStorage": [Uint8Array, number, number, Anonymize<I7fnmgdak2nuqf>];
}>) | undefined;
export type Ie5q72utgevbaq = (Anonymize<I42om4bkmip9ue>) | undefined;
export type I6vh5ohr78d1s1 = Array<{
    "phase": Phase;
    "event": Anonymize<I6oc47t3oir0fd>;
    "topics": Anonymize<Ic5m5lp1oioo8r>;
}>;
export type I6oc47t3oir0fd = AnonymousEnum<{
    "System": Anonymize<I6f3d294lgs0ku>;
    "ParachainSystem": Anonymize<Icbsekf57miplo>;
    "Utility": Anonymize<I4bh9p3irtc2tm>;
    "MultiBlockMigrations": Anonymize<I94co7vj7h6bo>;
    "Balances": Anonymize<Ifhlvt8s3bh824>;
    "TransactionPayment": TransactionPaymentEvent;
    "SkipFeelessPayment": Anonymize<Iis17qun6haln>;
    "TransactionStorage": Anonymize<I2j0q5odvgtvje>;
    "CollatorSelection": Anonymize<I4srakrmf0fspo>;
    "Session": Anonymize<I6ue0ck5fc3u44>;
    "XcmpQueue": Anonymize<Idsqc7mhp6nnle>;
    "PolkadotXcm": Anonymize<If95hivmqmkiku>;
    "CumulusXcm": Anonymize<I5uv57c3fffoi9>;
    "MessageQueue": Anonymize<I2kosejppk3jon>;
    "Sudo": Anonymize<I7hnotuqeql4rs>;
}>;
export type I6f3d294lgs0ku = AnonymousEnum<{
    /**
     * An extrinsic completed successfully.
     */
    "ExtrinsicSuccess": Anonymize<Ia82mnkmeo2rhc>;
    /**
     * An extrinsic failed.
     */
    "ExtrinsicFailed": Anonymize<I7bu29lcnqc1kg>;
    /**
     * `:code` was updated to the code with the given hash.
     */
    "CodeUpdated": Anonymize<I1jm8m1rh9e20v>;
    /**
     * A new account was created.
     */
    "NewAccount": Anonymize<Icbccs0ug47ilf>;
    /**
     * An account was reaped.
     */
    "KilledAccount": Anonymize<Icbccs0ug47ilf>;
    /**
     * On on-chain remark happened.
     */
    "Remarked": Anonymize<I855j4i3kr8ko1>;
    /**
     * An upgrade was authorized.
     */
    "UpgradeAuthorized": Anonymize<Ibgl04rn6nbfm6>;
    /**
     * An invalid authorized upgrade was rejected while trying to apply it.
     */
    "RejectedInvalidAuthorizedUpgrade": Anonymize<I7hlcbrrjsf2el>;
}>;
export type I7bu29lcnqc1kg = {
    "dispatch_error": Anonymize<I58aq4p65oh77j>;
    "dispatch_info": Anonymize<Ic9s8f85vjtncc>;
};
export type I58aq4p65oh77j = AnonymousEnum<{
    "Other": undefined;
    "CannotLookup": undefined;
    "BadOrigin": undefined;
    "Module": Enum<{
        "System": Anonymize<I5o0s7c8q1cc9b>;
        "ParachainSystem": Anonymize<Icjkr35j4tmg7k>;
        "Timestamp": undefined;
        "ParachainInfo": undefined;
        "WeightReclaim": undefined;
        "Utility": Anonymize<I8dt2g2hcrgh36>;
        "MultiBlockMigrations": Anonymize<Iaaqq5jevtahm8>;
        "Balances": Anonymize<Idj13i7adlomht>;
        "TransactionPayment": undefined;
        "SkipFeelessPayment": undefined;
        "TransactionStorage": Anonymize<If627vvfni8f88>;
        "HopPromotion": undefined;
        "Authorship": undefined;
        "CollatorSelection": Anonymize<I36bcffk2387dv>;
        "Session": Anonymize<I1e07dgbaqd1sq>;
        "Aura": undefined;
        "AuraExt": undefined;
        "XcmpQueue": Anonymize<Idnnbndsjjeqqs>;
        "PolkadotXcm": Anonymize<I4vcvo9od6afmt>;
        "CumulusXcm": undefined;
        "MessageQueue": Anonymize<I5iupade5ag2dp>;
        "Sudo": Anonymize<Iaug04qjhbli00>;
    }>;
    "ConsumerRemaining": undefined;
    "NoProviders": undefined;
    "TooManyConsumers": undefined;
    "Token": TokenError;
    "Arithmetic": ArithmeticError;
    "Transactional": TransactionalError;
    "Exhausted": undefined;
    "Corruption": undefined;
    "Unavailable": undefined;
    "RootNotAllowed": undefined;
    "Trie": Anonymize<Idh4cj79bvroj8>;
}>;
export type If627vvfni8f88 = AnonymousEnum<{
    /**
     * Attempted to call `store`/`renew` outside of block execution.
     */
    "BadContext": undefined;
    /**
     * Data size is not in the allowed range.
     */
    "BadDataSize": undefined;
    /**
     * Too many transactions in the block.
     */
    "TooManyTransactions": undefined;
    /**
     * Invalid configuration.
     */
    "NotConfigured": undefined;
    /**
     * Renewed extrinsic is not found.
     */
    "RenewedNotFound": undefined;
    /**
     * Proof was not expected in this block.
     */
    "UnexpectedProof": undefined;
    /**
     * Proof failed verification.
     */
    "InvalidProof": undefined;
    /**
     * Missing storage proof.
     */
    "MissingProof": undefined;
    /**
     * Unable to verify proof because state data is missing.
     */
    "MissingStateData": undefined;
    /**
     * Double proof check in the block.
     */
    "DoubleCheck": undefined;
    /**
     * Storage proof was not checked in the block.
     */
    "ProofNotChecked": undefined;
    /**
     * Authorization was not found.
     */
    "AuthorizationNotFound": undefined;
    /**
     * Authorization has not expired.
     */
    "AuthorizationNotExpired": undefined;
    /**
     * Renew rejected: would push the signer's `bytes_permanent` past their
     * `bytes_allowance` (per-account hard cap).
     */
    "PermanentAllowanceExceeded": undefined;
    /**
     * Renew rejected: would push `PermanentStorageUsed` past
     * `MaxPermanentStorageSize` (chain-wide hard cap).
     */
    "ChainPermanentCapReached": undefined;
    /**
     * Content hash was not calculated.
     */
    "InvalidContentHash": undefined;
    /**
     * Auto-renewal is already enabled for this content hash.
     */
    "AutoRenewalAlreadyEnabled": undefined;
    /**
     * Auto-renewal is not enabled for this content hash.
     */
    "AutoRenewalNotEnabled": undefined;
    /**
     * Caller is not the owner of the auto-renewal registration.
     */
    "NotAutoRenewalOwner": undefined;
}>;
export type I7hlcbrrjsf2el = {
    "code_hash": SizedHex<32>;
    "error": Anonymize<I58aq4p65oh77j>;
};
export type I4bh9p3irtc2tm = AnonymousEnum<{
    /**
     * Batch of dispatches did not complete fully. Index of first failing dispatch given, as
     * well as the error.
     */
    "BatchInterrupted": Anonymize<If828pmc29p7an>;
    /**
     * Batch of dispatches completed fully with no error.
     */
    "BatchCompleted": undefined;
    /**
     * Batch of dispatches completed but has errors.
     */
    "BatchCompletedWithErrors": undefined;
    /**
     * A single item within a Batch of dispatches has completed with no error.
     */
    "ItemCompleted": undefined;
    /**
     * A single item within a Batch of dispatches has completed with error.
     */
    "ItemFailed": Anonymize<Icuacutkb8v2bc>;
    /**
     * A call was dispatched.
     */
    "DispatchedAs": Anonymize<I3upd9aipk4oj3>;
    /**
     * Main call was dispatched.
     */
    "IfElseMainSuccess": undefined;
    /**
     * The fallback call was dispatched.
     */
    "IfElseFallbackCalled": Anonymize<I698nk2haddt1>;
}>;
export type If828pmc29p7an = {
    "index": number;
    "error": Anonymize<I58aq4p65oh77j>;
};
export type Icuacutkb8v2bc = {
    "error": Anonymize<I58aq4p65oh77j>;
};
export type I3upd9aipk4oj3 = {
    "result": Anonymize<Iepv2htdbrq884>;
};
export type Iepv2htdbrq884 = ResultPayload<undefined, Anonymize<I58aq4p65oh77j>>;
export type I698nk2haddt1 = {
    "main_error": Anonymize<I58aq4p65oh77j>;
};
export type Ifhlvt8s3bh824 = AnonymousEnum<{
    /**
     * An account was created with some free balance.
     */
    "Endowed": Anonymize<Icv68aq8841478>;
    /**
     * An account was removed whose balance was non-zero but below ExistentialDeposit,
     * resulting in an outright loss.
     */
    "DustLost": Anonymize<Ic262ibdoec56a>;
    /**
     * Transfer succeeded.
     */
    "Transfer": Anonymize<Iflcfm9b6nlmdd>;
    /**
     * A balance was set by root.
     */
    "BalanceSet": Anonymize<Ijrsf4mnp3eka>;
    /**
     * Some balance was reserved (moved from free to reserved).
     */
    "Reserved": Anonymize<Id5fm4p8lj5qgi>;
    /**
     * Some balance was unreserved (moved from reserved to free).
     */
    "Unreserved": Anonymize<Id5fm4p8lj5qgi>;
    /**
     * Some balance was moved from the reserve of the first account to the second account.
     * Final argument indicates the destination balance type.
     */
    "ReserveRepatriated": Anonymize<I8tjvj9uq4b7hi>;
    /**
     * Some amount was deposited (e.g. for transaction fees).
     */
    "Deposit": Anonymize<Id5fm4p8lj5qgi>;
    /**
     * Some amount was withdrawn from the account (e.g. for transaction fees).
     */
    "Withdraw": Anonymize<Id5fm4p8lj5qgi>;
    /**
     * Some amount was removed from the account (e.g. for misbehavior).
     */
    "Slashed": Anonymize<Id5fm4p8lj5qgi>;
    /**
     * Some amount was minted into an account.
     */
    "Minted": Anonymize<Id5fm4p8lj5qgi>;
    /**
     * Some credit was balanced and added to the TotalIssuance.
     */
    "MintedCredit": Anonymize<I3qt1hgg4djhgb>;
    /**
     * Some amount was burned from an account.
     */
    "Burned": Anonymize<Id5fm4p8lj5qgi>;
    /**
     * Some debt has been dropped from the Total Issuance.
     */
    "BurnedDebt": Anonymize<I3qt1hgg4djhgb>;
    /**
     * Some amount was suspended from an account (it can be restored later).
     */
    "Suspended": Anonymize<Id5fm4p8lj5qgi>;
    /**
     * Some amount was restored into an account.
     */
    "Restored": Anonymize<Id5fm4p8lj5qgi>;
    /**
     * An account was upgraded.
     */
    "Upgraded": Anonymize<I4cbvqmqadhrea>;
    /**
     * Total issuance was increased by `amount`, creating a credit to be balanced.
     */
    "Issued": Anonymize<I3qt1hgg4djhgb>;
    /**
     * Total issuance was decreased by `amount`, creating a debt to be balanced.
     */
    "Rescinded": Anonymize<I3qt1hgg4djhgb>;
    /**
     * Some balance was locked.
     */
    "Locked": Anonymize<Id5fm4p8lj5qgi>;
    /**
     * Some balance was unlocked.
     */
    "Unlocked": Anonymize<Id5fm4p8lj5qgi>;
    /**
     * Some balance was frozen.
     */
    "Frozen": Anonymize<Id5fm4p8lj5qgi>;
    /**
     * Some balance was thawed.
     */
    "Thawed": Anonymize<Id5fm4p8lj5qgi>;
    /**
     * The `TotalIssuance` was forcefully changed.
     */
    "TotalIssuanceForced": Anonymize<I4fooe9dun9o0t>;
    /**
     * Some balance was placed on hold.
     */
    "Held": Anonymize<I8mvf14goplnni>;
    /**
     * Held balance was burned from an account.
     */
    "BurnedHeld": Anonymize<I8mvf14goplnni>;
    /**
     * A transfer of `amount` on hold from `source` to `dest` was initiated.
     */
    "TransferOnHold": Anonymize<Ie09mpthond7d6>;
    /**
     * The `transferred` balance is placed on hold at the `dest` account.
     */
    "TransferAndHold": Anonymize<I1ispultrc7caq>;
    /**
     * Some balance was released from hold.
     */
    "Released": Anonymize<I8mvf14goplnni>;
    /**
     * An unexpected/defensive event was triggered.
     */
    "Unexpected": Anonymize<Iph9c4rn81ub2>;
}>;
export type I8mvf14goplnni = {
    "reason": Anonymize<Ia44l7h6l7vcfa>;
    "who": SS58String;
    "amount": bigint;
};
export type Ia44l7h6l7vcfa = AnonymousEnum<{
    "TransactionStorage": Enum<{
        "StorageFeeHold": undefined;
    }>;
    "Session": Anonymize<I6bkr3dqv753nc>;
    "PolkadotXcm": Anonymize<Ideiof6273rsoe>;
}>;
export type Ie09mpthond7d6 = {
    "reason": Anonymize<Ia44l7h6l7vcfa>;
    "source": SS58String;
    "dest": SS58String;
    "amount": bigint;
};
export type I1ispultrc7caq = {
    "reason": Anonymize<Ia44l7h6l7vcfa>;
    "source": SS58String;
    "dest": SS58String;
    "transferred": bigint;
};
export type Iis17qun6haln = AnonymousEnum<{
    /**
     * A transaction fee was skipped.
     */
    "FeeSkipped": Anonymize<Ibi0s841005et5>;
}>;
export type Ibi0s841005et5 = {
    "origin": Anonymize<I9cqlcs1cfiqgk>;
};
export type I9cqlcs1cfiqgk = AnonymousEnum<{
    "system": Anonymize<I9gqitj4t615g3>;
    "TransactionStorage": Enum<{
        "Authorized": {
            "who": SS58String;
            "scope": Anonymize<Icd998p53cb80u>;
        };
    }>;
    "PolkadotXcm": Anonymize<Icvilmd7qu30i4>;
    "CumulusXcm": Anonymize<I3in0d0lb61qi8>;
}>;
export type Icd998p53cb80u = AnonymousEnum<{
    "Account": SS58String;
    "Preimage": SizedHex<32>;
}>;
export type I2j0q5odvgtvje = AnonymousEnum<{
    /**
     * Stored data under specified index.
     */
    "Stored": Anonymize<I395h9meqpi2hf>;
    /**
     * Renewed data under specified index.
     */
    "Renewed": Anonymize<I66jdpl6lile9j>;
    /**
     * Storage proof was successfully checked.
     */
    "ProofChecked": undefined;
    /**
     * An account `who` was authorized to store `bytes` bytes in `transactions` boost-tier
     * transactions.
     */
    "AccountAuthorized": Anonymize<I2i8iea6e4ne1j>;
    /**
     * An authorization for account `who` was refreshed.
     */
    "AccountAuthorizationRefreshed": Anonymize<I4cbvqmqadhrea>;
    /**
     * Authorization was given for a preimage of `content_hash` (not exceeding `max_size`) to
     * be stored by anyone.
     */
    "PreimageAuthorized": Anonymize<I4jotama61aldv>;
    /**
     * An authorization for a preimage of `content_hash` was refreshed.
     */
    "PreimageAuthorizationRefreshed": Anonymize<I3rfugj0vt1ug5>;
    /**
     * An expired account authorization was removed.
     */
    "ExpiredAccountAuthorizationRemoved": Anonymize<I4cbvqmqadhrea>;
    /**
     * An expired preimage authorization was removed.
     */
    "ExpiredPreimageAuthorizationRemoved": Anonymize<I3rfugj0vt1ug5>;
    /**
     * Auto-renewal was enabled for `content_hash` by `who`.
     */
    "AutoRenewalEnabled": Anonymize<I7qnibt85843h4>;
    /**
     * Auto-renewal was disabled for `content_hash` by `who`.
     */
    "AutoRenewalDisabled": Anonymize<I7qnibt85843h4>;
    /**
     * Data was automatically renewed at `index` with `content_hash` for `account`.
     */
    "DataAutoRenewed": Anonymize<Iecest14o0pmc2>;
    /**
     * Auto-renewal failed for `content_hash` (insufficient authorization for `account`).
     */
    "AutoRenewalFailed": Anonymize<I5i6clrj1m1v3f>;
    /**
     * `PermanentStorageUsed` changed (a `renew` bumped it, or the lazy drain
     * decremented it). Off-chain capacity-planning consumers can drive their dashboards
     * from these.
     */
    "PermanentStorageUsedUpdated": Anonymize<Ife9a8l1jn5dhf>;
    /**
     * `PermanentStorageUsed` just crossed the [`PERMANENT_STORAGE_NEAR_CAP_PERCENT`]
     * threshold of `MaxPermanentStorageSize` on the rising edge. Emitted once per
     * crossing — no re-emission while still above the threshold.
     */
    "PermanentStorageNearCap": Anonymize<I1srmrc4hmsm4>;
}>;
export type I395h9meqpi2hf = {
    "index": number;
    "content_hash": SizedHex<32>;
    "cid"?: Anonymize<Iabpgqcjikia83>;
};
export type I66jdpl6lile9j = {
    "index": number;
    "content_hash": SizedHex<32>;
};
export type I2i8iea6e4ne1j = {
    "who": SS58String;
    "transactions": number;
    "bytes": bigint;
};
export type I4jotama61aldv = {
    "content_hash": SizedHex<32>;
    "max_size": bigint;
};
export type I3rfugj0vt1ug5 = {
    "content_hash": SizedHex<32>;
};
export type I7qnibt85843h4 = {
    "content_hash": SizedHex<32>;
    "who": SS58String;
};
export type Iecest14o0pmc2 = {
    "index": number;
    "content_hash": SizedHex<32>;
    "account": SS58String;
};
export type I5i6clrj1m1v3f = {
    "content_hash": SizedHex<32>;
    "account": SS58String;
};
export type Ife9a8l1jn5dhf = {
    "used": bigint;
};
export type I1srmrc4hmsm4 = {
    "used": bigint;
    "cap": bigint;
};
export type I7hnotuqeql4rs = AnonymousEnum<{
    /**
     * A sudo call just took place.
     */
    "Sudid": Anonymize<I4lh45mbd1fv9m>;
    /**
     * The sudo key has been updated.
     */
    "KeyChanged": Anonymize<I5rtkmhm2dng4u>;
    /**
     * The key was permanently removed.
     */
    "KeyRemoved": undefined;
    /**
     * A [sudo_as](Pallet::sudo_as) call just took place.
     */
    "SudoAsDone": Anonymize<I4lh45mbd1fv9m>;
}>;
export type I4lh45mbd1fv9m = {
    /**
     * The result of the call made by the sudo user.
     */
    "sudo_result": Anonymize<Iepv2htdbrq884>;
};
export type Iafsev9pf8ur2h = Array<{
    "id": Anonymize<Ia44l7h6l7vcfa>;
    "amount": bigint;
}>;
export type I3krkfpbuclmak = {
    "extent": {
        "transactions": number;
        "transactions_allowance": number;
        "bytes": bigint;
        "bytes_permanent": bigint;
        "bytes_allowance": bigint;
    };
    "expiration": number;
};
export type Icbo88ruqlb3gb = Array<Anonymize<Id5dqph5l5iilr>>;
export type Id5dqph5l5iilr = {
    "chunk_root": SizedHex<32>;
    "content_hash": SizedHex<32>;
    "hashing": Anonymize<Ifmrgam3blcf8>;
    "cid_codec": bigint;
    "size": number;
    "extrinsic_index": number;
    "block_chunks": number;
    "kind": Enum<{
        "Store": undefined;
        "Renew": undefined;
    }>;
};
export type Ifmrgam3blcf8 = AnonymousEnum<{
    "Blake2b256": undefined;
    "Sha2_256": undefined;
    "Keccak256": undefined;
}>;
export type I7o7gvdusg24u1 = Array<[SizedHex<32>, Anonymize<Id5dqph5l5iilr>, SS58String]>;
export type Ibkm2gcn4pji30 = {
    "aliasers": Anonymize<I41j3fc5ema929>;
    "ticket": bigint;
};
export type I84jispv4252c1 = AnonymousEnum<{
    /**
     * Send a batch of dispatch calls.
     *
     * May be called from any origin except `None`.
     *
     * - `calls`: The calls to be dispatched from the same origin. The number of call must not
     * exceed the constant: `batched_calls_limit` (available in constant metadata).
     *
     * If origin is root then the calls are dispatched without checking origin filter. (This
     * includes bypassing `frame_system::Config::BaseCallFilter`).
     *
     * ## Complexity
     * - O(C) where C is the number of calls to be batched.
     *
     * This will return `Ok` in all circumstances. To determine the success of the batch, an
     * event is deposited. If a call failed and the batch was interrupted, then the
     * `BatchInterrupted` event is deposited, along with the number of successful calls made
     * and the error of the failed call. If all were successful, then the `BatchCompleted`
     * event is deposited.
     */
    "batch": Anonymize<Ieoqtn5q7m1dsn>;
    /**
     * Send a call through an indexed pseudonym of the sender.
     *
     * Filter from origin are passed along. The call will be dispatched with an origin which
     * use the same filter as the origin of this call.
     *
     * NOTE: If you need to ensure that any account-based filtering is not honored (i.e.
     * because you expect `proxy` to have been used prior in the call stack and you do not want
     * the call restrictions to apply to any sub-accounts), then use `as_multi_threshold_1`
     * in the Multisig pallet instead.
     *
     * NOTE: Prior to version *12, this was called `as_limited_sub`.
     *
     * The dispatch origin for this call must be _Signed_.
     */
    "as_derivative": Anonymize<I3uqfo6hpq6oo4>;
    /**
     * Send a batch of dispatch calls and atomically execute them.
     * The whole transaction will rollback and fail if any of the calls failed.
     *
     * May be called from any origin except `None`.
     *
     * - `calls`: The calls to be dispatched from the same origin. The number of call must not
     * exceed the constant: `batched_calls_limit` (available in constant metadata).
     *
     * If origin is root then the calls are dispatched without checking origin filter. (This
     * includes bypassing `frame_system::Config::BaseCallFilter`).
     *
     * ## Complexity
     * - O(C) where C is the number of calls to be batched.
     */
    "batch_all": Anonymize<Ieoqtn5q7m1dsn>;
    /**
     * Dispatches a function call with a provided origin.
     *
     * The dispatch origin for this call must be _Root_.
     *
     * ## Complexity
     * - O(1).
     */
    "dispatch_as": Anonymize<Icq9uslhchvi9t>;
    /**
     * Send a batch of dispatch calls.
     * Unlike `batch`, it allows errors and won't interrupt.
     *
     * May be called from any origin except `None`.
     *
     * - `calls`: The calls to be dispatched from the same origin. The number of call must not
     * exceed the constant: `batched_calls_limit` (available in constant metadata).
     *
     * If origin is root then the calls are dispatch without checking origin filter. (This
     * includes bypassing `frame_system::Config::BaseCallFilter`).
     *
     * ## Complexity
     * - O(C) where C is the number of calls to be batched.
     */
    "force_batch": Anonymize<Ieoqtn5q7m1dsn>;
    /**
     * Dispatch a function call with a specified weight.
     *
     * This function does not check the weight of the call, and instead allows the
     * Root origin to specify the weight of the call.
     *
     * The dispatch origin for this call must be _Root_.
     */
    "with_weight": Anonymize<I86aivagrjfrue>;
    /**
     * Dispatch a fallback call in the event the main call fails to execute.
     * May be called from any origin except `None`.
     *
     * This function first attempts to dispatch the `main` call.
     * If the `main` call fails, the `fallback` is attemted.
     * if the fallback is successfully dispatched, the weights of both calls
     * are accumulated and an event containing the main call error is deposited.
     *
     * In the event of a fallback failure the whole call fails
     * with the weights returned.
     *
     * - `main`: The main call to be dispatched. This is the primary action to execute.
     * - `fallback`: The fallback call to be dispatched in case the `main` call fails.
     *
     * ## Dispatch Logic
     * - If the origin is `root`, both the main and fallback calls are executed without
     * applying any origin filters.
     * - If the origin is not `root`, the origin filter is applied to both the `main` and
     * `fallback` calls.
     *
     * ## Use Case
     * - Some use cases might involve submitting a `batch` type call in either main, fallback
     * or both.
     */
    "if_else": Anonymize<I80uep6d32haq8>;
    /**
     * Dispatches a function call with a provided origin.
     *
     * Almost the same as [`Pallet::dispatch_as`] but forwards any error of the inner call.
     *
     * The dispatch origin for this call must be _Root_.
     */
    "dispatch_as_fallible": Anonymize<Icq9uslhchvi9t>;
}>;
export type Ieoqtn5q7m1dsn = {
    "calls": Array<TxCallData>;
};
export type I3uqfo6hpq6oo4 = {
    "index": number;
    "call": TxCallData;
};
export type Icq9uslhchvi9t = {
    "as_origin": Anonymize<I9cqlcs1cfiqgk>;
    "call": TxCallData;
};
export type I86aivagrjfrue = {
    "call": TxCallData;
    "weight": Anonymize<I4q39t5hn830vp>;
};
export type I80uep6d32haq8 = {
    "main": TxCallData;
    "fallback": TxCallData;
};
export type I91qvjhp0slc1b = AnonymousEnum<{
    /**
     * Index and store data off chain. Minimum data size is 1 byte, maximum is
     * `MaxTransactionSize`. Data will be removed after `RetentionPeriod` blocks, unless
     * `renew` is called.
     *
     * Authorization is required to store data using regular signed/unsigned transactions.
     * Regular signed transactions require account authorization (see
     * [`authorize_account`](Self::authorize_account)), regular unsigned transactions require
     * preimage authorization (see [`authorize_preimage`](Self::authorize_preimage)).
     *
     * Emits [`Stored`](Event::Stored) when successful.
     *
     * ## Complexity
     *
     * O(n*log(n)) of data size, as all data is pushed to an in-memory trie.
     */
    "store": Anonymize<Itrlf5b2o2l8q>;
    /**
     * Index and store data off chain with an explicit CID configuration.
     *
     * Behaves identically to [`store`](Self::store), but the CID configuration
     * (codec and hashing algorithm) is passed directly as a parameter.
     *
     * Emits [`Stored`](Event::Stored) when successful.
     */
    "store_with_cid_config": Anonymize<Icegg8a2cqf1gu>;
    /**
     * Renew previously stored data. Parameters are the block number that contains previous
     * `store` or `renew` call and transaction index within that block. Transaction index is
     * emitted in the `Stored` or `Renewed` event.
     *
     * As with [`store`](Self::store), authorization is required to renew data using regular
     * signed/unsigned transactions.
     *
     * Emits [`Renewed`](Event::Renewed) when successful.
     *
     * ## Complexity
     *
     * O(1).
     */
    "renew": Anonymize<I4vj3ndsquheo1>;
    /**
     * Authorize an account to store up to `bytes` of arbitrary data in `transactions`
     * boost-tier transactions. The authorization will expire after a configured number
     * of blocks.
     *
     * If the account already has an unexpired authorization, this call **adds** `bytes`
     * and `transactions` to the existing `bytes_allowance` and `transactions_allowance`
     * caps (both saturating); the expiration block is **not** pushed back, and the
     * consumed counters are preserved. Once the authorization has expired, the next call
     * replaces it with a fresh entry (consumed counters reset to `0`, allowances set to
     * the new values, expiry = `now + AuthorizationPeriod`).
     *
     * Parameters:
     *
     * - `who`: The account to be credited with an authorization to store data.
     * - `transactions`: The number of boost-tier transactions that `who` may submit.
     * - `bytes`: The number of bytes that `who` may submit.
     *
     * The origin for this call must be the pallet's `Authorizer`. Emits
     * [`AccountAuthorized`](Event::AccountAuthorized) when successful.
     */
    "authorize_account": Anonymize<I2i8iea6e4ne1j>;
    /**
     * Authorize anyone to store a preimage of the given content hash. The authorization will
     * expire after a configured number of blocks.
     *
     * If authorization already exists for a preimage of the given hash to be stored, the
     * maximum size of the preimage will be increased to `max_size`. The expiration block
     * is **not** pushed back; use
     * [`refresh_preimage_authorization`](Self::refresh_preimage_authorization) to extend
     * expiry.
     *
     * Parameters:
     *
     * - `content_hash`: The hash of the data to be submitted. For [`store`](Self::store) this
     * is the BLAKE2b-256 hash; for [`store_with_cid_config`](Self::store_with_cid_config)
     * this is the hash produced by the CID config's hashing algorithm.
     * - `max_size`: The maximum size, in bytes, of the preimage.
     *
     * The origin for this call must be the pallet's `Authorizer`. Emits
     * [`PreimageAuthorized`](Event::PreimageAuthorized) when successful.
     */
    "authorize_preimage": Anonymize<I4jotama61aldv>;
    /**
     * Remove an expired account authorization from storage. Anyone can call this.
     *
     * Parameters:
     *
     * - `who`: The account with an expired authorization to remove.
     *
     * Emits [`ExpiredAccountAuthorizationRemoved`](Event::ExpiredAccountAuthorizationRemoved)
     * when successful.
     */
    "remove_expired_account_authorization": Anonymize<I4cbvqmqadhrea>;
    /**
     * Remove an expired preimage authorization from storage. Anyone can call this.
     *
     * Parameters:
     *
     * - `content_hash`: The BLAKE2b hash that was authorized.
     *
     * Emits
     * [`ExpiredPreimageAuthorizationRemoved`](Event::ExpiredPreimageAuthorizationRemoved)
     * when successful.
     */
    "remove_expired_preimage_authorization": Anonymize<I3rfugj0vt1ug5>;
    /**
     * Refresh the expiration of an existing authorization for an account.
     *
     * Only the expiration block is updated — consumed counters (`bytes`,
     * `transactions`) and the granted caps (`bytes_allowance`,
     * `transactions_allowance`) are left untouched. To extend the caps, call
     * `authorize_account` instead (additive on the unexpired path).
     *
     * If the account does not have an authorization, the call will fail.
     *
     * Parameters:
     *
     * - `who`: The account to be credited with an authorization to store data.
     *
     * The origin for this call must be the pallet's `Authorizer`. Emits
     * [`AccountAuthorizationRefreshed`](Event::AccountAuthorizationRefreshed) when successful.
     */
    "refresh_account_authorization": Anonymize<I4cbvqmqadhrea>;
    /**
     * Refresh the expiration of an existing authorization for a preimage of a BLAKE2b hash.
     *
     * Only the expiration block is updated — consumed counters (`bytes`,
     * `transactions`) and the granted caps (`bytes_allowance`,
     * `transactions_allowance`) are left untouched. To raise the cap, call
     * `authorize_preimage` instead.
     *
     * If the preimage does not have an authorization, the call will fail.
     *
     * Parameters:
     *
     * - `content_hash`: The BLAKE2b hash of the data to be submitted.
     *
     * The origin for this call must be the pallet's `Authorizer`. Emits
     * [`PreimageAuthorizationRefreshed`](Event::PreimageAuthorizationRefreshed) when
     * successful.
     */
    "refresh_preimage_authorization": Anonymize<I3rfugj0vt1ug5>;
    /**
     * Renew previously stored data by content hash. The content hash is the BLAKE2b hash
     * of the original data, as emitted in the [`Stored`](Event::Stored) or
     * [`Renewed`](Event::Renewed) event.
     *
     * This is a convenience alternative to [`renew`](Self::renew) that does not require
     * knowing the exact `(block_number, tx_index)` pair.
     *
     * Emits [`Renewed`](Event::Renewed) when successful.
     */
    "renew_content_hash": Anonymize<I3rfugj0vt1ug5>;
    /**
     * Enable automatic renewal for a previously stored piece of data.
     *
     * `who` must have sufficient account authorization (transactions > 0 and bytes >=
     * data size). The authorization is **not** consumed here; it is consumed each time
     * the data is auto-renewed (every `StoragePeriod` blocks).
     * Authorization is checked here but might still be missing when actually renewed.
     *
     * Emits [`AutoRenewalEnabled`](Event::AutoRenewalEnabled) when successful.
     */
    "enable_auto_renew": Anonymize<I3rfugj0vt1ug5>;
    /**
     * Disable automatic renewal for a piece of data.
     *
     * Can only be called by the account that originally enabled auto-renewal.
     *
     * Emits [`AutoRenewalDisabled`](Event::AutoRenewalDisabled) when successful.
     */
    "disable_auto_renew": Anonymize<I3rfugj0vt1ug5>;
    /**
     * Composite block-level inherent: optionally validates a transaction storage proof and
     * always drains [`PendingAutoRenewals`].
     *
     * `ProvideInherent::create_inherent` only returns a single `Call`, but this pallet
     * has two block-end concerns — verifying the storage proof for the block at
     * `n - RetentionPeriod`, and renewing entries flagged via [`AutoRenewals`] before
     * they expire at `n - RetentionPeriod - 1`. Both effects collapse into this single
     * mandatory inherent so that block authors emit one extrinsic that satisfies both
     * `on_finalize` invariants (`ProofChecked` and "PendingAutoRenewals empty").
     *
     * `proof` is `Some` when the inherent data provider supplied one; otherwise the
     * proof step is skipped (early or empty blocks). The auto-renewal drain runs
     * unconditionally — emitting an inherent at all implies that `on_initialize` may
     * have populated `PendingAutoRenewals`.
     */
    "apply_block_inherents": Anonymize<Ifq8h9n7vmgpf0>;
}>;
export type Itrlf5b2o2l8q = {
    "data": Uint8Array;
};
export type Icegg8a2cqf1gu = {
    "cid": {
        "codec": bigint;
        "hashing": Anonymize<Ifmrgam3blcf8>;
    };
    "data": Uint8Array;
};
export type I4vj3ndsquheo1 = {
    "block": number;
    "index": number;
};
export type Ifq8h9n7vmgpf0 = {
    "proof"?: ({
        "chunk": Uint8Array;
        "proof": Anonymize<Itom7fk49o0c9>;
    }) | undefined;
};
export type I1vfnh83561alb = AnonymousEnum<{
    "promote": Anonymize<Ic4jjdr1cl5bit>;
}>;
export type Ic4jjdr1cl5bit = {
    "data": Uint8Array;
    "signer": Anonymize<I8p068g003vpi6>;
    "signature": Anonymize<I3fo6882e5tjh8>;
    "submit_timestamp": bigint;
};
export type I8p068g003vpi6 = AnonymousEnum<{
    "Ed25519": SizedHex<32>;
    "Sr25519": SizedHex<32>;
    "Ecdsa": SizedHex<33>;
    "Eth": SizedHex<33>;
}>;
export type Ienf5jj7enuegm = AnonymousEnum<{
    /**
     * Authenticates the sudo key and dispatches a function call with `Root` origin.
     */
    "sudo": Anonymize<I3bcssdogmde0a>;
    /**
     * Authenticates the sudo key and dispatches a function call with `Root` origin.
     * This function does not check the weight of the call, and instead allows the
     * Sudo user to specify the weight of the call.
     *
     * The dispatch origin for this call must be _Signed_.
     */
    "sudo_unchecked_weight": Anonymize<I86aivagrjfrue>;
    /**
     * Authenticates the current sudo key and sets the given AccountId (`new`) as the new sudo
     * key.
     */
    "set_key": Anonymize<I8k3rnvpeeh4hv>;
    /**
     * Authenticates the sudo key and dispatches a function call with `Signed` origin from
     * a given account.
     *
     * The dispatch origin for this call must be _Signed_.
     */
    "sudo_as": Anonymize<I9slmjh52bfesg>;
    /**
     * Permanently removes the sudo key.
     *
     * **This cannot be un-done.**
     */
    "remove_key": undefined;
}>;
export type I3bcssdogmde0a = {
    "call": TxCallData;
};
export type I9slmjh52bfesg = {
    "who": MultiAddress;
    "call": TxCallData;
};
export type I5phvbjmrl3q15 = ResultPayload<Anonymize<Iepv2htdbrq884>, Anonymize<I5nrjkj9qumobs>>;
export type I4vbdpme2q1uc7 = AnonymousEnum<{
    "System": Anonymize<Iekve0i6djpd9f>;
    "ParachainSystem": Anonymize<I3u72uvpuo4qrt>;
    "Timestamp": Anonymize<I7d75gqfg6jh9c>;
    "ParachainInfo": undefined;
    "Utility": Anonymize<I84jispv4252c1>;
    "MultiBlockMigrations": Anonymize<I4oqb168b2d4er>;
    "Balances": Anonymize<I9svldsp29mh87>;
    "TransactionStorage": Anonymize<I91qvjhp0slc1b>;
    "HopPromotion": Anonymize<I1vfnh83561alb>;
    "CollatorSelection": Anonymize<I9dpq5287dur8b>;
    "Session": Anonymize<I77dda7hps0u37>;
    "XcmpQueue": Anonymize<Ib7tahn20bvsep>;
    "PolkadotXcm": Anonymize<I6k1inef986368>;
    "CumulusXcm": undefined;
    "MessageQueue": Anonymize<Ic2uoe7jdksosp>;
    "Sudo": Anonymize<Ienf5jj7enuegm>;
}>;
export type I1f7f3k83kkuph = ResultPayload<{
    "execution_result": ResultPayload<Anonymize<Ia1u1r3n74r13c>, {
        "post_info": Anonymize<Ia1u1r3n74r13c>;
        "error": Anonymize<I58aq4p65oh77j>;
    }>;
    "emitted_events": Anonymize<Ifa1penavnu52u>;
    "local_xcm"?: Anonymize<Ieqgqma27vbupd>;
    "forwarded_xcms": Anonymize<Ialhmrpub9sefe>;
}, Anonymize<I55ku9c5gk50hb>>;
export type Ifa1penavnu52u = Array<Anonymize<I6oc47t3oir0fd>>;
export type I3drm5svtsk62r = ResultPayload<{
    "execution_result": Anonymize<Ieqhmksji3pmv5>;
    "emitted_events": Anonymize<Ifa1penavnu52u>;
    "forwarded_xcms": Anonymize<Ialhmrpub9sefe>;
}, Anonymize<I55ku9c5gk50hb>>;
export type XcmVersionedAsset = Enum<{
    "V3": Anonymize<Idcm24504c8bkk>;
    "V4": Anonymize<Ia5l7mu5a6v49o>;
    "V5": Anonymize<Iffh1nc5e1mod6>;
}>;
export declare const XcmVersionedAsset: GetEnum<XcmVersionedAsset>;
export type Icujp6hmv35vbn = ResultPayload<boolean, Enum<{
    "VersionedAssetConversionFailed": undefined;
    "VersionedLocationConversionFailed": undefined;
}>>;
export type I4tjame31218k9 = ResultPayload<Anonymize<I41j3fc5ema929>, Anonymize<Iecgqth5sdfqqi>>;
export type Iecgqth5sdfqqi = AnonymousEnum<{
    "LocationVersionConversionFailed": undefined;
}>;
export type I5gif8vomct5i8 = ResultPayload<boolean, Anonymize<Iecgqth5sdfqqi>>;
export type If4oj302humfb5 = Array<{
    "content_hash": SizedHex<32>;
    "size": number;
    "hashing": Anonymize<Ifmrgam3blcf8>;
    "cid_codec": bigint;
    "extrinsic_index": number;
}>;
export {};
