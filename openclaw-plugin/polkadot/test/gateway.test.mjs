import assert from "node:assert/strict";
import { after, test } from "node:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputDir = await mkdtemp(path.join(os.tmpdir(), "polkadot-openclaw-test-"));

const bundle = async (entry, name) => {
  const outfile = path.join(outputDir, name);
  await build({
    entryPoints: [path.join(root, entry)],
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node20",
    outfile,
  });
  return import(pathToFileURL(outfile).href);
};

const gateway = await bundle("src/gateway.ts", "gateway.mjs");
const bridgeModule = await bundle("src/bridge.ts", "bridge.mjs");

after(async () => {
  await rm(outputDir, { recursive: true, force: true });
});

const account = { accountId: "default", outboundFileMaxBytes: 25 * 1024 * 1024 };
const context = { cfg: { session: {} }, log: { warn: () => undefined } };

const runtimeFor = (run, { buildContext = () => ({}), routeSessionKey = "agent:polkadot:chat" } = {}) => ({
  routing: {
    resolveAgentRoute: () => ({ agentId: "agent", sessionKey: routeSessionKey }),
  },
  session: {
    resolveStorePath: () => "/tmp/openclaw-session-store.json",
    recordInboundSession: () => undefined,
  },
  inbound: {
    buildContext,
    run,
  },
  reply: { dispatchReplyWithBufferedBlockDispatcher: () => undefined },
});

test("T3ams thread roots isolate OpenClaw session and dispatcher lanes", () => {
  const base = "agent:polkadot:channel";
  const rootA = "A".repeat(64);
  const rootB = "b".repeat(64);

  assert.equal(gateway.t3amsThreadSessionKey(base), base);
  assert.equal(gateway.t3amsThreadSessionKey(base, rootA), `${base}:thread:${rootA.toLowerCase()}`);
  assert.notEqual(gateway.t3amsThreadSessionKey(base, rootA), gateway.t3amsThreadSessionKey(base, rootB));
  assert.equal(
    gateway.t3amsDispatchKey("t3ams:channel:workspace:room", rootA),
    gateway.t3amsDispatchKey("t3ams:channel:workspace:room", `0x${rootA.toLowerCase()}`),
  );
  assert.notEqual(
    gateway.t3amsDispatchKey("t3ams:channel:workspace:room", rootA),
    gateway.t3amsDispatchKey("t3ams:channel:workspace:room", rootB),
  );
});

test("gateway injects bridge operator context once per OpenClaw session", async () => {
  const seen = [];
  const bridge = {
    typing: async () => undefined,
    send: async () => ({ success: true, message_id: "outgoing" }),
  };
  const runtime = runtimeFor(async ({ adapter }) => {
    const input = adapter.ingest();
    seen.push(input);
    await adapter.resolveTurn(input).delivery.deliver({ text: "answer" }, { kind: "final" });
  }, { routeSessionKey: "agent:polkadot:operator-context-test" });
  const base = {
    chat_id: "peer-context-test",
    text: "/help",
    conversation_type: "dm",
    sender_xid: "sender",
    context: "You are `atlas.42`.\nTools: no tools.",
  };

  await gateway.dispatchInbound(context, runtime, account, bridge, {
    ...base, message_id: "one", delivery_id: "delivery-one", lease_id: "lease-one",
  }, new AbortController().signal);
  await gateway.dispatchInbound(context, runtime, account, bridge, {
    ...base, message_id: "two", delivery_id: "delivery-two", lease_id: "lease-two",
  }, new AbortController().signal);

  assert.match(seen[0].textForAgent, /^\[PCA operator context\][\s\S]*You are `atlas\.42`[\s\S]*\[End PCA operator context\]\n\n\/help$/);
  assert.equal(seen[0].textForCommands, "/help", "framework commands receive the unprefixed message");
  assert.equal(seen[1].textForAgent, "/help", "resume history already contains operator context");
});

