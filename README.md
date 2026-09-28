# @orlan-maker/cli

The `orlan` command connects an AI agent to [Orlan](https://orlan.app), the review board for decks,
PDFs, images and HTML. The agent then reads the comments on a file, posts a new version, replies and
resolves, from the terminal or over MCP.

Needs Node 22.18 or later.

## Set up

In Orlan, open the organisation menu, choose **Connect an agent**, and copy the prompt for your agent.
The prompt runs these four commands:

```
npm i -g @orlan-maker/cli
orlan auth login
orlan skills add --agent claude-code
orlan mcp connect --agent claude-code
```

- `orlan auth login` shows a code and opens the approval page in your browser. Sign in, check the
  code, choose the organisation, and the topics and role your agents get. The command waits for the
  approval (codes work for 10 minutes). The CLI token goes to the OS keychain (macOS keychain, or the
  Secret Service on Linux), else to `credentials.json` in the config folder, readable by you only.
  `--server <url>` signs in to another Orlan server; `--no-browser` only prints the address.
- `orlan skills add` writes the skills `orlan-review` and `orlan-versions` where the agent reads skills.
- `orlan mcp connect` makes an agent token and adds the Orlan MCP server to the agent. Only an admin of
  the organisation connects agents. For Claude Code it also installs the Orlan plugin (below);
  `--no-plugin` adds only the MCP server.
- `orlan status` shows who you are, the server, and each connected agent, and tests each agent's MCP
  connection. It ends with exit code 1 when a check fails.

Agents: `claude-code`, `codex`, `cursor`, `opencode`, `other`.

| Agent | Skills | MCP entry |
| --- | --- | --- |
| claude-code | `~/.claude/skills` | `claude mcp add --transport http --scope user orlan ...` |
| codex | `~/.agents/skills` | `[mcp_servers.orlan]` in `~/.codex/config.toml` |
| cursor | `~/.cursor/skills` | `mcpServers.orlan` in `~/.cursor/mcp.json` |
| opencode | `~/.config/opencode/skills` | `mcp.orlan` in `~/.config/opencode/opencode.json`, and the plugin in `~/.config/opencode/plugins/orlan.js` |
| other | `.agents/skills` in the folder you are in | `orlan mcp print` prints the address and the header |

Without `--agent`, the CLI finds the agent that runs it from its environment.

## The Claude Code plugin

This package is also the Claude Code plugin `orlan@orlan`. Its public marketplace is
https://github.com/AliProgrammin/orlan-plugin (MIT). Install it in two lines:

```
claude plugin marketplace add AliProgrammin/orlan-plugin
claude plugin install orlan@orlan
```

`orlan mcp connect --agent claude-code` installs it too; from a checkout,
`claude plugin marketplace add ./packages/cli` and `claude plugin install orlan@orlan` do the same. One install gives the session:

- `orlan` on the PATH of Claude Code's shell.
- A monitor that runs `orlan wait --follow`: a mention of the agent wakes the session, also when it is
  idle. Monitors run only in an interactive session.
- Hooks that show the session on the board: working (session start, a prompt, each tool), waiting for
  input (a permission prompt or a question in the terminal), idle (the turn ended), done (the session
  ended). At the session start, `orlan brief` goes into the session's context.
- The skills `orlan-review` and `orlan-versions`.
- The Orlan MCP server. Its header comes from `orlan mcp headers`, with the token from the keychain. It
  goes to `$ORLAN_SERVER`, else https://orlan.app: on another server, set `ORLAN_SERVER` where you start
  Claude Code.

## The OpenCode plugin

`orlan mcp connect --agent opencode` also writes the Orlan plugin to `~/.config/opencode/plugins/orlan.js`.
When a session's turn ends, the plugin runs `orlan hook wait`. A mention of the agent on the board then goes
to the session as a new prompt, and a new turn starts. The plugin also shows the session on the board:
working, waiting for a permission prompt, idle, done. A request wakes a session only while OpenCode runs
(the TUI or `opencode serve`). Restart a running OpenCode to load the plugin. `orlan mcp disconnect
--agent opencode` removes it.

## Daily commands

Each works as the connected agent, with the agent's own token, and is in the topic's audit log. Each
is plain HTTP with the agent token, with no MCP session: `orlan files push` makes 2 requests (the file,
then the post), `orlan files pull` 2 (the file's answer, then the download), and most others 1.

```
orlan brief [--topic <topic>]
orlan topics list
orlan files list --topic <topic>
orlan files add <path> [--topic <topic>]
orlan files pull <file> [--version <n>] [--topic <topic>] [--out <path>] [--edit [--shared] [--ttl <time>]]
orlan files push <file> <path> --changelog "<what changed>" [--base <n>] [--topic <topic>]
orlan comments list [--topic <topic>] [--status open|resolved|all] [--file <file>]
orlan comment <thread> "<text>" | --file <file> --page <n> [--region <x,y,w,h>] "<text>" | --at <x,y> "<text>" [--topic <topic>]
orlan comments resolve <thread> [--topic <topic>]
orlan open [<topic id>] [--file <file id>]
orlan wait [--follow]
orlan inbox [--new]
orlan inbox done <request id>
orlan respond <request id> --message "<text>" [--file <path>] [--to <file>] [--changelog "<text>"] [--base <n>] [--wait]
orlan hook <working|needs-input|idle|done>
orlan hook start|stop --agent codex|cursor
orlan mcp headers
```

The ids people see work as input: a topic by its name, a file by its name, a thread as `#12`, and a
version as `v5` (or `5`). A name or a number is looked up on `--topic`, else on every topic of the
agent. When it matches more than one, the command stops with a plain error that lists each match with
its id and topic: give the id, or add `--topic`.

Every output ends with a `next_step` line, and every error says what to do next in a `next_step` line.
With `--json`, a command prints small JSON on one line with a `next_step` field; an error is JSON too:
`{"error": "<code>", "message": "...", "next_step": "..."}`. The hook commands and `orlan mcp headers`
print only what their harness reads, and `orlan inbox --new` prints nothing when there is no request.

`orlan brief` is for the start of a session. It prints the topic, the open requests, the files with
their current versions, and one `next_step` line, in about 500 tokens for 6 files and 3 requests. The
topic is the one the agent used last, else its only topic. `orlan files add` posts a new file to the
topic and puts it on the board, in one request. Both are plain HTTP calls with the agent token, with
no MCP session.

`orlan comment` replies in a thread, or opens a new thread: with `--file` and `--page` on a page (the
whole page, or `--region` as fractions of the page), with `--at` on a point of the board. People see it
on the board at once. "@" and a name mentions a person or an agent of the topic. A mention of another
agent makes no request when that agent still has an open request from you in the thread, or after 5 asks
this hour: the command prints "Not asked: <name>".

`orlan wait` waits for the next request to the agent: a person, a guest or an agent mentions it in a
comment. It prints the request with each comment, its file, version, page, region, the text under the
region and a crop link, and exits. Running it again after a lost connection is safe: the request comes
once. The wait confirms each request after it printed it; when the wait stops before that, the request
goes back to the inbox within 20 seconds. `--follow` stays open and prints one line per request. `orlan inbox` prints the open requests;
`--new` takes the new ones and prints nothing when there are none, for a stop hook. `orlan inbox done`
closes a request when its work is finished.

`orlan files pull --edit` puts the agent's claim on the file: other agents get it in their answer,
and the board shows "Claude (for Sara) is editing from v4 - 3 min" on the file. The claim warns and
blocks nothing. It lasts 15 minutes (`--ttl 90s`, `--ttl 1h`), and a push or respond of the agent ends
it. When another agent has a claim, the pull gives no claim and a `next_step`: wait for its version,
ask it with `orlan comment`, or take a shared claim with `--edit --shared`. A push or respond names its
base version: `--base`, else the version the pull got, else (respond) the version the comments were on.
When a newer version landed first, Orlan refuses it with `stale_base`, the newer changelog and a
`next_step`, and nothing changes.

`orlan respond` closes a review round in one command. With `--file`, it posts the file as a new version
of the file the request is about, with the version the comments were on as its base (`--to <file id>`
when the request names no file or several). Then it replies with the message in each thread of the
request, resolves the threads, and marks the request done. `--wait` then waits for the next request, as
`orlan wait` does. A request that is done already gives a refusal and a `next_step` line. To ask a
person a question, reply with `orlan comment` and leave the thread open: the answer comes to the
inbox as a request. A request that stays taken for 10 minutes with no done goes back to the inbox.

`orlan hook` is for harness hooks, not for the model: it tells the board that the agent works, waits
in the terminal (for example on a permission prompt), is idle or is done. It reads the hook's JSON on
standard input, makes one request, prints nothing and makes no model call. Orlan never answers the
terminal prompt; the board tells people to go to the terminal. With no agent connected, it does nothing.

`orlan hook start` and `orlan hook stop` are the session start and stop hooks of Codex and Cursor, and
`orlan mcp connect --agent codex|cursor` installs them. Codex and Cursor sessions do not wake when idle:
the start hook puts the brief in the session, and when a turn ends the stop hook gives the session the
new requests, so it works on at once. After 5 requests in a row it lets the session stop. Codex runs a
hook only after you trust it once with `/hooks`.

`orlan mcp headers` prints the MCP authorization header as JSON, for a `headersHelper`. The plugin's MCP
server runs it.

While a wait of the agent is open (the plugin's monitor), the `next_step` lines do not say `--wait`:
the open wait gets the next request.

A version the agent posts waits for a person to make it current. When several agents are connected,
add `--agent <id>`.

## Stop

- `orlan mcp disconnect --agent <id>` revokes the agent's token and removes its MCP entry.
- `orlan auth logout` revokes the CLI token. You can also revoke it in Orlan: Profile, Orlan CLI sign-ins.

Run `orlan help` for every command, and `orlan <command> --help` for its options.

Settings: `ORLAN_SERVER` names the server, `ORLAN_CONFIG_DIR` the config folder, `ORLAN_KEYCHAIN=off`
keeps secrets in the file, and `BROWSER` names the program that opens the approval page.
