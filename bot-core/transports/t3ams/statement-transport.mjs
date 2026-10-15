// SPDX-License-Identifier: GPL-3.0-or-later

// The Statement Store transport the T3ams agent runtime uses instead of a
// host's: direct JSON-RPC to a statement-store node, every statement signed by
// the bot's sr25519 account (which needs a statement allowance, as before).
//
// Shape: `StatementTransport` from @parity/product-sdk-statement-store, the
// interface the T3ams app talks to its host through. A refused submit throws
// with the node's verdict as JSON in the message — the app reads
// `reason` / `min_expiry` / `submitted_expiry` out of it to step past its own
// earlier statements, exactly as it does with a host's error text.

import { createStatementSdk, getStatementSigner } from "@novasamatech/sdk-statement";
import { createClient } from "@polkadot-api/raw-client";
import { getWsRawProvider } from "polkadot-api/ws";

const ACCEPTED = new Set(["new", "known"]);
const KEEPALIVE_MS = 20_000;

const verdictText = (result) =>
  JSON.stringify(result, (_key, value) => (typeof value === "bigint" ? value.toString() : value));

// Plain JSON-RPC over the provider: the statement methods need no chain
// client (no head following, no metadata), so none is started.
function statementRpc(provider) {
  const client = createClient(provider);
  // raw-client throws synchronously while the socket is reconnecting; report
  // that the same way as any other failure so callers retry instead of crashing.
  const request = (method, params) => new Promise((resolve, reject) => {
    try {
      client.request(method, params, { onSuccess: resolve, onError: reject });
    } catch (error) {
      reject(error);
    }
  });
  const subscribe = (method, params, onMessage, onError) => {
    let stop = null;
    let closed = false;
    let cancelRequest = () => {};
    try {
      cancelRequest = client.request(method, params, {
        onSuccess: (subscriptionId, follow) => {
          const unfollow = follow(subscriptionId, { next: onMessage, error: onError });
          stop = () => {
            unfollow();
            request(method.replace("subscribe", "unsubscribe"), [subscriptionId]).catch(() => {});
          };
          if (closed) stop();
        },
        onError,
      });
    } catch (error) {
      queueMicrotask(() => onError(error));
    }
    return () => {
      closed = true;
      if (stop != null) stop();
      else cancelRequest();
    };
  };
  // The provider drops a socket that is silent for 40 s and every subscription
  // with it. A statement subscription can stay quiet for much longer, so keep
  // the socket talking.
  const keepalive = setInterval(() => request("rpc_methods", []).catch(() => {}), KEEPALIVE_MS);
  keepalive.unref?.();
  return {
    request,
    subscribe,
    close: () => {
      clearInterval(keepalive);
      client.disconnect();
    },
  };
}

// The app's MLS work runs on the same event loop and can hold it for seconds
// (opening the keystore, a large commit); the provider must not take that for
// a dead socket. Liveness comes from the keepalive below.
const SOCKET_TIMEOUTS = { timeout: 30_000, heartbeatTimeout: 120_000 };

/**
 * @param {{ endpoints: string[],
 *           walletPair: { publicKey: Uint8Array, sign(bytes: Uint8Array): Uint8Array },
 *           onSubmitted?: (statement: object) => void }} options
 */
export function createT3amsStatementTransport({ endpoints, walletPair, onSubmitted = () => {} }) {
  const rpc = statementRpc(getWsRawProvider(endpoints, SOCKET_TIMEOUTS));
  const sdk = createStatementSdk(rpc.request, rpc.subscribe);
  const signer = getStatementSigner(walletPair.publicKey, "sr25519", async (bytes) => walletPair.sign(bytes));
  return {
    subscribe(filter, onStatements, onError) {
      const unsubscribe = sdk.subscribeStatements(filter, (statement) => onStatements([statement]), onError);
      return { unsubscribe };
    },
    async signAndSubmit(statement) {
      const { proof: _unsigned, ...unsigned } = statement;
      const signed = await signer.sign(unsigned);
      const result = await sdk.submit(signed);
      if (!ACCEPTED.has(result?.status)) {
        const error = new Error(`statement submit refused: ${verdictText(result)}`);
        error.statementSubmitReason = result?.reason ?? result?.status;
        throw error;
      }
      onSubmitted(signed);
    },
    destroy() {
      rpc.close();
    },
  };
}
