# Research: a `local` profile on a chopsticks fork of the People chain

Date: 2026-09-05. Read-only research. No repository change except this file.
Probe scripts and raw outputs are in the session scratchpad
(`fork-e2e-devnet.mjs`, `fork-register-with-fee-paseo.mjs`,
`fork-coin-sweep-paseo.mjs`, `devnet-people.txt`, `paseo-people.txt`,
`devnet-types.txt`, `paseo-types.txt`, `chop-*.log`).

Goal restated: keep the sandbox's mock statement store, replace the mock
directory (`sandbox/lib/directory.mjs`) with a chopsticks fork of the real
People chain, so real pallets settle statement-store allowances (`Resources`),
usernames, and Coinage payments.

## 1. Chain and runtime

Endpoints from `bot-core/lib/network-config.mjs`. Values fetched over RPC on
2026-09-05 with a `ws` + `state_getRuntimeVersion` / `chain_getBlockHash 0` /
`state_getMetadata` script (`scratchpad/chaininfo.mjs`).

| profile | endpoint | `system_chain` | specName / specVersion | txVersion | genesis | head |
|---|---|---|---|---|---|---|
| devnet | `wss://people-paseo.rotko.net` | Paseo People | `people-paseo` / 2004003 | 1 | `0xe6c30d6e148f250b887105237bcaa5cb9f16dd203bf7b5b9d4f1da7387cb86ec` | 6,495,490 |
| paseo | `wss://paseo-people-next-system-rpc.polkadot.io` | Paseo People Next | `next-people-paseo` / 3002000 | 5 | `0x4a2b5b737de1da59e209b0000a876ec2fa20035dc34fd292a848da32d255ad48` | 165,317 |

Findings:

- The devnet genesis matches `bot-core/.papi/polkadot-api.json`
  (`productsDevnetPeople`). The paseo genesis does **not**: the committed
  descriptor pins `0xc5af1826…`, the live chain is `0x4a2b5b73…`. Paseo Next was
  reset since the descriptors were generated. `bot-core` reads only
  `Resources.Consumers` and `Resources.UsernameOwnerOf` there, which still
  decode, but the descriptors are stale.
- Both chains expose metadata v14/v15/v16 (`Metadata_metadata_versions` =
  `[14, 15, 16]`). Extrinsic format version is 4 for both.
- Devnet pallets (index): System(0) … Balances(10), TransactionPayment(11),
  Assets(12), AssetTxPayment(14), OriginRestriction(17), Utility(40),
  Multisig(41), Proxy(42), VerifySignature(43), Identity(50), People(51),
  MobRule(52), ProofOfInk(53), Game(55), Score(56), DummyDim(59),
  StorageInitialization(60), **PeopleLite(62)**, **Resources(63)**,
  ChunksManager(64), Members(67), **Coinage(68)**, MembersNotifier(69),
  Airdrop(70), Honour(71), **Sudo(255)**.
- Paseo Next pallets: same families plus Parameters(73), NetworkSuffix(74),
  AssetConversion(18), PoolAssets(19), NftCredits(57), PeopleAirdrops(72),
  MultiBlockMigrations(98); **Sudo is at index 42**. Sudo keys:
  devnet `0x808cd360…6e0b`, paseo `0x98dfe27e…5e27` (not ours, but
  `dev_setStorage` replaces them).
- Signed extensions (devnet order): AuthorizeValueTransfer,
  VerifyMultiSignature, AsPerson, AsProofOfInkParticipant, ScoreAsParticipant,
  GameAsInvited, PeopleLiteAuth, AsMember, AsCoinage, **AsResources**,
  HonourAuth, AuthorizeCall, RestrictOrigins, CheckNonZeroSender,
  CheckSpecVersion, CheckTxVersion, CheckGenesis, CheckMortality, CheckNonce,
  CheckWeight, ChargeAssetTxPayment, CheckMetadataHash, StorageWeightReclaim.
  Paseo Next: `UnitTransactionExtension` instead of AuthorizeValueTransfer,
  and no CheckMetadataHash.
- No `ValidateStatement` runtime API exists on either chain (v15 `apis` list
  has none). The statement-store node reads allowances from plain chain
  storage instead (see below).

### The pallets we need

`Resources` (63), identical on both chains for our purpose:

