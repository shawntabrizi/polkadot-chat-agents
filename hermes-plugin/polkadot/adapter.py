"""Hermes platform adapter for Polkadot app chat.

Thin BasePlatformAdapter that relays messages to/from a local Node "bot-core"
bridge over HTTP. The bridge owns the on-chain Statement Store transport
(identity, session encryption, subscribe/send); this adapter just:

  - long-polls  GET  {bridge}/inbound  -> dispatches inbound to Hermes
  - calls       POST {bridge}/send     -> publishes a reply to a peer

Mirrors the WhatsApp/Baileys Node-bridge pattern (Node bridge + Python adapter).
NOTE: untested end-to-end — pending the bot-core bridge implementation and a
configured Hermes install. See ../../docs/DESIGN.md (section 6b).
"""

import asyncio
from collections import deque
import logging
import mimetypes
import os
import re
import secrets
import shutil
import stat
import tempfile
from typing import Any, Awaitable, Callable, Deque, Dict, List, Optional, Set, Tuple
from urllib.parse import quote

import aiohttp

# BasePlatformAdapter and friends live in the Hermes core repo; import lazily
# so the plugin file can be linted/tested standalone.
from gateway.platforms.base import (  # type: ignore
    BasePlatformAdapter,
    MessageEvent,
    MessageType,
    SendResult,
)
from gateway.config import Platform  # type: ignore

logger = logging.getLogger(__name__)

_DEFAULT_BRIDGE_URL = "http://127.0.0.1:8799"
# Statement-store chat messages are small; keep well under any cap.
_MAX_MESSAGE_LENGTH = 4000
_INBOUND_WAIT_SECS = 25
_MAX_CONCURRENT_DISPATCHES = 4
_MAX_PENDING_DISPATCHES = 100
_MAX_ATTACHMENTS_PER_MESSAGE = 8
_MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024
_MAX_TOTAL_ATTACHMENT_BYTES = 32 * 1024 * 1024
# T3ams admits at most 25 MiB per encrypted BCTS attachment. The bridge
# advertises a possibly smaller PUT cap in /health, which wins per connection.
_MAX_OUTBOUND_ATTACHMENT_BYTES = 25 * 1024 * 1024
_OUTBOUND_UPLOAD_TIMEOUT_SECS = 120


def _safe_outbound_filename(value: Any) -> str:
    """Make a stable, inert filename for a bridge vault path and BCTS ref."""
    raw = os.path.basename(str(value or "").replace("\\", "/")).strip()
    # The T3ams attachment filename is user-visible. Keep a conventional
    # ASCII basename rather than passing through path separators, controls, or
    # terminal-sensitive Unicode controls from an agent-generated name.
    name = re.sub(r"[^A-Za-z0-9._-]+", "_", raw).strip("._")
    return (name or "attachment")[:120]


def _bridge_error(data: Any, status: int) -> str:
    """Use a bounded bridge error without assuming an error JSON shape."""
    if isinstance(data, dict) and isinstance(data.get("error"), str) and data["error"]:
        return data["error"][:300]
    return f"HTTP {status}"


def _channel_context_note(value: Any) -> str:
    """Render the bridge's bounded passive channel snapshot for an agent.

    Keep the actual triggering text first so Hermes command detection still
    sees a leading slash; context is attribution-rich, advisory history only.
    """
    if not isinstance(value, list):
        return ""
    lines: List[str] = []
    for record in value[:64]:
        if not isinstance(record, dict):
            continue
        text = record.get("text")
        if not isinstance(text, str) or not text:
            continue
        sender = record.get("sender_name") or record.get("sender_xid") or "channel member"
        lines.append(f"[Earlier channel message from {str(sender)[:512]}]: {text[:4096]}")
    return "\n\n" + "\n".join(lines) if lines else ""


