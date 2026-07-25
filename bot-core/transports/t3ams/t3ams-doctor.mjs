import { createLazyClient } from "@novasamatech/statement-store";
import { getWsProvider } from "polkadot-api/ws";
import { deriveSr25519PairFromSeed } from "../../vendor/lib/wallet-keys.mjs";
import { scaleEncodeBytes, submitAppStatement } from "../../vendor/app-chat-codec.mjs";
import { createRawStatementPageSubscriber } from "../../vendor/lib/statement-ingress-supervisor.mjs";
import {
  deriveT3amsAccountXid,
  deriveT3amsIdentityFromSeed,
} from "./t3ams-identity.mjs";
import { createT3amsPriorityClock } from "./t3ams-submission.mjs";

const bareHex = (value) => String(value ?? "").trim().replace(/^0x/i, "").toLowerCase();
const hexToBytes = (value) => {
  const hex = bareHex(value);
  if (!/^[0-9a-f]{64}$/.test(hex)) throw new Error("account ID must be exactly 32 bytes of hex");
  return new Uint8Array(Buffer.from(hex, "hex"));
};
const bytesEqual = (left, right) => left instanceof Uint8Array
  && right instanceof Uint8Array
  && left.length === right.length
  && left.every((value, index) => value === right[index]);
const statementBytes = (value) => {
  if (value instanceof Uint8Array) return value;
  const hex = bareHex(value);
  return /^(?:[0-9a-f]{2})+$/.test(hex) ? new Uint8Array(Buffer.from(hex, "hex")) : null;
};

export class T3amsDoctorProbeError extends Error {
  constructor(code, message, cause = null) {
    super(message);
    this.name = "T3amsDoctorProbeError";
    this.code = code;
    if (cause != null) this.cause = cause;
  }
}

function parseExpectedAccept({
  bcts,
  data,
  botIdentity,
  botXid,
  requestTimestamp,
}) {
  try {
    const signed = bcts.envelopeFromBytes(data);
    if (!bcts.verifyGSTPRequestSignature(signed, botIdentity.signingPublicKey)) return null;
    const request = signed.isWrapped?.() ? signed.unwrap() : signed;
    const parsed = bcts.parseGSTPMessage(request);
    if (parsed?.type !== "request" || bcts.extractFunctionName(parsed.body) !== "dmAccept") return null;
    const senderXid = bcts.extractParameter(parsed.body, "senderXid")?.extractBytes();
    const signingPubKey = bcts.extractParameter(parsed.body, "signingPubKey")?.extractBytes();
    const agreementPubKey = bcts.extractParameter(parsed.body, "agreementPubKey")?.extractBytes();
    const timestamp = bcts.extractParameter(parsed.body, "timestamp")?.extractNumber();
    if (!bytesEqual(senderXid, botXid)
        || !bytesEqual(signingPubKey, botIdentity.signingPublicKey.taggedCborData())
        || !bytesEqual(agreementPubKey, botIdentity.agreementPublicKey)
        || !Number.isSafeInteger(timestamp)
        || timestamp < requestTimestamp) {
      return null;
    }
    return { agreementPubKey };
  } catch {
    return null;
  }
}

/**
 * Publish a real first-contact request and require the running bot's signed
 * dmAccept on the probe identity's inbox. This shares the transport's exact
 * Statement Store subscription, statement framing, and signing plumbing.
 */