- `Consumers: AccountId32 -> ConsumerInfo { identifier_key: [u8;65], full_username: Option<BoundedVec<u8>>, lite_username: BoundedVec<u8>, credibility: Lite | Person{alias, last_update, demoted} }` (Blake2_128Concat). This is what `bot-core/lib/people-directory.mjs` reads.
- `UsernameOwnerOf: BoundedVec<u8> -> AccountId32` (Blake2_128Concat).
- `StatementStoreAllowances: (BigEndianU32 period, [u8;32] alias) -> StmtStoreAllowanceEntry { account_id, seq: u32, since: u64 }` (hashers Identity, Blake2_128Concat).
- `StmtStoreAllowanceByAccount: (AccountId32, (period, seq u32, alias)) -> ()`.
- Calls: `register_lite_person(identifier_key, username, reserved_username)`
  (origin must pass `EnsureLitePerson`), `set_statement_store_account(period,
  seq, target_account)` (origin must be `Origin::StmtStoreAlias(alias)`, which
  only the `AsResources` extension produces from a ring proof),
  `update_identifier_key`, `claim_long_term_storage`, …
- Constants (devnet): `AccountsApiAllowance = {max_count: 2, max_size: 512000}`,
  `StmtStoreSlotsPerPeriod = 20`, `LiteStmtStoreSlotsPerPeriod = 10`,
  `StmtStoreReplacementCooldown = 60`, `MinUsernameLength = 6`.
  Runtime parameters (`individuality-community/runtimes/next-people-paseo/src/parameters.rs`):
  `LitePersonStatementLimit = {50, 512000}`, `PersonStatementLimit = {200, 1 MiB}`.

`PeopleLite` (62):

- `LitePeople: AccountId32 -> LitePersonInfo { ring_vrf_key: [u8;32], method: UniqueDevice(attester) | Fee }`, `AttestationAllowance: AccountId32 -> u32`.
- Calls: `increase_attestation_allowance(account, count)` (origin
  `AttestationAllowanceManager = EnsureRoot`), `attest(candidate,
  candidate_signature, ring_vrf_key, proof_of_ownership,
  consumer_registration: Option<LiteConsumerRegistrationParams>)` (any signed
  account with attestation allowance = "the attester"), and on **Paseo Next
  only** `register_with_fee(ring_vrf_key, proof_of_ownership,
  consumer_registration)` (the candidate registers itself for
  `RegistrationFee = 75 PAS`, no attester).

`Coinage` (68), the pallet behind private payments (there is no `pps` pallet;
`//pps//…` is only the derivation namespace in the apps):

- `CoinsByOwner: AccountId32 -> Coin { value: i8 (exponent), age: u16 }`
  (Twox64Concat). On live Paseo Next the struct is already
  `{ instance_id, value, age }` (the public source at spec 3000000 lags the
  live 3002000).
- `LockedCoins: AccountId32 -> LockedCoin { reason: FailedDispatch{retries}, until }`, recycler rings (`RecyclersUnloaded`, `RecyclersCoinToRecycler`, …), `UnderlyingAssetId: Location`, `UnderlyingAssetUnit = 10_000` (devnet).
- Calls: `transfer(to)`, `split(split_into)`, `load_recycler_with_coin`,
  `load_recycler_with_external_asset[_unpaid[_batch]]`,
  `unload_recycler_into_coins(aliases, value, index, revision, split_into, max_fee)`, …
- Origin: the `AsCoinage` extension, `Option<AsCoinageInfo>` =
  `AsCoin(0) | AsUnloadTokenPeople(1) | AsUnloadTokenLitePeople(2) | AsUnloadTokenPaid(3) | AsUnloadTokenFromOutput(4) | InfallibleUnpaidSigned(5){nonce}`.

Bulletin: `bot-core` touches only `TransactionStorage.Authorizations` and
`TransactionStorage.{authorize_account, refresh_account_authorization}` on
the *Bulletin* chains (`bot-core/lib/testnet-file-allowance.mjs`, signed with
the public `//Eve` faucet key). Nothing on the People chain. Out of scope for
a `local` profile until HOP (v1.5).

### Where statement-store allowances really live

`polkadot-sdk` (`99c8ed2a2fea`, 2026-07-30),
`substrate/primitives/statement-store/src/lib.rs:180-215`:

