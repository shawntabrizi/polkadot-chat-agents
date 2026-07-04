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
import logging
import os
from typing import Any, Dict, Optional

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


class PolkadotAdapter(BasePlatformAdapter):
    """Relays Polkadot app chat <-> Hermes via the local bot-core bridge."""

    def __init__(self, config, **kwargs):
        super().__init__(config=config, platform=Platform("polkadot"))
        extra = getattr(config, "extra", {}) or {}
        self.bridge_url = (
            os.getenv("POLKADOT_BRIDGE_URL") or extra.get("bridge_url") or _DEFAULT_BRIDGE_URL
        ).rstrip("/")
        self.max_message_length = _MAX_MESSAGE_LENGTH
        self._session: Optional[aiohttp.ClientSession] = None
        self._recv_task: Optional[asyncio.Task] = None
        self._running = False
        self._bot_account: Optional[str] = None

    @property
    def name(self) -> str:
        return "Polkadot"

    async def connect(self, *, is_reconnect: bool = False) -> bool:
        self._session = aiohttp.ClientSession()
        try:
            async with self._session.get(f"{self.bridge_url}/health", timeout=10) as resp:
                if resp.status != 200:
                    logger.error("Polkadot bridge health check failed: HTTP %s", resp.status)
                    await self._close_session()
                    return False
                health = await resp.json()
                self._bot_account = health.get("account")
                logger.info("Polkadot bridge healthy; bot account %s", self._bot_account)
        except Exception as exc:  # noqa: BLE001 — surface any connect failure
            logger.error("Cannot reach Polkadot bridge at %s: %s", self.bridge_url, exc)
            await self._close_session()
            return False

        self._running = True
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
        await self._close_session()

    async def _close_session(self) -> None:
        if self._session:
            await self._session.close()
            self._session = None

    async def _inbound_loop(self) -> None:
        """Long-poll the bridge for inbound chat messages and dispatch them."""
        backoff = 1.0
        while self._running:
            try:
                url = f"{self.bridge_url}/inbound?wait={_INBOUND_WAIT_SECS}"
                async with self._session.get(url, timeout=_INBOUND_WAIT_SECS + 10) as resp:
                    if resp.status != 200:
                        raise RuntimeError(f"inbound poll HTTP {resp.status}")
                    messages = await resp.json()
                backoff = 1.0
                for msg in messages or []:
                    await self._dispatch_inbound(msg)
            except asyncio.CancelledError:
                raise
            except Exception as exc:  # noqa: BLE001 — reconnect with backoff
                logger.warning("Polkadot inbound poll error: %s (retry in %.0fs)", exc, backoff)
                # Recreate the aiohttp session: a broken connector never self-heals
                # otherwise (e.g. after the bridge container restarts), which would
                # wedge the loop retrying against a dead connection forever.
                try:
                    if self._session and not self._session.closed:
                        await self._session.close()
                except Exception:  # noqa: BLE001
                    pass
                self._session = aiohttp.ClientSession()
                await asyncio.sleep(backoff)
                backoff = min(backoff * 2, 30.0)

    async def _dispatch_inbound(self, msg: Dict[str, Any]) -> None:
        chat_id = msg.get("chat_id")
        text = msg.get("text") or ""
        if not chat_id or not text:
            return
        source = self.build_source(
            chat_id=chat_id,
            chat_type="dm",
            user_id=chat_id,
            user_name=msg.get("user_name") or chat_id[:8],
            message_id=msg.get("message_id"),
        )
        event = MessageEvent(
            text=text,
            message_type=MessageType.TEXT,
            source=source,
            message_id=msg.get("message_id"),
        )
        await self.handle_message(event)

    async def send(self, chat_id: str, content: str, reply_to=None, metadata=None) -> SendResult:
        if not self._session:
            return SendResult(success=False, error="Polkadot bridge not connected")
        try:
            async with self._session.post(
                f"{self.bridge_url}/send",
                json={"chat_id": chat_id, "text": content},
                timeout=60,
            ) as resp:
                data = await resp.json()
                if resp.status == 200 and data.get("success"):
                    return SendResult(success=True, message_id=data.get("message_id"))
                return SendResult(success=False, error=data.get("error") or f"HTTP {resp.status}")
        except Exception as exc:  # noqa: BLE001
            return SendResult(success=False, error=str(exc), retryable=True)

    async def send_typing(self, chat_id: str, metadata=None) -> None:
        # Best-effort; the bridge may ignore this. Never fail the turn on it.
        if not self._session:
            return
        try:
            async with self._session.post(
                f"{self.bridge_url}/typing", json={"chat_id": chat_id}, timeout=5
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
        required_env=["POLKADOT_BRIDGE_URL"],
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