class _BoundedKeyedDispatcher:
    """Bounded, ordered-per-chat worker pool for inbound bridge leases."""

    def __init__(self, max_concurrent: int, max_pending: int):
        self._max_pending = max_pending
        self._queues: Dict[str, Deque[Callable[[], Awaitable[None]]]] = {}
        self._ready: asyncio.Queue[str] = asyncio.Queue()
        self._scheduled_keys: Set[str] = set()
        self._running_keys: Set[str] = set()
        self._pending = 0
        self._closed = False
        self._capacity = asyncio.Condition()
        self._workers = [asyncio.create_task(self._worker()) for _ in range(max_concurrent)]

    async def submit(self, key: str, work: Callable[[], Awaitable[None]]) -> None:
        async with self._capacity:
            while not self._closed and self._pending >= self._max_pending:
                await self._capacity.wait()
            if self._closed:
                raise RuntimeError("Polkadot dispatcher is closed")
            queue = self._queues.setdefault(key, deque())
            queue.append(work)
            self._pending += 1
            self._schedule(key)

    async def close(self) -> None:
        if self._closed:
            return
        self._closed = True
        queued = sum(len(queue) for queue in self._queues.values())
        self._pending -= queued
        self._queues.clear()
        self._scheduled_keys.clear()
        async with self._capacity:
            self._capacity.notify_all()
        for worker in self._workers:
            worker.cancel()
        await asyncio.gather(*self._workers, return_exceptions=True)

    def _schedule(self, key: str) -> None:
        if key in self._running_keys or key in self._scheduled_keys or not self._queues.get(key):
            return
        self._scheduled_keys.add(key)
        self._ready.put_nowait(key)

    async def _worker(self) -> None:
        while True:
            key = await self._ready.get()
            self._scheduled_keys.discard(key)
            if self._closed:
                return
            queue = self._queues.get(key)
            if not queue:
                continue
            work = queue.popleft()
            if not queue:
                self._queues.pop(key, None)
            self._running_keys.add(key)
            try:
                await work()
            except asyncio.CancelledError:
                raise
            except Exception:  # noqa: BLE001 -- work records context before failing
                logger.exception("Unhandled Polkadot inbound dispatch task")
            finally:
                self._running_keys.discard(key)
                self._pending -= 1
                self._schedule(key)
                async with self._capacity:
                    self._capacity.notify_all()