```rust
pub const STATEMENT_ALLOWANCE_PREFIX: &[u8] = b":statement_allowance:";
pub fn statement_allowance_key(account_id) -> Vec<u8> { PREFIX ++ account_id }
pub fn increase_allowance_by(account_id, by: StatementAllowance) { unhashed::put(&key, allowance + by) }
```

The value is SCALE `StatementAllowance { max_count: u32, max_size: u32 }`.
The node (`substrate/client/statement-store/src/lib.rs:423`, `read_allowance`)
reads that raw key at best/finalized block. The `Resources` pallet calls
`increase_allowance_by` on `register_lite_consumer_inner` (with
`LitePersonStatementLimit`) and on `set_statement_store_account` (with
`AccountsApiAllowance`) (`individuality-community/pallets/resources/src/lib.rs:994,1732`).

Live confirmation on devnet: `state_getStorage(0x3a73746174656d656e745f616c6c6f77616e63653a ++ 68ebf425…)`
(a `set_statement_store_account` target found in `StatementStoreAllowances`)
returned `0x0400000000a00f00` = `{max_count: 4, max_size: 1_024_000}`, two
device slots. So an allowance is **plain raw chain storage**, readable with
`state_getStorage`, and plantable with `dev_setStorage`. The mock store can
answer "does this signer have an allowance?" by reading that one key on the
fork. Without a fork the sandbox keeps its in-memory `allowances` Set
(`sandbox/lib/store-node.mjs:232`).

## 2. Chopsticks

`@acala-network/chopsticks@latest` = 1.5.1 (`npx -y … --version`, cold
install 21 s, warm start 3–4 s from launch to `RPC listening`).

Commands run (background, logs in scratchpad):

```
npx -y @acala-network/chopsticks@latest --endpoint wss://people-paseo.rotko.net --port 8010 [--allow-unresolved-imports] [--mock-signature-host] --db …
npx -y @acala-network/chopsticks@latest --endpoint wss://paseo-people-next-system-rpc.polkadot.io --port 8011 …
```

Results:

- Plain start **fails to build blocks** on both chains:
  `Unresolved function env:ext_statement_store_remove_by_version_1`
  (`chain_getHeader` and `dev_newBlock` both error; `system_chain` and
  `state_getStorage` work). The runtime imports the statement-store host
  interface (`sp_statement_store::runtime_api::statement_store::remove_by`,
  used only in `pallet-game`'s `offchain_worker`,
  `individuality-community/pallets/game/src/lib.rs:853`). Chopsticks' executor
  does not provide these host functions.
- With `--allow-unresolved-imports` both forks build blocks: `dev_newBlock`
  returned a hash and advanced the head (devnet 0x631d3b → 0x631d3c; Paseo
  likewise). The stub is never hit because chopsticks does not run offchain
  workers. Every probe below used this flag.
- `--mock-signature-host` is not needed; real sr25519 signatures verify. A
  zero signature is rejected with `badProof`, so the mock only adds the
  `0xdeadbeef…` pattern.
- `dev_setStorage` works in both forms: raw `[[key, value]]` pairs (used for
  `:statement_allowance:<account>`), and decoded `{Pallet: {Item: [[[keys], value]]}}`
  (used for `Sudo.Key`, `System.Account`, `Resources.StatementStoreAllowances`,
  `Resources.StmtStoreAllowanceByAccount`, `Coinage.CoinsByOwner`). Planted
  values survive `dev_newBlock`.
- `Resources.Consumers` for macbot `5DXPWoMyS7HS7cfv98jGT4mUUXgNMgo7XvxZSvBMTfvHhxxQ`
  is `null` on **both** live chains (key
  `0x2111e0df…7021b9e4…`). The account is not registered on the current Paseo
  Next (chain reset) nor on devnet. Real entries were read instead, e.g.
  devnet `lite_username = "jindot.01"`, Paseo `"tqesgkgvp.01"`.

End-to-end on the devnet fork (`fork-e2e-devnet.mjs`, papi 2.1.7 unsafe API
plus hand-encoded extrinsics; events read back from `System.Events`):

