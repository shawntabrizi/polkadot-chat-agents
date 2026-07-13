# Projects & worktrees

By default a direct-engine bot works in one shared workspace. Projects let a
conversation target a specific repository — and, optionally, an isolated git
worktree per branch.

## Registering a project

```bash
pca project mybot add sdk /repos/polkadot-sdk
pca project mybot add docs /repos/my-docs
pca project mybot            # list
pca project mybot rm sdk     # remove
```

Each registered directory becomes an alias the bot can work in. Aliases are
validated (lowercase letters, digits, dashes, and underscores).

## Switching in chat

- `/project` — list the projects and show the current one.
- `/project sdk` — point this conversation at the `sdk` repo root.
- `/project sdk@feature-x` — work on branch `feature-x` in an **isolated git
  worktree**, created on first use under the bot's workspace.
- `/project default` — return to the shared workspace.

The bare `/sdk` and `/sdk @feature-x` forms are shortcuts for the same thing.

## Per-peer, and session-scoped

Projects are **per-peer**: two people can work in different repositories with
the same bot at the same time. The active project persists across restarts.

Each switch starts a **fresh engine session** — a resumed native session is
only valid in the directory it started in, so changing cwd necessarily begins a
new one.

## Worktrees

`/project alias@branch` resolves to a `git worktree` for that branch, created
lazily under the workspace. Branch names are validated against a conservative
charset and the resolved path is checked so it can't escape the worktree root.
If the project isn't a git repository, the bot answers with a clear error
instead of running somewhere you didn't pick.

::: tip Local runs only
Projects reference paths on the machine the bot runs on. A Docker-deployed bot
can't see paths on your laptop, so projects apply to `pca run`.
:::

## Sending files in

Attachments you send are downloaded and staged into a private per-turn
workspace directory. A private direct agent with explicitly enabled file tools
can inspect a document or photo there; Claude's default no-tools profile cannot
inspect the staged bytes. The staged copy is removed after the turn.

That temporary staging is separate from saved files. Attach exactly one file
with the caption `/file put <path>` when you want to keep it for this chat;
see [Files & storage](/guide/files).
