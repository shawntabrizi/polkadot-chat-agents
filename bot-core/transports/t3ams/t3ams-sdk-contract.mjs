// Keep the bot and the locally packed T3ams SDK from drifting silently. These
// are every callable @t3ams/bcts symbol used by index.mjs or
// t3ams-protocol.mjs; a missing export is a startup/build error, not a pairing
// failure discovered after deployment.
export const T3AMS_SDK_FUNCTION_EXPORTS = Object.freeze([
  "Envelope",
  "SigningPublicKey",
  "addReactionExpression",
  "buildChatMessage",
  "buildMessageCarrier",
  "channelAddReactionExpression",
  "channelEditMessageExpression",
  "channelRemoveReactionExpression",
  "channelTypingExpression",
  "createDMTopics",
  "createEncryptedDMMessage",
  "createGSTPRequest",
  "createPrivateChannelTopics",
  "createPublicChannelTopics",
  "createWorkspaceDiscoveryTopics",
  "decryptChannelKeyFromAdmin",
  "decryptWorkspaceChannelEnvelope",
  "deriveChannelRegistryChannel",
  "derivePersonalDMChannel",
  "derivePersonalInboxChannel",
  "derivePrivateChannel",
  "derivePrivateChannelOpsChannel",
  "derivePrivateChannelTypingChannel",
  "derivePublicChannel",
  "derivePublicChannelOpsChannel",
  "derivePublicChannelTypingChannel",
  "deriveUserNotificationTopic",
  "deriveWorkspaceDiscoveryTopic",
  "deriveWorkspaceKey",
  "deriveWorkspaceMemberChannel",
  "deriveWorkspaceMetaChannel",
  "dmAcceptExpression",
  "dmMessageRequestExpression",
  "dmNotificationExpression",
  "editMessageExpression",
  "encryptWorkspaceChannelEnvelope",
  "envelopeFromBytes",
  "envelopeToBytes",
  "extractFunctionName",
  "extractParameter",
  "formatXID",
  "generateARID",
  "memberAnnounceExpression",
  "parseAttachmentsEnvelope",
  "parseGSTPMessage",
  "parseMentionsEnvelope",
  "parseMessageCarrier",
  "removeReactionExpression",
  "restoreIdentity",
  "sealDMEnvelope",
  "sendChannelMessageExpression",
  "setTopicNamespace",
  "signGSTPRequest",
  "unsealDMEnvelope",
  "unsealMessage",
  "verifyGSTPRequestSignature",
  "workspaceJoinExpression",
]);

// Function.length is useful only where a removed required/positional argument
// has broken the wire contract before. The installed SDK currently reports 5
// for createEncryptedDMMessage even though its fifth TypeScript parameter is
// optional, because it has no JavaScript default initializer.
export const T3AMS_SDK_FUNCTION_ARITIES = Object.freeze({
  createEncryptedDMMessage: 5,
  workspaceJoinExpression: 3,
});

export class T3amsSdkContractError extends Error {
  constructor(symbol, detail) {
    super(`T3ams SDK contract mismatch at "${symbol}": ${detail}`);
    this.name = "T3amsSdkContractError";
    this.symbol = symbol;
  }
}

function mismatch(symbol, detail) {
  throw new T3amsSdkContractError(symbol, detail);
}

function assertDmAcceptAgreementKeyRoundTrip(bcts) {
  try {
    const identity = bcts.restoreIdentity(
      new Uint8Array(32).fill(7),
      new Uint8Array(32).fill(9),
    );
    const expression = bcts.dmAcceptExpression(
      identity.xid,
      "SDK contract probe",
      1,
      null,
      null,
      identity.signingPublicKey.taggedCborData(),
      null,
      null,
      identity.agreementPublicKey,
    );
    const { envelope } = bcts.createGSTPRequest(expression);
    const parsed = bcts.parseGSTPMessage(envelope);
    if (parsed?.type !== "request"
        || bcts.extractParameter(parsed.body, "agreementPubKey") == null) {
      mismatch("dmAcceptExpression", 'the 9th argument did not round-trip as "agreementPubKey"');
    }
  } catch (error) {
    if (error instanceof T3amsSdkContractError) throw error;
    mismatch("dmAcceptExpression", `the 9-argument agreementPubKey round-trip failed: ${String(error?.message ?? error)}`);
  }
}

export function assertT3amsSdkContract(bcts) {
  for (const symbol of T3AMS_SDK_FUNCTION_EXPORTS) {
    if (typeof bcts?.[symbol] !== "function") {
      mismatch(symbol, `expected a function export, received ${typeof bcts?.[symbol]}`);
    }
  }
  if (typeof bcts.PERSONAL_SCOPE !== "string") {
    mismatch("PERSONAL_SCOPE", `expected a string export, received ${typeof bcts.PERSONAL_SCOPE}`);
  }
  for (const [symbol, arity] of Object.entries(T3AMS_SDK_FUNCTION_ARITIES)) {
    if (bcts[symbol].length !== arity) {
      mismatch(symbol, `expected function length ${arity}, received ${bcts[symbol].length}`);
    }
  }
  assertDmAcceptAgreementKeyRoundTrip(bcts);
  return true;
}