1. `dev_setStorage { Sudo.Key: Alice, System.Account[Alice].free: 1e15 }`.
2. `Sudo.sudo(PeopleLite.increase_attestation_allowance(Alice, 5))` signed by
   `//Alice`: `PeopleLite.AttestationAllowanceIncreased`, `Sudo.Sudid {success:true}`.
   Same call the Product Preview Network runs at block 1
   (`preview-net-v1/scripts/increase-people-lite-attestation-allowance.sh`).
3. `PeopleLite.attest(bot, …)` signed by Alice, with **exactly the payload
   `bot-core/lib/register.mjs` builds** (lite-person proof from the vendored
   wasm, `candidate_signature = wallet.sign("pop:people-lite:register using" ++ account ++ ring_vrf_key)`,
   `consumer_registration.signature = wallet.sign(account ++ attester ++ identifier_key ++ scale(stem) ++ 0x00)`,
   username `"sbxntsew.01"`): events `Members.MemberAdded`,
   `PeopleLite.PersonAttested`, `Resources.LitePersonRegistered`,
   `PeopleLite.ConsumerRegistered`. Afterwards `Resources.Consumers(bot)` =
   `{identifier_key: 0x007bd0ae…, lite_username: "sbxntsew.01", credibility: Lite}`,
   `UsernameOwnerOf("sbxntsew.01") == bot`, `LitePeople(bot).method = UniqueDevice`,
   and `:statement_allowance:<bot>` = `0x3200000000d00700` = `{50, 512000}`.
4. `Resources.set_statement_store_account(20700, 0, device)` signed by Alice
   with `AsResources = None`: `System.ExtrinsicFailed BadOrigin`. Via
   `Sudo.sudo`: `Sudid {success:false, BadOrigin}`. **The AsResources
   extension is the only source of the `StmtStoreAlias` origin; neither a dev
   account nor Root can call it.** (`pallets/resources/src/lib.rs:1539
   ensure_stmt_store_alias`.)
5. Planting instead: raw `:statement_allowance:<device> = 0x0200000000d00700`
   and decoded `StatementStoreAllowances[(0x000050dc, alias)] = {account_id: device, seq: 0, since}`
   both read back correctly after a block.
6. `Coinage.CoinsByOwner[coin0] = {value: 3, age: 0}` planted and read back.
   Moving it failed, see §4.

On the Paseo Next fork (`fork-register-with-fee-paseo.mjs`):
`PeopleLite.register_with_fee(ring_vrf_key, proof, Some(consumer_registration))`
signed by the bot's own `//wallet` (funded by `dev_setStorage`), signature over
`account ++ account ++ identifier_key ++ scale(stem) ++ 0x00`: events
`PeopleLite.PersonRegisteredWithFee`, `Resources.LitePersonRegistered`,
`PeopleLite.ConsumerRegistered`; `LitePeople(bot).method = Fee`; balance
dropped by 75 PAS; `UsernameOwnerOf == bot`; allowance `{50, 512000}`. No
sudo, no attester, no backend.

Gotchas found on the way (all client-side):

- papi 2.1.7 refuses to encode `PeopleLite.attest` and to read
  `Resources.StatementStoreAllowances` ("Incompatible runtime entry"), even
  through `getUnsafeApi()`; `Sudo.sudo`, `PeopleLite.increase_attestation_allowance`,
  `Resources.set_statement_store_account`, `Coinage.transfer` and all simple
  storage reads work. Hand-encoding the call and a v4 signed extrinsic works.
- The on-chain lite username must be `stem.NN` (`support/src/labels.rs
  is_lite_person_label`, `MIN_LITE_USERNAME_DIGITS = 2`); the signed consumer
  payload carries the stem only (`pallets/people-lite/src/types.rs:81
  signing_payload`). `bot-core` already does this split
  (`normalizeUsername`, `scaleString(base)`); the backend appends `.NN`.
- Chopsticks decodes every submitted extrinsic with `@polkadot/types`
  before it reaches the runtime. **v5 "general" extrinsics** (the format the
  app and the faucet use for `AsCoin`, `0x45` + `VerifyMultiSignature::Signed`)
  fail that decoder on both forks
  (`createType(GeneralExtrinsic):: decodeU8aStruct: failed … on era` /
  `on assetId`). See §4.

## 3. Proofs

`bot-core/lib/register.mjs` + `tools/bandersnatch-cli/src/main.rs`:

