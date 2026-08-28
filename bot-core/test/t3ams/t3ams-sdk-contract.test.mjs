import { test } from "node:test";
import assert from "node:assert/strict";
import {
  T3AMS_SDK_FUNCTION_ARITIES,
  T3AMS_SDK_FUNCTION_EXPORTS,
  assertT3amsSdkContract,
} from "../../transports/t3ams/t3ams-sdk-contract.mjs";

// The SDK is not on npm (`pca t3ams setup` builds it from the T3ams checkout),
// so CI has no copy: skip with a reason instead of failing on the import.
let bcts = null;
try { bcts = await import("@t3ams/bcts"); } catch { /* not installed */ }
const skip = bcts ? false : "@t3ams/bcts is not installed (run pca t3ams setup)";

test("installed T3ams SDK satisfies the complete transport contract", { skip }, () => {
  assert.equal(T3AMS_SDK_FUNCTION_EXPORTS.includes("dmAcceptExpression"), true);
  assert.deepEqual(T3AMS_SDK_FUNCTION_ARITIES, {
    createEncryptedDMMessage: 5,
    workspaceJoinExpression: 3,
  });
  assert.equal(assertT3amsSdkContract(bcts), true);
});

test("T3ams SDK contract reports the exact missing or wrong symbol", { skip }, () => {
  assert.throws(
    () => assertT3amsSdkContract({ ...bcts, derivePersonalInboxChannel: undefined }),
    (error) => error.symbol === "derivePersonalInboxChannel"
      && /derivePersonalInboxChannel/.test(error.message),
  );
  assert.throws(
    () => assertT3amsSdkContract({
      ...bcts,
      workspaceJoinExpression: function workspaceJoinExpression(senderXid, sealed) {
        return bcts.workspaceJoinExpression(senderXid, sealed, 1);
      },
    }),
    (error) => error.symbol === "workspaceJoinExpression"
      && /expected function length 3, received 2/.test(error.message),
  );
});

test("T3ams SDK contract catches an omitted optional trailing agreement key", { skip }, () => {
  assert.throws(
    () => assertT3amsSdkContract({
      ...bcts,
      dmAcceptExpression: function dmAcceptExpression(
        senderXid,
        senderName,
        timestamp,
        avatarUrl,
        username,
        signingPubKey,
        bio,
        links,
        agreementPubKey,
      ) {
        void agreementPubKey;
        return bcts.dmAcceptExpression(
          senderXid,
          senderName,
          timestamp,
          avatarUrl,
          username,
          signingPubKey,
          bio,
          links,
        );
      },
    }),
    (error) => error.symbol === "dmAcceptExpression"
      && /agreementPubKey/.test(error.message),
  );
});
