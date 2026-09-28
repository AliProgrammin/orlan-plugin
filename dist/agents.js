/**
 * The agents the CLI connects: where each one reads skills, and how its MCP settings get the Orlan
 * server. The ids match the web app's connect dialog (agentClients in @orlan/shared).
 */
import { execFile } from "node:child_process";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { OrlanError } from "./http.js";
export const agentIds = ["claude-code", "codex", "cursor", "opencode", "other"];
export const agentLabels = {
    "claude-code": "Claude Code",
    codex: "Codex",
    cursor: "Cursor",
    opencode: "OpenCode",
    other: "your agent",
};
/** The MCP server name in each agent's settings. */
export const MCP_NAME = "orlan";
export function parseAgent(value) {
    if (agentIds.includes(value))
        return value;
    throw new OrlanError(`"${value}" is not an agent Orlan knows. Use one of: ${agentIds.join(", ")}.`);
}
/** Environment variables each agent sets for the commands it runs. */
const markers = [
    ["claude-code", ["CLAUDECODE"]],
    ["codex", ["CODEX_SANDBOX", "CODEX_SANDBOX_NETWORK_DISABLED", "CODEX_THREAD_ID"]],
    ["opencode", ["OPENCODE"]],
    ["cursor", ["CURSOR_AGENT", "CURSOR_TRACE_ID"]],
];
/** The agent that runs this command, from its environment, or undefined. */
export function detectAgent(env = process.env) {
    return markers.find(([, names]) => names.some((name) => env[name]))?.[0];
}
const home = () => homedir();
const xdgConfig = () => process.env.XDG_CONFIG_HOME || path.join(home(), ".config");
/**
 * The folder each agent reads skills from. "other" gets them in the project folder. Checked against
 * each tool's documentation on 2026-09-24 (B018):
 * - Codex: user skills in $HOME/.agents/skills - https://learn.chatgpt.com/docs/build-skills
 *   (was https://developers.openai.com/codex/skills)
 * - Cursor: user skills in ~/.cursor/skills (it reads ~/.agents/skills too) -
 *   https://cursor.com/docs/context/skills
 * - OpenCode: global skills in ~/.config/opencode/skills/<name>/SKILL.md -
 *   https://opencode.ai/docs/skills/
 */
export function skillsDir(agent, cwd = process.cwd()) {
    switch (agent) {
        case "claude-code":
            return path.join(process.env.CLAUDE_CONFIG_DIR || path.join(home(), ".claude"), "skills");
        case "codex":
            return path.join(home(), ".agents", "skills");
        case "cursor":
            return path.join(home(), ".cursor", "skills");
        case "opencode":
            return path.join(xdgConfig(), "opencode", "skills");
        case "other":
            return path.join(cwd, ".agents", "skills");
    }
}
/**
 * The MCP settings file of an agent that has one the CLI edits. Checked against each tool's
 * documentation on 2026-09-24 (B018):
 * - Codex: `[mcp_servers.<name>]` with `url` and `http_headers` in ~/.codex/config.toml -
 *   https://learn.chatgpt.com/docs/extend/mcp?surface=cli (was https://developers.openai.com/codex/mcp)
 * - Cursor: `mcpServers.<name>` with `url` and `headers` in ~/.cursor/mcp.json (the editor and the
 *   cursor-agent CLI read it) - https://cursor.com/docs/context/mcp and https://cursor.com/docs/cli/mcp
 * - OpenCode: `mcp.<name>` with `type: "remote"`, `url`, `headers` and `enabled` in
 *   ~/.config/opencode/opencode.json - https://opencode.ai/docs/mcp-servers/ and
 *   https://opencode.ai/docs/config/
 */