- Inputs of the lite-person proof: `entropy = blake2b_256(mnemonicToEntropy(mnemonic))`
  and a message. `lite-person <entropy> <message>` outputs
  `memberKey = BandersnatchVrfVerifiable::member_from_secret(new_secret(entropy))`
  (32 bytes) and `proofOfOwnership = sign(secret, message)` (64 bytes, a plain
  Bandersnatch signature, **not a ring proof**). `register.mjs` runs it twice:
  once with `message = prefix ++ account ++ 0x00*32` to learn the member key,
  then with `prefix ++ account ++ memberKey` for the real proof. No ring and
  no context are involved. The pallet verifies exactly this
  (`pallets/people-lite/src/lib.rs:369-460 attest`, `registration_message`).
- Ring proofs (`create-proof <entropy> <domain> <context> <message> <member>…`)
  are only needed for `AsResources` (statement-store slot,
  `RegisterStatementStoreAllowance(proof, ring, collection)`), for friend
  requests, and for Coinage unloads. Their ring members come from the
  `Members` pallet (`RingKeys`, `Root`, `CurrentRingIndex`, collection
  `LitePeople`, `LiteRingExponent = R2e9`) and `ChunksManager.Chunks`; the
  faucet fetches them on demand. The identity backend does the
  `set_statement_store_account` step for a bot today; `bot-core` never issues
  a ring proof.

Smallest honest path per goal, on a fork:

- (a) statement allowance for an account: `dev_setStorage` of the raw key
  `:statement_allowance:<account> = SCALE{max_count, max_size}` (proven).
  Planting `StatementStoreAllowances` next to it is optional cosmetics; the
  node only reads the raw key. There is **no** transacting path without a ring
  proof (BadOrigin proven), and sudo cannot help.
- (b) username + identifier key: devnet-style: `Sudo.sudo(increase_attestation_allowance(Alice, N))`
  once, then `PeopleLite.attest` signed by Alice with `bot-core`'s existing
  payload (proven; also grants `{50, 512000}` to the identity account).
  Paseo-style: `register_with_fee` from the bot itself (proven, needs 75 PAS
  planted). Both settle in `Resources` like production. Plant-only fallback:
  `dev_setStorage` of `Resources.Consumers`, `Resources.UsernameOwnerOf`,
  `PeopleLite.LitePeople` (not tested; the decoded form worked for every other
  map).
- (c) Coinage coins minted to it: **plant** `Coinage.CoinsByOwner[<//pps//coin//n>] = {value, age}`
  (proven; on Paseo Next include `instance_id`). The production mint path
  (`Assets.mint` of the underlying asset by the asset manager proxy →
  `load_recycler_with_external_asset_unpaid` → `unload_recycler_into_coins`
  under `AsUnloadTokenLitePeople`) needs a personhood ring proof and is not
  worth reproducing locally.

Where sudo helps: attestation allowance (b). Where it does not: (a) and every
`AsResources`/`AsCoinage`-origin call, because those origins are minted by
transaction extensions, not by Root.

## 4. Coinage

Sources: `polkadot-app-android-v2` master (2026-08-10; the `feature/coinage`
work is merged, branches `feature/coinage-layer-android` etc. remain),
`.claude/docs/architecture/coinage.md`, `feature/coinage/**`,
`feature/chats/impl/.../CoinagePaymentProcessingExtension.kt`; and
`paritytech/summit-faucet-chatbot` (`docs/chat-coinage-faucet-flow.md`,
`scripts/app-chat-codec.mjs`, `scripts/lib/{coinage-tx,wallet-keys,coinage-storage}.mjs`,
`scripts/mint-people-cash.mjs`, fetched with `gh api`).

- **Coin** = one sr25519 keypair at `//pps//coin//<n>` (hard junctions, from
  the wallet mnemonic's 32-byte mini-secret; `CoinKeypairDerivation.kt`,
  faucet `deriveCoinageWalletSlotSecret`). Its AccountId is the raw public
  key. On chain it is one entry `Coinage.CoinsByOwner[account] = {value: exponent, age}`
  worth `2^value` units × `UnderlyingAssetUnit`. Indices are allocated
  monotonically and never reused (`RealCoinAllocator`). The only other
  derivation is `//pps//ring-vrf//<n>` (Bandersnatch entropy for recycler
  vouchers). There is no memo key.
