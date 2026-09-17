# Research: Telegram bot features

As of 2026-09-17. Telegram Bot API 10.3 (2026-08-24).

The goal is a bot chat experience as good as Telegram's. This document lists
the Telegram features that make that experience, and where Polkadot chat is
for each one.

Sources:

- [Telegram Bot Features](https://core.telegram.org/bots/features) and the
  [Bot API](https://core.telegram.org/bots/api) changelog, read on 2026-09-17.
- Numbers marked *(memory)* are not checked against the API reference. The
  page is too long for the fetch tool. Check them before you rely on them.
- The "Polkadot chat now" column comes from `docs/explanation/protocol.md`,
  `docs/guide/commands.md`, `bot-core/lib/live-reply.mjs` and the client
  survey of 2026-09-04. "Not examined" means nobody looked.

## Summary

Six feature groups make most of the difference in a 1:1 chat with an AI agent:

1. **Rich text that looks the same on each client.** Formatting is structured
   data, not markdown text that each client parses in its own way.
2. **Buttons below a message.** A tap sends a silent callback to the bot. The
   bot then edits the message in place.
3. **A command menu.** The user sees what the bot can do and does not type
   from memory.
4. **Live feedback.** A typing indicator and a streamed answer show that the
   bot works.
5. **A bot identity.** A badge, a profile, a description and a share link tell
   the user what they talk to.
6. **Payments in the chat.** An invoice message, a pay button and a receipt,
   with no external checkout.

One design fact is behind all of them: **the bot declares, the client
renders.** A Telegram bot never draws UI. It sends typed data (entities,
button rows, a command list, an invoice). Each client draws that data with
native controls. Thus one bot gives the same experience on iOS, Android,
desktop and web.

## 1. Identity and discovery

| Telegram feature | What the user gets | Polkadot chat now |
|---|---|---|
| Username, 5–32 characters, must end in `bot` | The name itself says "this is a bot". Search finds it. | Usernames exist (`name.NN`). No bot rule in the name. |
| Bot badge in the chat header and the chat list | No confusion between a bot and a person | No client distinguishes bots from people (app ask 8). This is also the gate for bot sponsorship. |
| Profile: name, picture, about text (120 characters), description (512 characters) | The description shows in the empty chat, before the first message. It says what the bot does. | No bot profile. The welcome text of the chat request is the only introduction. |
| Deep link `t.me/<bot>?start=<param>` (64 characters, `A-Za-z0-9_-`) | One tap opens the chat and gives the bot a parameter: a referral, an order id, a login token | No link format that opens a chat with a bot and carries a parameter. |
| BotFather: a bot that makes and configures bots | Setup in the chat app, no web console | `pca create` on the command line. Friendly, but not in the app. |
| Ownership transfer, token reset | The owner can hand over or recover a bot | `--owner` at creation. Transfer not examined. |
| Localised name, description and commands; `language_code` in each update | The bot answers in the user's language from the first message | No language field on the wire. |

## 2. Commands and chat entry

| Telegram feature | What the user gets | Polkadot chat now |
|---|---|---|
| A **Start** button replaces the text input in a new bot chat | The first action is one tap. The bot gets `/start` and can answer first. | The user sends a chat request with welcome text. The bot accepts. |
| Bots cannot message a user first | No bot spam. The user always starts. | Same result: the request and accept flow gates it. |
| Command list that the bot declares (`setMyCommands`, 100 commands *(memory)*, names up to 32 characters) | Type `/` and get a list with descriptions. Tap to send. | bot-core has `/help`, `/reset`, `/stop`, `/model`, `/reasoning`, `/project`, `/file`, `/usage`, `/ping`. The app shows nothing: the user must type them (app ask 8). The first reply carries a `/help` hint as a workaround. |
| Command scopes: per chat type, per chat, per user, per language | An admin sees admin commands. A user does not. | None. |
| Menu button next to the input | Opens the command list or a Mini App | None. |
| Commands are highlighted and tappable in any message | The bot can write "send /reset to start again" and the user taps it | None. Plain text. |
| Standard commands `/start`, `/help`, `/settings` | The same habits work with each bot | `/help` is there. No `/start`, no `/settings`. |

## 3. Message content

| Telegram feature | What the user gets | Polkadot chat now |
|---|---|---|
| Formatting as entities (offset, length, type): bold, italic, underline, strikethrough, spoiler, code, pre with a language, text link, blockquote, expandable blockquote, custom emoji, date and time | The same look on each client. The bot writes MarkdownV2 or HTML. The server turns it into entities. | The spec says text is markdown. iOS renders inline markdown only. Android only makes raw URLs into links. Desktop renders plain text (app ask 1, the headline ask). The wire has a `richText` kind (15). |
| Rich messages (Bot API 10.1): headings, tables, LaTeX, collapsible blocks, footnotes, buttons in the text | Long agent answers read like a document | None. A table arrives as `\| pipes \|`. |
| Text up to 4096 characters, caption up to 1024 *(memory)* | Long answers split in a known way | bot-core splits at 4000 bytes (`lib/chunk.mjs`). |
| Media: photo, video, audio, voice, video note, document, animation, album, live photo, location, venue, contact | One `send*` method for each kind. The client shows a native bubble. | Photos, videos and files go through HOP. Desktop cannot claim HOP files. Voice, location and contact not examined. |
| Edit text, caption, media and buttons of a sent message | The bot updates a message in place. No new notification. | `edited` (12) exists. Each edit is a permanent row in the app's edit history (app ask 2). |
| Delete a message | The bot removes status messages and menus | Not on the wire. RFC-0003 is open and not implemented. |
| Reply and quote | Threaded answers | `reply` (7) exists and works in both directions. |
| Reactions: the bot sets them and gets an update when the user reacts | A thumbs-up is a cheap ACK or a feedback signal | `reacted` and `reactionRemoved` exist. bot-core records them and gives them to bridge pollers. It never answers them. |
| Link preview, with options (off, small, large, above the text) | A link becomes a card | None (app ask 8). No server can fetch the page. The sender or the client must do it. |
| Stickers and custom emoji. Bots make and edit sticker sets. | Personality and brand | None. NFT stickers are on the roadmap and need a chat-spec RFC. |
| Polls, quizzes, checklists, dice | Structured input with no custom UI | None. |
| Spoiler, protected content (no forward, no save) | Control of sensitive output | None. |

## 4. Interactive controls

This group is the largest gap. It is also what makes a Telegram bot feel like
an app and not like a command line.

| Telegram feature | What the user gets | Polkadot chat now |
|---|---|---|
| Inline keyboard: rows of buttons attached below one message | Choices next to the content they belong to | None. |
| Callback button (`callback_data`, 1–64 bytes *(memory)*) | A tap sends a hidden update to the bot. No message appears in the chat. | None. The bot must ask the user to type a number or a word. |
| `answerCallbackQuery`: a toast or an alert, and the end of the button spinner | Instant feedback for the tap, with no chat message | None. |
| Edit the message after a tap | Menus, pagination, wizards and confirm dialogs in one bubble | Possible with `edited`, but each step adds an edit-history row. |
| URL button, login button, copy-text button, pay button, Mini App button, switch-to-inline button | One tap for the common actions | None. A URL in the text is the only option. Android makes raw URLs tappable. iOS renders markdown links. Desktop does neither. |
| Reply keyboard: buttons that replace the phone keyboard. One-time, resizable, with a placeholder. | Fast answers from a fixed set. The tap sends normal text. | None. |
| Force reply | The client opens a reply to the bot's question. Useful for step-by-step forms. | None. |
| Request buttons: share a contact, a location, a user, a chat, or make a poll | The user picks from a native list. The bot gets ids, not typed text. | None. |
| Ephemeral messages (new in 10.x) | A bot answer in a group that only one user sees | None. |

## 5. Live feedback

| Telegram feature | What the user gets | Polkadot chat now |
|---|---|---|
| Chat action: typing, upload photo, record voice, and more. Lasts about 5 seconds *(memory)* or until the message arrives. | "bot is typing…" in the header. It is never stored. | Not on the wire (RFC-0003). bot-core sends a placeholder message after 5 seconds (`BOT_THINKING_AFTER_MS`). |
| Streaming replies: `sendMessageDraft` shows the answer while the model writes it. An empty draft shows "Thinking…". | The user reads the answer as it grows. One message, one notification, no edit history. | bot-core edits the placeholder in place with a throttle that escalates, then sends the answer as a **new** message. Reasons: an edit raises no notification, each edit is a history row, and the store holds one statement per channel. |
| Stop button on a streamed reply (`can_stop`, `keep_on_stop`) | The user cancels a long turn with one tap | `/stop` as typed text. |
| Callback toast | See section 4 | None. |
| Status alerts from BotFather when the reply rate falls | The owner learns that the bot is down | `/ping` and `pca status`. No alert. |

## 6. Inline mode, Mini Apps and login

| Telegram feature | What the user gets | Polkadot chat now |
|---|---|---|
| Inline mode: type `@bot query` in **any** chat, pick a result, and send it as yourself | The bot is a tool in each conversation, not only a contact | None. It would need a client feature plus a query channel to the bot. |
| Mini Apps: a web app in a sheet in the chat, with theme, main button, storage, full screen and home-screen shortcut | Full UI when chat is not enough: shops, games, dashboards | The Polkadot app has in-app products (Triangle hosts). No link from a bot message to a product. |
| Web login: the login widget and the `login_url` button | "Log in with Telegram" on the bot owner's site, with a signed payload | None from chat. RFC-0009 login exists for products. |
| Attachment menu bots | A bot in the attach sheet of each chat | None. |
| HTML5 games with high scores | Light engagement | None. |

## 7. Payments

| Telegram feature | What the user gets | Polkadot chat now |
|---|---|---|
| Invoice message: title, description, photo, price lines, a **Pay** button | A native checkout in the chat | None. A user can send Coinage to a bot (`coinageSend`, 16). bot-core logs it and does not claim it. |
| The flow: `sendInvoice` → `pre_checkout_query` (the bot must answer in 10 seconds *(memory)*) → `successful_payment` service message | The bot can refuse the order at the last moment (out of stock). The receipt is a message in the chat. | No request, no confirm step, no receipt kind. |
| Telegram Stars (`XTR`) for digital goods; card providers for physical goods | One balance, in-app purchase, no card form | Coinage is the native asset. `summit-faucet-chatbot` proves that a bot can send Coinage and the app can claim it. |
| Subscriptions (`subscription_period`), paid media (pay to unlock a photo or video), refunds (`refundStarPayment`), gifts | Recurring income, pay for each item, a safe refund path | None. The roadmap has payments to bots with per-peer accounting (pay-as-you-go inference, unlock features). |
| Invoice links and deep links to an invoice | Sell outside the chat, pay in the chat | None. |
| 50% share of the ad income in the bot's chat | Income without charging the user | Not applicable. |

## 8. Files

| Telegram feature | What the user gets | Polkadot chat now |
|---|---|---|
| Upload 50 MB, download 20 MB through the cloud Bot API. 2000 MB and no download limit with a local Bot API server. | Known limits | HOP carries attachments. Normative size and allowance numbers are not published (app ask 5). A bot needs a Bulletin allowance to upload (app ask 3). |
| `file_id`: send a file that Telegram already holds by its id, with no new upload | Instant re-send and cheap broadcast | None. Each send is a new HOP entry. A claimed entry is gone. |
| Send by URL: Telegram fetches the file | The bot host needs no bandwidth | None. There is no server to fetch. |
| Thumbnails, dimensions, duration, file name and MIME type in the message | The client draws the bubble before the download | Attachment metadata exists. Its completeness is not examined. |
| — | — | bot-core adds a per-chat file store (`/file put`, `/file get`) that Telegram does not have. |

## 9. Groups, channels and topics

| Telegram feature | What the user gets | Polkadot chat now |
|---|---|---|
| Bots in groups, with privacy mode: the bot sees only commands, replies to it and mentions, unless it is an admin | Safe to add a bot to a group | Group chat with bots not examined in the mobile protocol. T3ams workspaces are a separate integration. |
| `/command@bot` addressing, mentions | Several bots in one group | None. |
| Admin functions: moderate, pin, invite links, join requests | Community bots | None. |
| Topics in private chats with a bot | One bot, many threads: one for each project or task. A good fit for coding agents. | None. `/project` and `/reset` in bot-core are the manual version. |
| Business bots ("secretary mode") | A bot answers in the name of a person, with rights that the person gives | None. |
| Bot-to-bot mode, guest bots, managed bots (10.x) | Agents that call other agents, with loop rules. A bot joins by mention with no membership. A bot makes bots for users. | None. Two bots that chat make an infinite loop today (see `CLAUDE.md`, Housekeeping). |
| Channels: broadcast, suggested posts, channel direct messages | One-to-many publishing | None. |

## 10. Developer platform

| Telegram feature | What the developer gets | Polkadot chat now |
|---|---|---|
| Bot API: plain HTTPS and JSON. One token. No cryptography and no state in the bot. | A bot in 20 lines in any language | bot-core holds the keys, the sessions, the ACK journal and the outbound lanes. The bridge (`/inbound`, HTTP) gives a framework a similar plain surface. |
| `getUpdates` (long poll) or a webhook (ports 443, 80, 88, 8443; 1–100 connections). The server keeps updates for 24 hours. | The bot can be offline for a day and lose nothing | The store keeps **one** statement for each (account, channel). The sender resends until it sees an ACK. Offline tolerance depends on statement expiry. |
| One ordered `update_id` stream with typed updates: message, edited message, callback query, reaction, payment, membership | Simple dedup and simple routing | bot-core keeps a dedup set in `session-state.json` and polls each device session. |
| Rate limits: about 30 messages a second in total, 1 a second for each chat, 20 a minute for each group *(memory)* | Known send budget | Limits come from statement allowances. Numbers not published (app ask 5). |
| Test environment with separate accounts and bots | Safe tests against real clients | The sandbox (`pcs`), plus Paseo and devnet. The sandbox is stronger for fault injection. Telegram has nothing like `pcs fault`. |
| Local Bot API server | Large files, any port, no TLS | Not applicable. There is no gateway. |
| Push notifications for each bot message | The user learns that the answer arrived | Headless bot senders do not raise a push (app ask 4). |

## 11. Trust and safety

| Telegram rule | Effect | Polkadot chat now |
|---|---|---|
| The user starts. The user can block or stop the bot at any time. | No unsolicited bot messages | Request and accept. Block not examined. |
| Bot chats are cloud chats. They are **not** end-to-end encrypted. Bots cannot join secret chats. | The server can read each bot conversation | End-to-end encrypted for each device session. This is an advantage. Its cost is sections 5, 8 and 10: no server to stream drafts, keep files or queue updates. |
| Privacy mode in groups is on by default | A bot does not read the whole group | Not examined. |
| A central registry (BotFather) can revoke a bot | Abuse control | Registration is on chain. Revocation and allowance removal are a rollout gate (project 297). |
| A bot account has no phone number and cannot log in to a client | A bot cannot act as a person | A bot is a lite person on the People chain. Clients cannot see the difference yet. |

## Priority order

This is a recommendation. It puts first what changes the daily experience of a
1:1 agent chat, and what the current workarounds in bot-core show as pain.

| # | Feature | Why now | Where the work is |
|---|---|---|---|
| 1 | Rich text on each client | Each agent answer has markdown. Users see raw `**` and pipes today. | Apps. chat-spec must say which markdown subset is normative. Consider entities: they end the parser differences. |
| 2 | Bot badge and bot profile (description, command list) | Users must know what they talk to. It gates sponsorship. | The People chain or the bot's chat-accept message holds the profile. Apps render it. |
| 3 | Typing and a draft (streaming) kind that is never stored as history | It removes the placeholder-and-edit workaround and its edit-history noise. | chat-spec RFC-0003, plus a new draft kind. Prototype in the sandbox personas and bot-core. |
| 4 | Command menu | The commands exist already. Only the display is missing. | Depends on 2 for the list. Apps: a `/` menu and tappable commands. |
| 5 | Inline buttons and callbacks | The largest gap in capability. It makes confirm dialogs, menus, model pickers and approvals for agent tools possible. | New content kinds: a button row on a message, and a callback message that clients do not show. Sandbox first. |
| 6 | Payments: invoice, pay button, receipt | The roadmap goal. It needs 5 for the pay button. | The Coinage claim in bot-core, an invoice kind, the `local` sandbox profile. |
| 7 | Deep links with a start parameter | Cheap. It makes bots shareable and gives login and referral flows. | A link format in the apps, and a parameter in the chat request. |
| 8 | Delete, push notifications, link previews | Polish that users notice | RFC-0003, app asks 4 and 8. |
| 9 | Stickers, polls, topics in a bot chat | Good to have. Topics fit coding agents well. | chat-spec RFCs. |
| — | Inline mode, Mini Apps, groups, channels, business bots, games | Large, and not necessary for a great 1:1 agent chat | Later. |

Open design question for 1, 2 and 5: Telegram's server converts markdown to
entities, keeps the bot profile and routes callbacks. Polkadot chat has no
server. Each feature needs a home: the wire format, the chain, the statement
store, or the client.
