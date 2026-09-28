/**
 * A small MCP client over Streamable HTTP, for the MCP test of `orlan status` and `orlan mcp connect`:
 * it proves that the agent's MCP server works. The daily commands use plain HTTP (AgentApi, F038). A
 * test is one MCP session of the agent token: it starts the session, calls its tool, and closes it. The
 * client names itself "orlan-cli", so Orlan keeps these sessions off the Agents tab and sends no
 * "session ended" notification for them. Every call is in the audit log like any agent call.
 */
import { OrlanError } from "./http.js";
const PROTOCOL_VERSION = "2025-06-18";
/** The JSON-RPC answer with this id, from a JSON body or from a server-sent event stream. */
async function answerOf(response, id) {
    const text = await response.text();
    const type = response.headers.get("content-type") ?? "";
    const messages = type.includes("text/event-stream")
        ? text
            .split(/\r?\n\r?\n/)
            .map((event) => event
            .split(/\r?\n/)
            .filter((line) => line.startsWith("data:"))
            .map((line) => line.slice(5).trimStart())
            .join("\n"))
            .filter((data) => data.length > 0)
            .map((data) => JSON.parse(data))
        : [JSON.parse(text)];
    const answer = messages.find((message) => message.id === id);
    if (!answer)
        throw new OrlanError("Orlan's MCP server gave no answer.");
    if (answer.error)
        throw new OrlanError(`Orlan's MCP server refused the call: ${answer.error.message}`);
    return answer;
}
export class McpClient {
    sessionId;
    nextId = 1;
    url;
    /** The agent token: the file downloads send it as their Bearer header too. */
    token;
    version;
    constructor(server, token, version) {
        this.url = new URL("/mcp", server);
        this.token = token;
        this.version = version;
    }
    async post(body) {
        let response;
        try {
            response = await fetch(this.url, {
                method: "POST",
                headers: {
                    authorization: `Bearer ${this.token}`,
                    "content-type": "application/json",
                    accept: "application/json, text/event-stream",
                    ...(this.sessionId ? { "mcp-session-id": this.sessionId, "mcp-protocol-version": PROTOCOL_VERSION } : {}),
                },
                body: JSON.stringify(body),
            });
        }
        catch (error) {
            throw new OrlanError(`Orlan's MCP server at ${this.url} did not answer: ${error.message}.`);
        }
        if (response.status === 401) {
            throw new OrlanError("Orlan did not accept the agent token. It was revoked or replaced: run `orlan mcp connect` again.", "not_signed_in");
        }
        if (!response.ok && response.status !== 202) {
            throw new OrlanError(`Orlan's MCP server answered ${response.status}.`);
        }
        return response;
    }
    async request(method, params) {
        const id = this.nextId++;
        const response = await this.post({ jsonrpc: "2.0", id, method, params });
        if (method === "initialize")
            this.sessionId = response.headers.get("mcp-session-id") ?? undefined;
        return (await answerOf(response, id)).result;
    }
    async open() {
        await this.request("initialize", {
            protocolVersion: PROTOCOL_VERSION,
            capabilities: {},
            clientInfo: { name: "orlan-cli", version: this.version },
        });
        if (!this.sessionId)
            throw new OrlanError("Orlan's MCP server started no session.");
        await (await this.post({ jsonrpc: "2.0", method: "notifications/initialized" })).text();
    }
    /** Calls a tool and returns its JSON answer. A refusal ("Refused: <code>") throws with that code. */
    async call(tool, args = {}) {
        if (!this.sessionId)
            await this.open();
        const result = (await this.request("tools/call", { name: tool, arguments: args }));
        const text = result.content?.find((part) => part.type === "text")?.text ?? "";
        if (result.isError) {
            const code = /^Refused: ([a-z_]+)/.exec(text)?.[1];
            throw new OrlanError(`Orlan refused ${tool}: ${text.replace(/^Refused: /, "")}`, code);
        }
        return JSON.parse(text);
    }
    /** Ends the session (HTTP DELETE). */
    async close() {
        if (!this.sessionId)
            return;
        const sessionId = this.sessionId;
        this.sessionId = undefined;
        await fetch(this.url, {
            method: "DELETE",
            headers: {
                authorization: `Bearer ${this.token}`,
                "mcp-session-id": sessionId,
                "mcp-protocol-version": PROTOCOL_VERSION,
            },
        }).catch(() => undefined);
    }
}