- **Send** = hand the recipient the coin **secret keys** in chat. The message
  is `ChatMessageStatementContent.CoinagePayment` (enum index 16) =
  `{ totalValue: Compact<u128>, coinKeys: Vec<Vec<u8>> }`; each entry is the
  64-byte schnorrkel `privateKey ‖ nonce` of a `//pps//coin//<n>` key
  (`TransferMemoBuilder.kt`, faucet `encodeOpaqueCoinageSendMessage`,
  `app-chat-codec.mjs:722`). Strategies: exact coins (no chain tx), `Split`
  (`Coinage.split`, signed by the coin being split under `AsCoin`), or
  unload vouchers (`unload_recycler_into_coins`, needs ring proofs).
- **"Memo public keys appear on chain"** = the sr25519 public keys of those
  secrets are map keys in `Coinage.CoinsByOwner`. Both sides subscribe to
  exactly those keys (`subscribeCoinsInfoFor`, faucet `coinsByOwnerStorageKey`
  + `state_queryStorageAt`). No event parsing, no call-argument scanning.
- **Sweep** (recipient claim) = for each received secret, `Coinage.transfer(to)`
  where `to` is a **fresh own** `//pps//coin//<m>` account of the same
  exponent, signed by the *received* coin key with extension
  `AsCoinage = Some(AsCoin)` (`RealCoinageTransferSubmissionUseCase.kt`,
  faucet `makeCoinageTransferCall` + `buildAsCoinV5Extrinsic`). Then wait for
  the source keys to disappear. The sender watches the same disappearance as
  settlement. Chat ACK and claim are independent states.
- Wire shape of an `AsCoin` transaction (faucet, mirrors the app): v5 general
  extrinsic `0x45 0x00`, `AuthorizeValueTransfer` (devnet/summit only),
  `VerifyMultiSignature::Signed(Sr25519(sig), account)`, the other extensions
  `None`, `AsCoinage = 0x01 0x00`, `RestrictOrigins = false`, immortal era,
  coin nonce, tip 0, asset None. The signature covers
  `blake2_256(0x00 ‖ call ‖ rest explicit ‖ spec ‖ tx ‖ genesis ‖ genesis)`.
  A v4 *signed* extrinsic from the coin key is rejected with
  `System.CallFiltered` (proven on the fork), and a failed dispatch locks the
  coin for `CoinFailureLockPeriod = 60 s` (`LockedCoins`, custom validity 74
  `CoinTemporarilyLocked`, proven).
- What a bot must hold: the wallet mnemonic (or its mini-secret) to derive
  `//pps//coin//<n>` for receiving (fresh destinations) and sending (memo
  secrets), plus `//wallet` for chat. That is all `bot-core` already keeps.
  Rebuilding the inventory from the mnemonic alone scans `CoinsByOwner` in
  batches of 500 indices (`CoinageBackupService.kt`).
- Needs the phone's mnemonic-only Bandersnatch proof: recycler unloads
  (`AsUnloadTokenPeople/LitePeople`, ring proof over the LitePeople ring +
  voucher alias proofs), i.e. converting an external asset into spendable
  coins, and spending aged coins (`age >= 14` must be recycled). A plain
  sr25519 bot can receive, sweep, split and send, but cannot bootstrap coins
  from an asset balance on its own. `load_recycler_with_coin` /
  `load_recycler_with_external_asset_unpaid` only need a plain Bandersnatch
  signature (`InfallibleUnpaidSigned{nonce}`), not a ring proof.
- Fork status: coins are plantable; the sweep transaction could not be
  submitted through chopsticks 1.5.1 because its `@polkadot/types`
  pre-decoder rejects v5 general extrinsics with this runtime's extension set
  (both forks, 3 attempts each). This is an RPC-layer limit, not a runtime
  refusal. Options: a newer chopsticks with GeneralExtrinsic support for
  custom extensions, patching the decoder out, or using PPN (a real node).
  Not tested further.

## Recommended shape for the `local` profile

Mocked (unchanged): the statement store (`sandbox/lib/store-node.mjs`), the
identity backend's username service, personas, wire inspector. The store's
only chain-facing decision, "may this signer submit?", moves from the
in-memory Set to one `state_getStorage` of `:statement_allowance:<signer>` on
the fork (cache per block hash; the real node reads the same key).