class PolkadotAdapter(BasePlatformAdapter):
    """Relays Polkadot app chat <-> Hermes via the local bot-core bridge."""

    def __init__(self, config, **kwargs):
        super().__init__(config=config, platform=Platform("polkadot"))
        extra = getattr(config, "extra", {}) or {}
        self.bridge_url = (
            os.getenv("POLKADOT_BRIDGE_URL") or extra.get("bridge_url") or _DEFAULT_BRIDGE_URL
        ).rstrip("/")
        self.bridge_token = str(
            os.getenv("POLKADOT_BRIDGE_TOKEN") or extra.get("bridge_token") or ""
        ).strip()
        self.max_message_length = _MAX_MESSAGE_LENGTH
        self._session: Optional[aiohttp.ClientSession] = None
        self._recv_task: Optional[asyncio.Task] = None
        self._dispatcher: Optional[_BoundedKeyedDispatcher] = None
        self._attachment_dirs: Set[str] = set()
        # A T3ams bridge delivery may carry a thread root. The dispatcher is
        # ordered per chat, so this short-lived context safely routes Hermes's
        # synchronous answer (and command/error replies) back to that thread.
        self._active_thread_roots: Dict[str, Optional[str]] = {}
        # A bridge delivery is also a capability to publish a reply. Keep its
        # lease with the thread context for the duration of the synchronous
        # Hermes turn, so every bridge /send can prove it still owns the
        # inbound delivery that prompted the response.
        self._active_delivery_claims: Dict[str, Tuple[str, str]] = {}
        self._running = False
        self._bot_account: Optional[str] = None
        self._bridge_file_max_bytes = _MAX_OUTBOUND_ATTACHMENT_BYTES

    @property
    def name(self) -> str:
        return "Polkadot"

    async def connect(self, *, is_reconnect: bool = False) -> bool:
        if not self.bridge_token:
            logger.error("POLKADOT_BRIDGE_TOKEN (or platform extra.bridge_token) is required")
            return False
        self._session = self._new_session()
        try:
            async with self._session.get(f"{self.bridge_url}/health", timeout=10) as resp:
                # 503 means the bridge is up but its chain socket is down (an
                # RPC outage). /inbound and /send still work and the bridge
                # recovers on its own, so treat it as connected — refusing here
                # would wedge the platform until someone reconnects manually.
                if resp.status not in (200, 503):
                    logger.error("Polkadot bridge health check failed: HTTP %s", resp.status)
                    await self._close_session()
                    return False
                health = await resp.json()
                self._bot_account = health.get("account")
                files = health.get("files")
                advertised_file_cap = (
                    files.get("maxBridgeUploadBytes") if isinstance(files, dict) else None
                )
                if (
                    isinstance(advertised_file_cap, int)
                    and not isinstance(advertised_file_cap, bool)
                    and advertised_file_cap > 0
                ):
                    self._bridge_file_max_bytes = min(
                        advertised_file_cap, _MAX_OUTBOUND_ATTACHMENT_BYTES
                    )
                if resp.status == 503:
                    logger.warning(
                        "Polkadot bridge up but chain unreachable (bot account %s); continuing",
                        self._bot_account,
                    )
                else:
                    logger.info("Polkadot bridge healthy; bot account %s", self._bot_account)
        except Exception as exc:  # noqa: BLE001 — surface any connect failure
            logger.error("Cannot reach Polkadot bridge at %s: %s", self.bridge_url, exc)
            await self._close_session()
            return False

        self._running = True
        self._dispatcher = _BoundedKeyedDispatcher(
            _MAX_CONCURRENT_DISPATCHES, _MAX_PENDING_DISPATCHES
        )
        self._recv_task = asyncio.create_task(self._inbound_loop())
        return True

    async def disconnect(self) -> None:
        self._running = False
        if self._recv_task:
            self._recv_task.cancel()
            try:
                await self._recv_task
            except asyncio.CancelledError:
                pass
            self._recv_task = None
        if self._dispatcher:
            await self._dispatcher.close()
            self._dispatcher = None
        await self._cleanup_all_attachments()
        await self._close_session()

    def _new_session(self) -> aiohttp.ClientSession:
        """All bridge endpoints, including media, require the same bearer token."""
        return aiohttp.ClientSession(
            headers={"Authorization": f"Bearer {self.bridge_token}"}
        )

    async def _close_session(self) -> None:
        if self._session:
            await self._session.close()
            self._session = None

    async def _inbound_loop(self) -> None:
        """Long-poll bridge leases and schedule bounded, ordered chat work."""
        backoff = 1.0
        try:
            while self._running:
                try:
                    session = self._session
                    dispatcher = self._dispatcher
                    if not session or not dispatcher:
                        return
                    # Lease only a small multiple of worker capacity. Leasing a
                    # whole bridge backlog would let queued turns outlive their
                    # lease and be redelivered while still in this adapter.
                    url = f"{self.bridge_url}/inbound?wait={_INBOUND_WAIT_SECS}&limit={_MAX_CONCURRENT_DISPATCHES * 2}"
                    async with session.get(url, timeout=_INBOUND_WAIT_SECS + 10) as resp:
                        if resp.status != 200:
                            raise RuntimeError(f"inbound poll HTTP {resp.status}")
                        messages = await resp.json()
                    if not isinstance(messages, list):
                        raise RuntimeError("inbound poll returned a non-array payload")
                    backoff = 1.0
                    for msg in messages:
                        if not self._running:
                            break
                        if not isinstance(msg, dict):
                            logger.warning("Ignoring malformed Polkadot bridge delivery")
                            continue
                        chat_key = str(msg.get("chat_id") or "invalid")
                        await dispatcher.submit(
                            chat_key, lambda msg=msg: self._process_delivery(msg)
                        )
                except asyncio.CancelledError:
                    raise
                except Exception as exc:  # noqa: BLE001 -- reconnect with backoff
                    if not self._running:
                        break
                    logger.warning("Polkadot inbound poll error: %s (retry in %.0fs)", exc, backoff)
                    # Recreate the aiohttp session: a broken connector never
                    # self-heals after a bridge restart. Failed active jobs are
                    # left unacknowledged and will be redelivered by bot-core.
                    try:
                        if self._session and not self._session.closed:
                            await self._session.close()
                    except Exception:  # noqa: BLE001
                        pass
                    self._session = self._new_session()
                    await asyncio.sleep(backoff)
                    backoff = min(backoff * 2, 30.0)
        finally:
            # Stop queued jobs without acknowledging their leases. Active jobs
            # are cancelled too, so shutdown leaves bot-core to redeliver safely.
            if self._dispatcher:
                await self._dispatcher.close()
                self._dispatcher = None
            await self._cleanup_all_attachments()

    async def _fetch_attachments(
        self, attachments: List[Dict[str, Any]]
    ) -> Tuple[List[str], List[str], Optional[str]]:
        """Download bridge-served attachments to local files for vision access.

        bot-core has already pulled the encrypted blobs off the HOP node; the
        bridge serves them at /media/<id>. Hermes expects media as LOCAL file
        paths on the event (``media_urls``), which its vision pipeline base64s
        into image content parts — so fetch each one here.
        """
        paths: List[str] = []
        types: List[str] = []
        temp_dir: Optional[str] = None
        total_bytes = 0
        session = self._session
        if not session:
            raise RuntimeError("Polkadot bridge not connected")
        for index, a in enumerate(attachments[:_MAX_ATTACHMENTS_PER_MESSAGE]):
            if not isinstance(a, dict):
                logger.warning("Polkadot bridge attachment metadata is invalid")
                continue
            url = a.get("url")
            # `downloaded` is only a cache-status hint. T3ams can provide an
            # opaque authenticated /media capability before its asynchronous
            # prewarm completes; fetching that URL performs the same bounded
            # download on demand.
            if not (isinstance(url, str) and url.startswith("/media/")):
                logger.warning("Polkadot attachment %s is unavailable from the bridge", a.get("id"))
                continue
            advertised_bytes = a.get("size")
            remaining = _MAX_TOTAL_ATTACHMENT_BYTES - total_bytes
            if remaining <= 0 or (
                isinstance(advertised_bytes, int)
                and advertised_bytes > min(_MAX_ATTACHMENT_BYTES, remaining)
            ):
                logger.warning("Polkadot attachment %s exceeds the local download limit", a.get("id"))
                continue
            file_path: Optional[str] = None
            try:
                async with session.get(f"{self.bridge_url}{url}", timeout=60) as resp:
                    if resp.status != 200:
                        raise RuntimeError(f"HTTP {resp.status}")
                    if resp.content_length is not None and resp.content_length > min(
                        _MAX_ATTACHMENT_BYTES, remaining
                    ):
                        raise RuntimeError("attachment exceeds download limit")
                    if temp_dir is None:
                        temp_dir = await asyncio.to_thread(
                            tempfile.mkdtemp, prefix="polkadot-media-"
                        )
                        await asyncio.to_thread(os.chmod, temp_dir, 0o700)
                        self._attachment_dirs.add(temp_dir)
                    mime = str(a.get("mime") or "application/octet-stream")
                    suffix = mime.split("/", 1)[-1]
                    ext = re.sub(r"[^A-Za-z0-9]", "", suffix)[:16] or "bin"
                    file_path = os.path.join(temp_dir, f"attachment-{index}.{ext}")
                    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL
                    if hasattr(os, "O_NOFOLLOW"):
                        flags |= os.O_NOFOLLOW
                    received = 0
                    with os.fdopen(os.open(file_path, flags, 0o600), "wb") as output:
                        while True:
                            chunk = await resp.content.read(64 * 1024)
                            if not chunk:
                                break
                            received += len(chunk)
                            if received > min(_MAX_ATTACHMENT_BYTES, remaining):
                                raise RuntimeError("attachment exceeds download limit")
                            output.write(chunk)
                total_bytes += received
                paths.append(file_path)
                types.append(mime)
            except Exception as exc:  # noqa: BLE001 — a failed fetch must not drop the message
                if file_path:
                    try:
                        os.unlink(file_path)
                    except FileNotFoundError:
                        pass
                logger.warning("Polkadot attachment fetch failed for %s: %s", a.get("id"), exc)
        if len(attachments) > _MAX_ATTACHMENTS_PER_MESSAGE:
            logger.warning(
                "Skipped %s excess Polkadot attachments",
                len(attachments) - _MAX_ATTACHMENTS_PER_MESSAGE,
            )
        return paths, types, temp_dir

    async def _cleanup_attachments(self, temp_dir: Optional[str]) -> None:
        if temp_dir:
            try:
                await asyncio.to_thread(shutil.rmtree, temp_dir, ignore_errors=True)
            finally:
                self._attachment_dirs.discard(temp_dir)

    async def _cleanup_all_attachments(self) -> None:
        for temp_dir in tuple(self._attachment_dirs):
            await self._cleanup_attachments(temp_dir)

    async def _process_delivery(self, msg: Dict[str, Any]) -> None:
        """Run a leased message and acknowledge only a completed handoff."""
        delivery_id = msg.get("delivery_id")
        lease_id = msg.get("lease_id")
        if not isinstance(delivery_id, str) or not isinstance(lease_id, str):
            logger.warning("Polkadot bridge delivery is missing delivery_id or lease_id")
            return
        renewal_stop = asyncio.Event()
        renewal_task = asyncio.create_task(
            self._renew_lease_loop(
                delivery_id,
                lease_id,
                msg.get("lease_ms"),
                renewal_stop,
            )
        )
        try:
            handed_off = await self._dispatch_inbound(msg)
            if not handed_off:
                return
            # Prove lease ownership again immediately before the durable ACK.
            await self._renew_lease(delivery_id, lease_id)
            await self._acknowledge_with_retry(delivery_id, lease_id)
        except asyncio.CancelledError:
            raise
        except Exception as exc:  # noqa: BLE001 -- leave the lease for redelivery
            logger.warning("Polkadot dispatch failed; bridge delivery left unacknowledged: %s", exc)
        finally:
            renewal_stop.set()
            renewal_task.cancel()
            await asyncio.gather(renewal_task, return_exceptions=True)

    async def _renew_lease_loop(
        self,
        delivery_id: str,
        lease_id: str,
        lease_ms: Any,
        stop: asyncio.Event,
    ) -> None:
        """Keep an active turn leased without holding a whole backlog forever."""
        if isinstance(lease_ms, int) and lease_ms >= 1000:
            interval = max(0.25, min(60.0, lease_ms / 3000.0))
        else:
            interval = 60.0
        while not stop.is_set():
            try:
                await asyncio.wait_for(stop.wait(), timeout=interval)
                return
            except asyncio.TimeoutError:
                pass
            try:
                await self._renew_lease(delivery_id, lease_id)
            except asyncio.CancelledError:
                raise
            except Exception as exc:  # noqa: BLE001 -- final renewal before ACK retries it
                logger.warning("Polkadot lease renewal failed: %s", exc)

    async def _renew_lease(self, delivery_id: str, lease_id: str) -> None:
        session = self._session
        if not session:
            raise RuntimeError("Polkadot bridge not connected")
        async with session.post(
            f"{self.bridge_url}/inbound/renew",
            json={"delivery_id": delivery_id, "lease_id": lease_id},
            timeout=10,
        ) as resp:
            data = await resp.json(content_type=None)
            if not (200 <= resp.status < 300 and data.get("success") is True and data.get("renewed") == 1):
                raise RuntimeError(data.get("error") or f"HTTP {resp.status}")

    async def _acknowledge_with_retry(self, delivery_id: str, lease_id: str) -> None:
        session = self._session
        if not session:
            raise RuntimeError("Polkadot bridge not connected")
        last_error: Optional[Exception] = None
        for attempt in range(3):
            try:
                async with session.post(
                    f"{self.bridge_url}/inbound/ack",
                    json={"delivery_id": delivery_id, "lease_id": lease_id},
                    timeout=10,
                ) as resp:
                    data = await resp.json(content_type=None)
                    if (
                        200 <= resp.status < 300
                        and data.get("success") is True
                        and data.get("acknowledged") == 1
                    ):
                        return
                    raise RuntimeError(data.get("error") or f"HTTP {resp.status}")
            except Exception as exc:  # noqa: BLE001 -- retry transient bridge failures
                last_error = exc
                await asyncio.sleep(0.25 * (attempt + 1))
        raise last_error or RuntimeError("inbound acknowledgement failed")

    async def _dispatch_inbound(self, msg: Dict[str, Any]) -> bool:
        chat_id = msg.get("chat_id")
        text = msg.get("text") or ""
        if not chat_id or not text:
            logger.warning("Polkadot bridge delivery is missing chat_id or text")
            return False
        delivery_id = msg.get("delivery_id")
        lease_id = msg.get("lease_id")
        if (
            not isinstance(delivery_id, str)
            or not delivery_id
            or not isinstance(lease_id, str)
            or not lease_id
        ):
            logger.warning("Polkadot bridge delivery is missing delivery_id or lease_id")
            return False
        attachments = msg.get("attachments") or []
        if not isinstance(attachments, list):
            raise RuntimeError("bridge delivery attachments must be an array")
        media_paths, media_types, temp_dir = await self._fetch_attachments(attachments)
        thread_root = msg.get("thread_root_id")
        if not isinstance(thread_root, str) or not thread_root:
            thread_root = None
        had_previous_root = chat_id in self._active_thread_roots
        previous_root = self._active_thread_roots.get(chat_id)
        previous_claim = self._active_delivery_claims.get(chat_id)
        self._active_thread_roots[chat_id] = thread_root
        self._active_delivery_claims[chat_id] = (delivery_id, lease_id)
        try:
            sender_id = msg.get("sender_xid") or chat_id
            sender_name = msg.get("sender_name") or msg.get("user_name") or str(sender_id)[:8]
            source = self.build_source(
                chat_id=chat_id,
                chat_type="group" if msg.get("conversation_type") == "channel" else "dm",
                user_id=sender_id,
                user_name=sender_name,
                message_id=msg.get("message_id"),
            )
            is_photo = any(t.startswith("image/") for t in media_types)
            event = MessageEvent(
                text=text + _channel_context_note(msg.get("channel_context")),
                message_type=MessageType.PHOTO if is_photo else MessageType.TEXT,
                source=source,
                message_id=msg.get("message_id"),
                media_urls=media_paths,
                media_types=media_types,
                reply_to_message_id=thread_root or msg.get("reply_to"),
            )
            await self.handle_message(event)
            return True
        finally:
            if had_previous_root:
                self._active_thread_roots[chat_id] = previous_root
            else:
                self._active_thread_roots.pop(chat_id, None)
            if previous_claim is not None:
                self._active_delivery_claims[chat_id] = previous_claim
            else:
                self._active_delivery_claims.pop(chat_id, None)
            await self._cleanup_attachments(temp_dir)

    def _add_active_delivery_claim(self, chat_id: str, body: Dict[str, Any]) -> None:
        """Attach the inbound lease that authorizes this synchronous reply."""
        claim = self._active_delivery_claims.get(chat_id)
        if claim is not None:
            body["delivery_id"], body["lease_id"] = claim

    async def send(self, chat_id: str, content: str, reply_to=None, metadata=None) -> SendResult:
        if not self._session:
            return SendResult(success=False, error="Polkadot bridge not connected")
        try:
            body: Dict[str, Any] = {"chat_id": chat_id, "text": content}
            thread_root = self._active_thread_roots.get(chat_id)
            if thread_root:
                body["thread_root_id"] = thread_root
            self._add_active_delivery_claim(chat_id, body)
            if reply_to:
                body["reply_to"] = str(reply_to)
            async with self._session.post(
                f"{self.bridge_url}/send",
                json=body,
                timeout=60,
            ) as resp:
                data = await resp.json()
                if resp.status == 200 and data.get("success"):
                    return SendResult(success=True, message_id=data.get("message_id"))
                return SendResult(success=False, error=data.get("error") or f"HTTP {resp.status}")
        except Exception as exc:  # noqa: BLE001
            return SendResult(success=False, error=str(exc), retryable=True)

    def _bridge_file_url(self, chat_id: str, vault_path: str) -> str:
        """Address one conversation-scoped bridge vault file safely."""
        return (
            f"{self.bridge_url}/files/{quote(str(chat_id), safe='')}"
            f"/{quote(vault_path, safe='/')}"
        )

    async def _stage_outbound_file(
        self,
        chat_id: str,
        file_path: str,
        *,
        file_name: Optional[str] = None,
    ) -> str:
        """Copy one approved Hermes artifact into the chat's bridge vault.

        The bridge deliberately accepts a vault-relative name, never a host
        path. A random intermediate directory prevents concurrent outputs with
        the same display name from replacing each other, while the final path
        segment remains the clean filename carried in the T3ams attachment.
        """
        session = self._session
        if not session:
            raise RuntimeError("Polkadot bridge not connected")
        safe_path = self.validate_media_delivery_path(str(file_path or ""))
        if not safe_path:
            raise ValueError("attachment path is not approved for native delivery")

        descriptor: Optional[int] = None
        try:
            flags = os.O_RDONLY
            if hasattr(os, "O_NOFOLLOW"):
                flags |= os.O_NOFOLLOW
            descriptor = os.open(safe_path, flags)
            source_stat = os.fstat(descriptor)
            if not stat.S_ISREG(source_stat.st_mode):
                raise ValueError("attachment must be a regular file")
            if source_stat.st_size > self._bridge_file_max_bytes:
                raise ValueError(
                    f"attachment exceeds the Polkadot bridge limit ({self._bridge_file_max_bytes} bytes)"
                )

            display_name = _safe_outbound_filename(file_name or safe_path)
            vault_path = f"hermes/{secrets.token_hex(12)}/{display_name}"
            mime = mimetypes.guess_type(display_name)[0] or "application/octet-stream"
            # Keep the descriptor open from approval through upload, so a
            # symlink swap cannot make the bridge read a different host file.
            with os.fdopen(descriptor, "rb") as source:
                descriptor = None
                async with session.put(
                    self._bridge_file_url(chat_id, vault_path),
                    data=source,
                    headers={"Content-Type": mime},
                    timeout=_OUTBOUND_UPLOAD_TIMEOUT_SECS,
                ) as resp:
                    try:
                        data = await resp.json(content_type=None)
                    except (aiohttp.ContentTypeError, ValueError):
                        data = {}
                    if not (200 <= resp.status < 300 and isinstance(data, dict) and data.get("success") is True):
                        raise RuntimeError(f"bridge file upload failed: {_bridge_error(data, resp.status)}")
            return vault_path
        except ValueError:
            raise
        except OSError as exc:
            # Avoid returning a host path from an OS exception to the chat.
            raise RuntimeError("could not open attachment for upload") from exc
        finally:
            if descriptor is not None:
                try:
                    os.close(descriptor)
                except OSError:
                    pass

    async def _remove_staged_outbound_file(self, chat_id: str, vault_path: str) -> None:
        """Best-effort cleanup after bot-core has finished the HOP upload."""
        session = self._session
        if not session:
            return
        try:
            async with session.delete(self._bridge_file_url(chat_id, vault_path), timeout=10) as resp:
                # Missing is also a successful cleanup: an operator may have
                # pruned the vault while a slow transport send was in flight.
                if resp.status not in (200, 404):
                    logger.debug("Polkadot staged file cleanup returned HTTP %s", resp.status)
        except Exception as exc:  # noqa: BLE001 -- stale staging data is non-fatal
            logger.debug("Polkadot staged file cleanup failed: %s", exc)

    async def _send_file_attachment(
        self,
        chat_id: str,
        file_path: str,
        *,
        caption: Optional[str] = None,
        file_name: Optional[str] = None,
        reply_to: Optional[str] = None,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> SendResult:
        """Stage a local Hermes artifact then publish it as a T3ams attachment."""
        del metadata  # Thread routing follows the same active-delivery path as send().
        if not self._session:
            return SendResult(success=False, error="Polkadot bridge not connected")
        vault_path: Optional[str] = None
        try:
            vault_path = await self._stage_outbound_file(
                chat_id, file_path, file_name=file_name
            )
            body: Dict[str, Any] = {"chat_id": chat_id, "file_path": vault_path}
            if isinstance(caption, str) and caption:
                body["text"] = caption
            thread_root = self._active_thread_roots.get(chat_id)
            if thread_root:
                body["thread_root_id"] = thread_root
            self._add_active_delivery_claim(chat_id, body)
            if reply_to:
                body["reply_to"] = str(reply_to)
            async with self._session.post(
                f"{self.bridge_url}/send",
                json=body,
                timeout=_OUTBOUND_UPLOAD_TIMEOUT_SECS,
            ) as resp:
                try:
                    data = await resp.json(content_type=None)
                except (aiohttp.ContentTypeError, ValueError):
                    data = {}
                if resp.status == 200 and isinstance(data, dict) and data.get("success"):
                    return SendResult(success=True, message_id=data.get("message_id"))
                return SendResult(success=False, error=_bridge_error(data, resp.status))
        except ValueError as exc:
            return SendResult(success=False, error=str(exc))
        except Exception as exc:  # noqa: BLE001
            logger.warning("Polkadot attachment delivery failed: %s", exc)
            # _stage_outbound_file deliberately wraps local OS failures, so
            # this can safely preserve actionable bridge transport errors.
            return SendResult(success=False, error=str(exc)[:300], retryable=True)
        finally:
            if vault_path:
                # /send does the encrypted HOP upload before it returns, so
                # this transient harness staging record is safe to remove.
                await self._remove_staged_outbound_file(chat_id, vault_path)

    async def send_document(
        self,
        chat_id: str,
        file_path: str,
        caption: Optional[str] = None,
        file_name: Optional[str] = None,
        reply_to: Optional[str] = None,
        metadata: Optional[Dict[str, Any]] = None,
        **kwargs,
    ) -> SendResult:
        del kwargs
        return await self._send_file_attachment(
            chat_id,
            file_path,
            caption=caption,
            file_name=file_name,
            reply_to=reply_to,
            metadata=metadata,
        )

    async def send_image_file(
        self,
        chat_id: str,
        image_path: str,
        caption: Optional[str] = None,
        reply_to: Optional[str] = None,
        metadata: Optional[Dict[str, Any]] = None,
        **kwargs,
    ) -> SendResult:
        del kwargs
        return await self._send_file_attachment(
            chat_id,
            image_path,
            caption=caption,
            reply_to=reply_to,
            metadata=metadata,
        )

    async def send_voice(
        self,
        chat_id: str,
        audio_path: str,
        caption: Optional[str] = None,
        reply_to: Optional[str] = None,
        metadata: Optional[Dict[str, Any]] = None,
        **kwargs,
    ) -> SendResult:
        del kwargs
        return await self._send_file_attachment(
            chat_id,
            audio_path,
            caption=caption,
            reply_to=reply_to,
            metadata=metadata,
        )

    async def send_video(
        self,
        chat_id: str,
        video_path: str,
        caption: Optional[str] = None,
        reply_to: Optional[str] = None,
        metadata: Optional[Dict[str, Any]] = None,
        **kwargs,
    ) -> SendResult:
        del kwargs
        return await self._send_file_attachment(
            chat_id,
            video_path,
            caption=caption,
            reply_to=reply_to,
            metadata=metadata,
        )

    async def edit_message(
        self,
        chat_id: str,
        message_id: str,
        content: str,
        *,
        finalize: bool = False,
    ) -> SendResult:
        """Edit a previously sent message in place (bot-core kind-12 edit).

        Overriding this switches on Hermes's progressive streaming machinery
        (placeholder message edited with the growing answer). bot-core
        throttles and coalesces edits server-side to the statement-store-safe
        cadence, so Hermes's ~0.8s edit rate is safe to pass through.
        """
        if not self._session:
            return SendResult(success=False, error="Polkadot bridge not connected")
        try:
            body: Dict[str, Any] = {"chat_id": chat_id, "text": content, "edit_of": message_id}
            self._add_active_delivery_claim(chat_id, body)
            async with self._session.post(
                f"{self.bridge_url}/send",
                json=body,
                timeout=60,
            ) as resp:
                data = await resp.json()
                if resp.status == 200 and data.get("success"):
                    return SendResult(success=True, message_id=data.get("message_id") or message_id)
                return SendResult(success=False, error=data.get("error") or f"HTTP {resp.status}")
        except Exception as exc:  # noqa: BLE001
            return SendResult(success=False, error=str(exc), retryable=True)

    async def send_typing(self, chat_id: str, metadata=None) -> None:
        # Best-effort; the bridge may ignore this. Never fail the turn on it.
        if not self._session:
            return
        try:
            body: Dict[str, Any] = {"chat_id": chat_id}
            self._add_active_delivery_claim(chat_id, body)
            async with self._session.post(
                f"{self.bridge_url}/typing", json=body, timeout=5
            ):
                pass
        except Exception:  # noqa: BLE001
            pass

    async def get_chat_info(self, chat_id: str) -> Dict[str, Any]:
        return {"name": chat_id[:8], "type": "dm", "chat_id": chat_id}


def check_requirements() -> bool:
    """aiohttp is the only dependency (already used across Hermes)."""
    try:
        import aiohttp  # noqa: F401
        return True
    except ImportError:
        return False


def register(ctx):
    """Plugin entry point: called by the Hermes plugin system."""
    ctx.register_platform(
        name="polkadot",
        label="Polkadot",
        adapter_factory=lambda cfg: PolkadotAdapter(cfg),
        check_fn=check_requirements,
        required_env=["POLKADOT_BRIDGE_URL", "POLKADOT_BRIDGE_TOKEN"],
        install_hint="Runs the Node bot-core bridge; no extra Python packages needed",
        allowed_users_env="POLKADOT_ALLOWED_USERS",
        allow_all_env="POLKADOT_ALLOW_ALL_USERS",
        max_message_length=_MAX_MESSAGE_LENGTH,
        emoji="🔴",
        pii_safe=False,
        platform_hint=(
            "You are chatting via the Polkadot app's built-in chat. Use plain, "
            "concise text — no markdown rendering. Each user is identified by an "
            "on-chain account id. Keep replies short and conversational."
        ),
    )