export async function runT3amsLoopbackProbe({
  bcts,
  endpoints,
  namespace = "",
  botAccountIdHex,
  botSeed,
  probeSeed,
  timeoutMs = 90_000,
}) {
  if (!(botSeed instanceof Uint8Array) || botSeed.length !== 32) {
    throw new T3amsDoctorProbeError("T3AMS_DOCTOR_CONFIG", "bot seed must be exactly 32 bytes");
  }
  if (!(probeSeed instanceof Uint8Array) || probeSeed.length !== 32) {
    throw new T3amsDoctorProbeError("T3AMS_DOCTOR_CONFIG", "probe seed must be exactly 32 bytes");
  }
  const endpointList = Array.isArray(endpoints) ? endpoints.filter(Boolean) : [String(endpoints ?? "")].filter(Boolean);
  if (endpointList.length === 0) {
    throw new T3amsDoctorProbeError("T3AMS_DOCTOR_CONFIG", "at least one Statement Store endpoint is required");
  }
  const topicNamespace = String(namespace ?? "").trim();
  if (topicNamespace !== "") bcts.setTopicNamespace(topicNamespace);

  const botMaterial = deriveT3amsIdentityFromSeed(botSeed);
  const botIdentity = bcts.restoreIdentity(botMaterial.signingPrivateKey, botMaterial.agreementPrivateKey);
  const botXid = deriveT3amsAccountXid(hexToBytes(botAccountIdHex));
  botIdentity.xid = botXid;

  const probeMaterial = deriveT3amsIdentityFromSeed(probeSeed);
  const probeIdentity = bcts.restoreIdentity(probeMaterial.signingPrivateKey, probeMaterial.agreementPrivateKey);
  probeIdentity.xid = probeMaterial.xid;
  const probeWallet = deriveSr25519PairFromSeed(probeSeed, "//wallet");
  const probeInbox = bcts.derivePersonalInboxChannel(probeIdentity.xid);
  const botInbox = bcts.derivePersonalInboxChannel(botXid);
  const provider = getWsProvider(endpointList);
  const lazyClient = createLazyClient(provider);
  const subscribePages = createRawStatementPageSubscriber({ getClient: () => lazyClient.getClient() });
  const priorityClock = createT3amsPriorityClock();
  let unsubscribe = null;
  let timeout = null;
  let settleAccept;
  const accepted = new Promise((resolve) => {
    settleAccept = resolve;
  });
  const requestTimestamp = Date.now();
  const deadline = new Promise((_, reject) => {
    timeout = setTimeout(() => reject(new T3amsDoctorProbeError(
      "T3AMS_DOCTOR_TIMEOUT",
      `no compatible dmAccept arrived within ${Math.ceil(timeoutMs / 1000)} seconds`,
    )), timeoutMs);
  });

  try {
    unsubscribe = subscribePages({ matchAll: [probeInbox] }, (page) => {
      for (const statement of page.statements ?? []) {
        if (!bytesEqual(statementBytes(statement.channel), probeInbox)) continue;
        const data = statementBytes(statement.data);
        if (data == null) continue;
        const result = parseExpectedAccept({
          bcts,
          data,
          botIdentity,
          botXid,
          requestTimestamp,
        });
        if (result != null) {
          settleAccept(result);
          return;
        }
      }
    }, (error) => settleAccept({ error: new T3amsDoctorProbeError(
      "T3AMS_DOCTOR_SUBSCRIPTION_FAILED",
      `probe inbox subscription failed: ${String(error?.message ?? error)}`,
      error,
    ) }));

    const expression = bcts.dmMessageRequestExpression(
      probeIdentity.xid,
      "PCA T3ams doctor",
      bcts.derivePersonalDMChannel(probeIdentity.xid, botXid),
      bcts.PERSONAL_SCOPE,
      requestTimestamp,
      new Uint8Array(),
      null,
      null,
      probeIdentity.signingPublicKey.taggedCborData(),
      null,
      null,
      probeIdentity.agreementPublicKey,
    );
    const { envelope } = bcts.createGSTPRequest(expression);
    const signed = bcts.signGSTPRequest(envelope, probeIdentity.signingPrivateKey);
    try {
      await Promise.race([submitAppStatement(lazyClient.getRequestFn(), {
        walletPair: probeWallet,
        channel: botInbox,
        topics: [botInbox],
        scaleEncodedPayload: scaleEncodeBytes(bcts.envelopeToBytes(signed)),
        expiryFactory: priorityClock.nextPriority,
        noteRejectedPriority: priorityClock.noteRejectedPriority,
      }), deadline]);
    } catch (error) {
      if (error?.code === "T3AMS_DOCTOR_TIMEOUT") throw error;
      const reason = String(error?.statementSubmitReason ?? "");
      if (reason === "noAllowance" || reason === "accountFull"
          || /noAllowance|accountFull/.test(String(error?.message ?? error))) {
        throw new T3amsDoctorProbeError(
          "T3AMS_DOCTOR_ALLOWANCE_REQUIRED",
          "doctor identity needs statement allowance",
          error,
        );
      }
      throw new T3amsDoctorProbeError(
        "T3AMS_DOCTOR_SUBMIT_FAILED",
        `doctor request submission failed: ${String(error?.message ?? error)}`,
        error,
      );
    }

    const result = await Promise.race([accepted, deadline]);
    if (result?.error != null) throw result.error;
    return result;
  } finally {
    if (timeout != null) clearTimeout(timeout);
    try { unsubscribe?.(); } catch { /* best effort */ }
    lazyClient.disconnect();
  }
}