test("bridge serializes live edits and binds activity to the active lease", { concurrency: false }, async (t) => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url: String(url), options });
    return new Response(JSON.stringify({ success: true, message_id: "outgoing" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  t.after(() => { globalThis.fetch = originalFetch; });

  const client = bridgeModule.createBridge("http://bridge.test", "secret");
  await client.send("t3ams:dm:peer", "streaming text", {
    editOf: "c".repeat(64),
    threadRootId: "d".repeat(64),
    deliveryId: "delivery",
    leaseId: "lease",
  });
  await client.typing("t3ams:dm:peer", { deliveryId: "delivery", leaseId: "lease" });
  await client.react("t3ams:dm:peer", "message", "👍", false, { deliveryId: "delivery", leaseId: "lease" });

  assert.deepEqual(JSON.parse(calls[0].options.body), {
    chat_id: "t3ams:dm:peer",
    text: "streaming text",
    edit_of: "c".repeat(64),
    thread_root_id: "d".repeat(64),
    delivery_id: "delivery",
    lease_id: "lease",
  });
  assert.deepEqual(JSON.parse(calls[1].options.body), {
    chat_id: "t3ams:dm:peer",
    delivery_id: "delivery",
    lease_id: "lease",
  });
  assert.deepEqual(JSON.parse(calls[2].options.body), {
    chat_id: "t3ams:dm:peer",
    message_id: "message",
    emoji: "👍",
    remove: false,
    delivery_id: "delivery",
    lease_id: "lease",
  });
  await assert.rejects(
    client.send("t3ams:dm:peer", "bad", { editOf: "e".repeat(64), replyTo: "inbound" }),
    /cannot include replyTo/,
  );
});

test("gateway isolates a workspace thread and turns tool, block, and final callbacks into leased edits", async () => {
  const rootId = "a".repeat(64);
  const sends = [];
  const typings = [];
  let contextInput;
  const bridge = {
    typing: async (...args) => { typings.push(args); },
    send: async (...args) => {
      sends.push(args);
      return { success: true, message_id: "live-message" };
    },
  };
  const runtime = runtimeFor(async ({ adapter }) => {
    const turn = adapter.resolveTurn(adapter.ingest());
    await turn.delivery.deliver({ text: "Authorization: Bearer do-not-render" }, { kind: "tool" });
    await turn.delivery.deliver({ text: "Draft response" }, { kind: "block" });
    await turn.delivery.deliver({ text: "Final response" }, { kind: "final" });
  }, { buildContext: (input) => { contextInput = input; return { input }; } });
  const message = {
    chat_id: "t3ams:channel:workspace:room",
    message_id: "inbound-message",
    text: "hello",
    thread_root_id: rootId,
    conversation_type: "channel",
    delivery_id: "delivery",
    lease_id: "lease",
    sender_xid: "sender",
  };

  await gateway.dispatchInbound(context, runtime, account, bridge, message, new AbortController().signal);

  const expectedSession = `agent:polkadot:chat:thread:${rootId}`;
  assert.equal(contextInput.route.routeSessionKey, expectedSession);
  assert.equal(contextInput.route.dispatchSessionKey, expectedSession);
  assert.ok(typings.length >= 1);
  assert.ok(typings.every(([chatId, options]) => (
    chatId === message.chat_id
    && options.deliveryId === message.delivery_id
    && options.leaseId === message.lease_id
  )));
  assert.deepEqual(sends, [
    [message.chat_id, "Working with a tool…", {
      replyTo: message.message_id,
      threadRootId: rootId,
      deliveryId: message.delivery_id,
      leaseId: message.lease_id,
    }],
    [message.chat_id, "Draft response", {
      editOf: "live-message",
      threadRootId: rootId,
      deliveryId: message.delivery_id,
      leaseId: message.lease_id,
    }],
    [message.chat_id, "Final response", {
      editOf: "live-message",
      threadRootId: rootId,
      deliveryId: message.delivery_id,
      leaseId: message.lease_id,
    }],
  ]);
  assert.equal(JSON.stringify(sends).includes("do-not-render"), false);
});

test("unavailable live operations keep interim frames hidden and preserve normal final delivery", async () => {
  const sends = [];
  const bridge = {
    typing: async () => { throw new Error("live operations unsupported"); },
    send: async (...args) => {
      sends.push(args);
      return { success: true, message_id: "normal-final" };
    },
  };
  const runtime = runtimeFor(async ({ adapter }) => {
    const turn = adapter.resolveTurn(adapter.ingest());
    await turn.delivery.deliver({ text: "raw tool output should not be rendered" }, { kind: "tool" });
    await turn.delivery.deliver({ text: "Final response" }, { kind: "final" });
  });
  const message = {
    chat_id: "t3ams:channel:workspace:room",
    message_id: "inbound-message",
    text: "hello",
    conversation_type: "channel",
    delivery_id: "delivery",
    lease_id: "lease",
    sender_xid: "sender",
  };

  await gateway.dispatchInbound(context, runtime, account, bridge, message, new AbortController().signal);

  assert.deepEqual(sends, [[message.chat_id, "Final response", {
    replyTo: message.message_id,
    threadRootId: undefined,
    deliveryId: message.delivery_id,
    leaseId: message.lease_id,
  }]]);
});

test("a rejected terminal live edit falls back to one normal final reply", async () => {
  const sends = [];
  const bridge = {
    typing: async () => undefined,
    send: async (...args) => {
      sends.push(args);
      if (sends.length === 1) return { success: true, message_id: "live-message" };
      if (sends.length === 2) return { success: false, error: "live edit unsupported" };
      return { success: true, message_id: "normal-final" };
    },
  };
  const runtime = runtimeFor(async ({ adapter }) => {
    const turn = adapter.resolveTurn(adapter.ingest());
    await turn.delivery.deliver({ text: "Draft response" }, { kind: "block" });
    await turn.delivery.deliver({ text: "Final response" }, { kind: "final" });
  });
  const message = {
    chat_id: "t3ams:dm:peer",
    message_id: "inbound-message",
    text: "hello",
    conversation_type: "dm",
    delivery_id: "delivery",
    lease_id: "lease",
    sender_xid: "sender",
  };

  await gateway.dispatchInbound(context, runtime, account, bridge, message, new AbortController().signal);

  assert.deepEqual(sends, [
    [message.chat_id, "Draft response", {
      replyTo: message.message_id,
      threadRootId: undefined,
      deliveryId: message.delivery_id,
      leaseId: message.lease_id,
    }],
    [message.chat_id, "Final response", {
      editOf: "live-message",
      threadRootId: undefined,
      deliveryId: message.delivery_id,
      leaseId: message.lease_id,
    }],
    [message.chat_id, "Final response", {
      replyTo: message.message_id,
      threadRootId: undefined,
      deliveryId: message.delivery_id,
      leaseId: message.lease_id,
    }],
  ]);
});

test("a final bridge failure swallowed by a buffered dispatcher remains visible to the lease", async () => {
  const runtime = runtimeFor(async ({ adapter }) => {
    const turn = adapter.resolveTurn(adapter.ingest());
    await turn.delivery.deliver({ text: "answer" }, { kind: "final" }).catch(() => undefined);
  });
  const message = {
    chat_id: "t3ams:dm:peer",
    message_id: "inbound-message",
    text: "hello",
    conversation_type: "dm",
    sender_xid: "sender",
  };

  await assert.rejects(
    gateway.dispatchInbound(
      context,
      runtime,
      account,
      { send: async () => { throw new Error("terminal bridge outage"); } },
      message,
      new AbortController().signal,
    ),
    /terminal bridge outage/,
  );
});

test("gateway privately stages inbound files and returns generated files through the conversation vault", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "polkadot-openclaw-artifact-"));
  const imageBytes = Buffer.from("fake png bytes");
  const documentBytes = Buffer.from("%PDF-1.7\nprivate specification\n");
  let imagePath;
  let documentPath;
  try {
    const fetched = [];
    const bridge = {
      fetchMedia: async (url) => {
        fetched.push(url);
        if (url === "/media/photo") return new Response(imageBytes, { status: 200 });
        if (url === "/media/spec") return new Response(documentBytes, { status: 200 });
        throw new Error("unexpected media handle");
      },
      send: async () => ({ success: true, message_id: "outgoing" }),
    };
    const runtime = runtimeFor(async ({ adapter }) => {
      const input = adapter.ingest();
      imagePath = input.textForAgent.match(/saved at (.+?) \(image\/png, \d+ bytes\)/)?.[1];
      documentPath = input.textForAgent.match(/saved at (.+?) \(application\/pdf, \d+ bytes\)/)?.[1];
      assert.ok(imagePath, "the image path reaches the agent context");
      assert.ok(documentPath, "the document path reaches the agent context");
      assert.deepEqual(await readFile(imagePath), imageBytes);
      assert.deepEqual(await readFile(documentPath), documentBytes);
      await adapter.resolveTurn(input).delivery.deliver({ text: "Files received" });
    });
    await gateway.dispatchInbound(context, runtime, account, bridge, {
      chat_id: "t3ams:channel:workspace:files",
      message_id: "inbound-message",
      text: "Please review these",
      conversation_type: "channel",
      sender_xid: "sender",
      attachments: [
        { kind: "image", mime: "image/png", size: imageBytes.length, url: "/media/photo" },
        { kind: "document", mime: "application/pdf", size: documentBytes.length, url: "/media/spec" },
      ],
    }, new AbortController().signal);
    assert.deepEqual(fetched, ["/media/photo", "/media/spec"]);
    await assert.rejects(readFile(imagePath), { code: "ENOENT" });
    await assert.rejects(readFile(documentPath), { code: "ENOENT" });

    const artifactPath = path.join(tempDir, "report.pdf");
    const artifact = Buffer.from("%PDF-1.7\nagent report\n");
    await writeFile(artifactPath, artifact, { mode: 0o600 });
    const puts = [];
    const sends = [];
    const removed = [];
    await gateway.deliverOutboundReply({
      bridge: {
        putFile: async (...args) => { puts.push(args); },
        send: async (...args) => { sends.push(args); return { success: true, message_id: "outgoing" }; },
        removeFile: async (...args) => { removed.push(args); },
      },
      account,
      chatId: "t3ams:channel:workspace:files",
      replyTo: "inbound-message",
      threadRootId: "a".repeat(64),
      deliveryId: "delivery",
      leaseId: "lease",
      payload: { text: "Here is the report", mediaUrl: artifactPath, mimeType: "application/pdf" },
    });
    assert.equal(puts.length, 1);
    const [putChatId, vaultPath, uploadedBytes, mime] = puts[0];
    assert.equal(putChatId, "t3ams:channel:workspace:files");
    assert.match(vaultPath, /^openclaw\/[0-9a-f-]+-report\.pdf$/);
    assert.deepEqual(uploadedBytes, artifact);
    assert.equal(mime, "application/pdf");
    assert.equal(sends[0][2].filePath, vaultPath);
    assert.deepEqual(removed, [["t3ams:channel:workspace:files", vaultPath]]);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("bridge strips the OpenClaw channel namespace from every chat id", async () => {
  // OpenClaw hands back its own `polkadot:<hex>` address on sends that did not
  // originate in an inbound turn — attached results, heartbeat typing, and
  // delivery-recovery replays after a restart. bot-core rejects that form with
  // `invalid chat_id`, which silently dropped recovered deliveries.
  const { createBridge, peerChatId } = bridgeModule;
  const bare = "40d4fd1f9b35d2449cfc2a2d008cbf023ecfef7dd6a6d1daaf4b290964e94966";
  assert.equal(peerChatId(`polkadot:${bare}`), bare);
  assert.equal(peerChatId(bare), bare, "already-bare ids pass through unchanged");

  const requests = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    requests.push({ url: String(url), body: init?.body ? JSON.parse(init.body) : null });
    return new Response(JSON.stringify({ success: true, message_id: "M1" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  try {
    const bridge = createBridge("http://127.0.0.1:9999", "token");
    await bridge.send(`polkadot:${bare}`, "hi");
    await bridge.typing(`polkadot:${bare}`);
    await bridge.react(`polkadot:${bare}`, "MSG-1", "👍");
    for (const req of requests) {
      assert.equal(req.body.chat_id, bare, `namespaced chat id reached ${req.url}`);
    }
    assert.equal(requests.length, 3);
    // File-vault routes build the chat id into the URL path, not the body.
    requests.length = 0;
    await bridge.removeFile(`polkadot:${bare}`, "out.txt");
    assert.match(requests[0].url, new RegExp(`/files/${bare}/`), "vault URL must use the bare id");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
