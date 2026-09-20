# Superpowers in this repo

**It is not available out of the box.** Measured 2026-08-30 in a fresh Claude Code web container
(CLI `2.1.251`), because the question "do we already have it?" is one nobody can answer by looking at a
session — the skill list a session shows is assembled from four places at once, and only one of them is the
repository.

## What a fresh container actually has

| | |
| --- | --- |
| `claude plugin marketplace list` | `No marketplaces configured` |
| `claude plugin list` | `No plugins installed.` |
| `~/.claude/plugins/` | one `synced/` bucket, no marketplace, no plugin |
| the account's claude.ai plugin catalog | no Superpowers in it (a keyword search returns `product-management` and nothing else) |
| skills that DO load | the repo's own two (`crosstxd-fix`, `renumber-mods`), the Anthropic bundle synced into `~/.claude/skills/synced/` (`docx` `pdf` `pptx` `xlsx` `skill-creator` `morning` `import-memory`), and the harness's own |

So a session that says "using the brainstorming skill" without the install below is not using Superpowers —
there is no such skill in the room.

## Installing it by hand

Two commands, ~20 s, and the network policy of the web container reaches GitHub:

```bash
claude plugin marketplace add obra/superpowers
claude plugin install superpowers@superpowers-dev
```

**The 14 skills appear in the SAME session** — measured, no restart needed; the hook below is what needs a
new session, not the skills.

`claude plugin install` writes its two keys into **`~/.claude/settings.json`** (`extraKnownMarketplaces` +
`enabledPlugins`), and `~/.claude` does not survive the container. That is why the same two keys are
committed in [`.claude/settings.json`](../../.claude/settings.json) instead.

## What it ships (v6.3.0)

`claude plugin details superpowers` — 14 skills, 1 hook, **0** agents, **0** MCP servers, **0** commands:

- process: `brainstorming` · `writing-plans` · `executing-plans` · `subagent-driven-development` ·
  `dispatching-parallel-agents` · `using-git-worktrees` · `finishing-a-development-branch`
- practice: `test-driven-development` · `systematic-debugging` · `verification-before-completion` ·
  `requesting-code-review` · `receiving-code-review` · `writing-skills` · `using-superpowers`

**Cost: ~688 tokens added to every session**, always-on. On invoke, the expensive ones are
`subagent-driven-development` ~11.8k, `writing-skills` ~9.7k, `brainstorming` ~5.6k; the rest are 0.8k–3.4k.

The one hook is `SessionStart` (`startup|clear|compact`): it reads `skills/using-superpowers/SKILL.md` and
injects the whole file as an `<EXTREMELY_IMPORTANT>` block that requires a skill be invoked *before any
response, including a clarifying question*. **That is the part that collides with this project**, and
`CLAUDE.md` settles it — plans, documentation and branches follow `CLAUDE.md`, the rest of the skills are
welcome unchanged.

## The caveat, and it is measured

**A workspace Claude Code has not trusted ignores `.claude/settings.json` outright.** A nested `claude -p`
run inside this container printed:

```
Ignoring 19 permissions.allow entries from .claude/settings.json: this workspace has not been trusted.
```

and `/root/.claude.json` carries `projects["/home/user/opensa"].hasTrustDialogAccepted: false`.

The session's own harness is a different matter and **does** apply the repo's settings — the repo's
`PreToolUse` hook fired on a probe command in this very session. Whether that harness also acts on
`extraKnownMarketplaces` / `enabledPlugins` at startup **could not be verified from inside a running
session**: a plugin is resolved before the first turn, and this session's copy came from the manual install
above. Treat the committed keys as the mechanism that works **once the workspace is trusted** — which on
the phone is one interactive `claude` run and accepting the dialog — and the two commands above as the
fallback that always works.

Related: [termux.md](./termux.md) (the machine this runs on) ·
[../../CLAUDE.md](../../CLAUDE.md) (precedence when a skill and this project disagree) ·
[../commands.md](../commands.md#claude-code-plugins)