export function mcpFile(agent) {
    switch (agent) {
        case "codex":
            return path.join(process.env.CODEX_HOME || path.join(home(), ".codex"), "config.toml");
        case "cursor":
            return path.join(home(), ".cursor", "mcp.json");
        case "opencode":
            return path.join(xdgConfig(), "opencode", "opencode.json");
    }
}
async function readText(file) {
    try {
        return await readFile(file, "utf8");
    }
    catch (error) {
        if (error.code === "ENOENT")
            return "";
        throw error;
    }
}
/** Writes the file at once. The file holds a secret, so only this user reads it. */
async function writeText(file, text) {
    await mkdir(path.dirname(file), { recursive: true });
    const temporary = `${file}.${process.pid}.tmp`;
    await writeFile(temporary, text, { mode: 0o600 });
    await rename(temporary, file);
}
/** A TOML table header line such as `[mcp_servers.orlan]` or `[[x]]`, with its dotted name. */
const tableHeader = (line) => /^\s*\[\[?\s*([^\]]+?)\s*\]\]?\s*(#.*)?$/.exec(line)?.[1];
/**
 * The Codex config.toml without the `[mcp_servers.orlan]` table and its sub-tables, and with the new
 * one when `entry` is given. Every other line stays as it was, comments too.
 */
export function editCodexToml(text, entry) {
    const lines = text.split("\n");
    const kept = [];
    let inOrlan = false;
    for (const line of lines) {
        const header = tableHeader(line);
        if (header !== undefined) {
            const name = header.replace(/\s/g, "").replace(/"/g, "");
            inOrlan = name === `mcp_servers.${MCP_NAME}` || name.startsWith(`mcp_servers.${MCP_NAME}.`);
        }
        if (!inOrlan)
            kept.push(line);
    }
    let result = kept.join("\n").replace(/\n+$/, "");
    if (entry) {
        const table = [
            `[mcp_servers.${MCP_NAME}]`,
            `url = ${JSON.stringify(entry.url)}`,
            `http_headers = { "Authorization" = ${JSON.stringify(entry.authorization)} }`,
        ].join("\n");
        result = result ? `${result}\n\n${table}` : table;
    }
    return result ? `${result}\n` : "";
}
/** Sets or removes one key in a JSON settings file, under `section`. */
async function editJson(file, section, value) {
    const text = await readText(file);
    let settings;
    try {
        settings = text.trim() ? JSON.parse(text) : {};
    }
    catch {
        throw new OrlanError(`${file} is not plain JSON (it has comments or an error), so Orlan does not change it. ` +
            "Run `orlan mcp print` and add the entry by hand.");
    }
    const servers = { ...(settings[section] ?? {}) };
    if (value === undefined) {
        if (!(MCP_NAME in servers))
            return;
        delete servers[MCP_NAME];
    }
    else {
        servers[MCP_NAME] = value;
    }
    settings[section] = servers;
    await writeText(file, `${JSON.stringify(settings, null, 2)}\n`);
}
function runClaude(args) {
    return new Promise((resolve, reject) => {
        execFile("claude", args, { timeout: 60_000 }, (error, stdout, stderr) => {
            if (error && error.code === "ENOENT") {
                reject(new OrlanError("Orlan cannot find the `claude` command. Install Claude Code first."));
                return;
            }
            resolve({ ok: !error, output: `${stdout}${stderr}`.trim() });
        });
    });
}
/**
 * The Claude Code plugin (F044). This package is the plugin and its own marketplace: the folder with
 * package.json has .claude-plugin/plugin.json and .claude-plugin/marketplace.json. A local marketplace
 * loads the plugin in place, so an update of the package updates the plugin.
 */
export const CLAUDE_PLUGIN = "orlan@orlan";
const packageRoot = () => fileURLToPath(new URL("..", import.meta.url));
/** True when the Orlan plugin is installed and enabled in Claude Code. */
async function claudePluginEnabled() {
    const listed = await runClaude(["plugin", "list", "--json"]);
    if (!listed.ok)
        return false;
    try {
        const plugins = JSON.parse(listed.output);
        return Array.isArray(plugins) && plugins.some((plugin) => plugin.id === CLAUDE_PLUGIN && plugin.enabled);
    }
    catch {
        return false;
    }
}
/**
 * Installs the Orlan plugin in Claude Code for this user, from this package, when it is not enabled
 * yet. Returns false when Claude Code refused the install.
 */
export async function installClaudePlugin() {
    if (await claudePluginEnabled())
        return true;
    await runClaude(["plugin", "marketplace", "add", packageRoot(), "--scope", "user"]);
    const installed = await runClaude(["plugin", "install", CLAUDE_PLUGIN, "--scope", "user"]);
    return installed.ok && (await claudePluginEnabled());
}
/**
 * The hooks file of Codex and Cursor (F046). Checked against each tool's documentation on 2026-09-26:
 * - Codex: $CODEX_HOME/hooks.json (default ~/.codex), events SessionStart, UserPromptSubmit,
 *   PermissionRequest, PostToolUse and Stop. A person trusts each hook once with /hooks, and Codex keeps
 *   the trust by file, event and position - https://learn.chatgpt.com/docs/hooks
 * - Cursor: ~/.cursor/hooks.json with `version: 1`, events sessionStart, beforeSubmitPrompt, stop and
 *   sessionEnd. The editor and the cursor-agent CLI read it - https://cursor.com/docs/hooks
 */
export function hooksFile(agent) {
    return agent === "codex"
        ? path.join(process.env.CODEX_HOME || path.join(home(), ".codex"), "hooks.json")
        : path.join(home(), ".cursor", "hooks.json");
}
/**
 * How many requests in a row a stop hook gives one session before it lets the session stop. Codex has
 * no limit of its own. Cursor drops a hook's follow-up at its loop_limit, 5 by default, which Orlan
 * writes too. Orlan takes no request past this limit, so it never takes a request the harness drops.
 */
export const STOP_LOOP_LIMIT = 5;
/** A hook command Orlan wrote ends with `hook <state> --agent codex` or `--agent cursor`. */
const orlanHookCommand = /\shook (start|stop|working|needs-input|idle|done) --agent (codex|cursor)$/;
/**
 * The command a hook runs: this Node and this CLI by full path, because a harness started from the
 * desktop (Cursor, the Codex app) often has no `orlan` or `node` on its PATH.
 */
function hookCommand(args) {
    return `${JSON.stringify(process.execPath)} ${JSON.stringify(cliMain())} hook ${args}`;
}
/** The main file of this CLI: src/main.ts in a checkout, dist/main.js in the npm package. */
function cliMain() {
    const source = fileURLToPath(import.meta.url);
    return path.join(path.dirname(source), `main${path.extname(source)}`);
}
/** The Orlan hooks of each harness, by event, in the shape of its hooks.json. */
function orlanHooks(agent) {
    if (agent === "codex") {
        const entry = (args, timeout, statusMessage) => ({
            hooks: [
                {
                    type: "command",
                    command: hookCommand(`${args} --agent codex`),
                    timeout,
                    ...(statusMessage ? { statusMessage } : {}),
                },
            ],
        });
        return {
            SessionStart: entry("start", 10, "Reading the Orlan brief"),
            UserPromptSubmit: entry("working", 5),
            PermissionRequest: entry("needs-input", 5),
            PostToolUse: entry("working", 5),
            Stop: entry("stop", 10, "Checking Orlan for requests"),
        };
    }
    const entry = (args, timeout, more = {}) => ({
        command: hookCommand(`${args} --agent cursor`),
        timeout,
        ...more,
    });
    return {
        sessionStart: entry("start", 10),
        beforeSubmitPrompt: entry("working", 5),
        stop: entry("stop", 10, { loop_limit: STOP_LOOP_LIMIT }),
        sessionEnd: entry("done", 5),
    };
}
/** True for a hook entry Orlan wrote: a Cursor entry with an Orlan command, or a Codex group with one. */
function isOrlanHook(entry) {
    if (!entry || typeof entry !== "object")
        return false;
    const { command, hooks } = entry;
    if (typeof command === "string")
        return orlanHookCommand.test(command);
    return Array.isArray(hooks) && hooks.some(isOrlanHook);
}
/**
 * The hooks.json settings with the Orlan hooks of `add` in place of the old ones, or with no Orlan
 * hooks when `add` is undefined. Every other hook stays at its place, and an Orlan hook goes back to
 * its place: Codex keeps a person's trust by the position of the hook.
 */
export function editHooks(settings, add) {
    const events = { ...(settings.hooks ?? {}) };
    for (const event of new Set([...Object.keys(events), ...Object.keys(add ?? {})])) {
        const current = events[event] ?? [];
        // Not a list of hooks: not a shape Orlan writes, so it stays as it is.
        if (!Array.isArray(current))
            continue;
        const at = current.findIndex(isOrlanHook);
        const kept = current.filter((entry) => !isOrlanHook(entry));
        const mine = add?.[event];
        if (mine)
            kept.splice(at === -1 ? kept.length : at, 0, mine);
        if (kept.length > 0)
            events[event] = kept;
        else
            delete events[event];
    }
    return { ...settings, hooks: events };
}
/** Writes the Orlan hooks into the harness's hooks.json, or takes them out. Returns the file. */
export async function setHooks(agent, install) {
    const file = hooksFile(agent);
    const text = await readText(file);
    if (!text.trim() && !install)
        return file;
    let settings;
    try {
        settings = text.trim() ? JSON.parse(text) : {};
    }
    catch {
        throw new OrlanError(`${file} is not plain JSON, so Orlan does not change it. Correct the file, then run this again.`);
    }
    const edited = editHooks(settings, install ? orlanHooks(agent) : undefined);
    await writeText(file, `${JSON.stringify(agent === "cursor" ? { version: 1, ...edited } : edited, null, 2)}\n`);
    return file;
}
/**
 * The Orlan plugin of OpenCode (F045), in its global plugins folder: ~/.config/opencode/plugins/ -
 * https://opencode.ai/docs/plugins/ (checked 2026-09-27 against OpenCode 1.18.30).
 */
export function opencodePluginFile() {
    return path.join(xdgConfig(), "opencode", "plugins", "orlan.js");
}
/** The first line of the plugin, so a disconnect removes only a file Orlan wrote. */
const OPENCODE_PLUGIN_MARK = "// The Orlan plugin for OpenCode (F045).";
/**
 * The plugin as `orlan mcp connect` writes it: opencode/orlan.js of this package, with this Node and
 * this CLI by full path in place of `orlan` on the PATH.
 */
export async function opencodePlugin() {
    const source = await readFile(path.join(packageRoot(), "opencode", "orlan.js"), "utf8");
    const line = 'const ORLAN = ["orlan"];';
    if (!source.startsWith(OPENCODE_PLUGIN_MARK) || !source.includes(line)) {
        throw new OrlanError("The OpenCode plugin of this orlan package is damaged. Install @orlan/cli again.");
    }
    return source.replace(line, `const ORLAN = ${JSON.stringify([process.execPath, cliMain()])};`);
}
/** Writes the Orlan plugin into OpenCode's plugins folder, or takes it out. Returns the file. */
export async function setOpencodePlugin(install) {
    const file = opencodePluginFile();
    if (install) {
        await writeText(file, await opencodePlugin());
    }
    else if ((await readText(file)).startsWith(OPENCODE_PLUGIN_MARK)) {
        await rm(file, { force: true });
    }
    return file;
}
/**
 * Writes the Orlan MCP server into the agent's settings, in place of an older entry. Returns what it
 * changed, for the person.
 */
export async function addMcp(agent, url, secret) {
    const authorization = `Bearer ${secret}`;
    switch (agent) {
        case "claude-code": {
            await runClaude(["mcp", "remove", MCP_NAME, "--scope", "user"]);
            const added = await runClaude([
                "mcp",
                "add",
                "--transport",
                "http",
                "--scope",
                "user",
                MCP_NAME,
                url,
                "--header",
                `Authorization: ${authorization}`,
            ]);
            if (!added.ok)
                throw new OrlanError(`claude mcp add failed: ${added.output.replaceAll(secret, "orl_...")}`);
            return "Claude Code (claude mcp add --scope user)";
        }
        case "codex": {
            const file = mcpFile("codex");
            await writeText(file, editCodexToml(await readText(file), { url, authorization }));
            return file;
        }
        case "cursor": {
            const file = mcpFile("cursor");
            await editJson(file, "mcpServers", { url, headers: { Authorization: authorization } });
            return file;
        }
        case "opencode": {
            const file = mcpFile("opencode");
            await editJson(file, "mcp", { type: "remote", url, headers: { Authorization: authorization }, enabled: true });
            return file;
        }
    }
}
/** Takes the Orlan MCP server out of the agent's settings. */
export async function removeMcp(agent) {
    switch (agent) {
        case "claude-code":
            await runClaude(["mcp", "remove", MCP_NAME, "--scope", "user"]);
            return;
        case "codex": {
            const file = mcpFile("codex");
            const text = await readText(file);
            if (text)
                await writeText(file, editCodexToml(text));
            return;
        }
        case "cursor":
            await editJson(mcpFile("cursor"), "mcpServers", undefined);
            return;
        case "opencode":
            await editJson(mcpFile("opencode"), "mcp", undefined);
            return;
    }
}