Chopsticks: `@acala-network/chopsticks@1.5.1 --endpoint <people wss> --port <p>
--allow-unresolved-imports --db <state dir>/chopsticks.sqlite`, started by
`pcs up --profile local`. Fork the devnet People chain by default (it is the
profile the apps use and the deployed bots register on); Paseo Next as an
option. Startup cost: 3–4 s warm, plus the npx install once.

`bot-core`: `createChainDirectory(peopleApi)` already reads the fork
unchanged (`Resources.Consumers`, `UsernameOwnerOf`); the `local` profile is
the `sandbox` profile with `peopleEndpoints: ["ws://127.0.0.1:<p>"]`,
`insecureEndpoints: true`, `bulletin: null`. Registration
(`identityRegistrationAuth: "local"`) skips the backend and asks the sandbox
daemon to attest.

Planted with `dev_setStorage` (once, at `pcs up`):

- `Sudo.Key = //Alice`, `System.Account[//Alice].free` (fees for sudo/attest).
- Per persona/bot device account: raw `:statement_allowance:<device> = {2, 512000}`
  (what `set_statement_store_account` would grant; the `AsResources` ring
  proof has no local substitute). Optionally the `StatementStoreAllowances` /
  `StmtStoreAllowanceByAccount` rows so the wire view can show the slot.
- Coins: `Coinage.CoinsByOwner[//pps//coin//n]` for a persona that should hold
  money; `Coinage.UnderlyingAssetId` is already set on the fork.

Transacted (real pallets settle):

- `Sudo.sudo(PeopleLite.increase_attestation_allowance(Alice, 1000))` once.
- Per persona/bot identity: `PeopleLite.attest` signed by Alice with the
  `bot-core` registration payload (username `stem.NN`, digits chosen by the
  daemon like the backend does). This yields `Consumers`, `UsernameOwnerOf`,
  `LitePeople`, `Members.MemberAdded` and the `{50, 512000}` allowance
  exactly as on devnet. On a Paseo fork use `register_with_fee` from the
  account itself.
- Coinage sweeps (`Coinage.transfer` under `AsCoin`) once chopsticks accepts
  v5 general extrinsics; until then coin movement stays plant-only and the
  scenario asserts the chat memo and the `CoinsByOwner` reads, not the
  transfer.

Alternative if chopsticks' v5 limit blocks Coinage: the Product Preview
Network (`~/Documents/GitHub/preview-net-v1`, zombienet, real People collator
with `--enable-statement-store`) gives a real node and a real statement
store, at the cost of binaries and ~1 min start; the same plant/attest steps
apply through its Alice sudo.

Effort estimate (honest):

- Store allowance from the fork + `local` profile plumbing (`pcs up` launches
  chopsticks, `network-config.mjs`, daemon config, directory seam reading the
  fork through papi): 1–1.5 days.
- Attest path in the daemon (hand-encoded `attest`, username digits, proof via
  the vendored wasm which `register.mjs` already wraps), plus tests: 1 day.
  papi cannot encode `attest` today, so budget the SCALE encoder (~120 lines,
  the probe script has it).
- Planting helpers and scenarios (allowance, coins, restart of the fork from
  its sqlite db): 0.5 day.
- Coinage sweep through the fork: unknown until the chopsticks v5 decode issue
  is resolved; 0.5 day to try a newer chopsticks or a decoder bypass, more if
  it needs PPN.

Total: about 3–4 days for a working `local` profile without Coinage
transfers, plus the Coinage unknown.

Open items to confirm with the owner:

- `bot-core/.papi` Paseo descriptors pin a pre-reset genesis; regenerate.
- The devnet runtime source (`people-paseo` 2004003, path
  `system-parachains/people-paseo`) is not in any local checkout; the public
  `individuality-community` (spec 3000000) is behind live Paseo Next (3002000,
  e.g. `Coin.instance_id`). Behaviour above was verified on the forks, not by
  reading that source.
- Whether a chat identity registered on the local fork should also get device
  slots via a real `set_statement_store_account` one day (needs a LitePeople
  ring proof: ring from `Members.RingKeys`, `create-proof` in the CLI); today
  the backend does it and the sandbox would plant it.
