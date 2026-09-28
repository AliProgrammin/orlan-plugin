/** Calls to the Orlan API, and the one error type every command prints. */
/**
 * A failure the CLI explains to the person. `code` is the API's named error, when there is one.
 * `next` is what to do next: main.ts prints it as the next_step line.
 */
export class OrlanError extends Error {
    code;
    next;
    constructor(message, code, next) {
        super(message);
        this.code = code;
        this.next = next ?? (code ? nextSteps[code] : undefined);
    }
}
/** What a named API error means for a person at the terminal. */
const explained = {
    not_signed_in: "Orlan did not accept the token. Run `orlan auth login` again.",
    forbidden: "Your role does not allow this. An admin of the organisation connects agents.",
    not_found: "Orlan found no such item, or your token cannot reach it.",
    token_invalid: "Orlan needs at least one topic for the agent. Add --topic <topic id>, or sign in again and pick topics.",
    login_denied: "The sign-in was denied in the browser.",
    login_expired: "The sign-in code expired. Run `orlan auth login` again.",
    login_used: "This sign-in code was already used. Run `orlan auth login` again.",
    login_rate_limited: "Too many sign-ins from this computer in a short time. Wait 10 minutes, then try again.",
    org_suspended: "This organisation is suspended.",
    topic_missing: "The agent has several topics and used none yet. Add --topic <topic id>: `orlan topics list` shows them.",
    file_too_large: "The file is larger than Orlan takes.",
    plan_limit_agents: "The organisation uses all the agents of the Free plan. Disconnect an agent with `orlan mcp disconnect`, or ask an admin to move the organisation to Team (organisation menu, Billing).",
    guest_account_agent_limit: "A guest account connects one agent. Disconnect it with `orlan mcp disconnect`, or add your email in Orlan (the bar at the top) to connect more.",
    guest_account_file_limit: "A guest account holds 3 files, 25 MB in total. Add your email in Orlan (the bar at the top) to upload more.",
};
/** What to do after a named API error (F038): every error ends with a next_step line. */
const nextSteps = {
    not_signed_in: "orlan auth login, then orlan mcp connect --agent <id>",
    forbidden: "ask an admin of the organisation, or tell your person what you wanted to do",
    not_found: "orlan brief (the topics, files and requests your token can reach)",
    ref_ambiguous: "give the id from the list above, or add --topic <topic>",
    input_invalid: "fix the input above; `orlan <command> --help` shows the options",
    token_invalid: "orlan auth login, and pick topics for the agent",
    login_denied: "orlan auth login",
    login_expired: "orlan auth login",
    login_used: "orlan auth login",
    login_rate_limited: "wait 10 minutes, then orlan auth login",
    org_suspended: "ask an admin of the organisation to contact Orlan",
    topic_missing: "add --topic <topic>: orlan topics list shows them",
    file_too_large: "make the file smaller, then run the command again",
    file_missing: "give a file that is not empty",
    name_invalid: "give the file a name with its extension, for example deck.pptx",
    board_full: "ask a person to make room on the board",
    stale_base: "orlan files pull <file> --edit, make your change on the newer version, then post it again",
    base_invalid: "give --base a version of the file: orlan files list shows them",
    request_done: "orlan wait (the next request)",
    request_stopped: "stop the work on this request, and tell your person that a person stopped it on Orlan",
    file_target_missing: "add --to <file>",
    file_target_ambiguous: "add --to <file>",
    upload_invalid: "run the command again: it sends the file again",
    upload_expired: "run the command again: it sends the file again",
    mention_invalid: "write the comment without that mention",
    plan_limit_agents: "orlan mcp disconnect --agent <id>, or ask an admin to move the organisation to Team",
    guest_account_agent_limit: "orlan mcp disconnect --agent <id>, or add your email in Orlan",
    guest_account_file_limit: "add your email in Orlan (the bar at the top)",
    internal_error: "run the command again; when it fails again, tell your person",
};
export async function apiCall(server, pathname, init = {}) {
    let response;
    try {
        response = await fetch(new URL(pathname, server), {
            method: init.method ?? (init.body === undefined ? "GET" : "POST"),
            headers: {
                ...(init.token ? { authorization: `Bearer ${init.token}` } : {}),
                ...(init.body === undefined ? {} : { "content-type": "application/json" }),
            },
            body: init.body === undefined ? undefined : JSON.stringify(init.body),
        });
    }
    catch (error) {
        throw unreachable(server, error);
    }
    const json = (await response.json().catch(() => undefined));
    if (!response.ok)
        throw apiError(response.status, json?.error);
    return json;
}
/** The error of a server that did not answer. */
export function unreachable(server, error) {
    return new OrlanError(`Orlan at ${server} did not answer: ${error.message}.`, undefined, "check the network and the server (orlan status), then run the command again");
}
/** The error of a refused API call, explained when the code has an explanation. */
export function apiError(status, code) {
    return new OrlanError((code && explained[code]) ?? `Orlan answered ${status}${code ? ` (${code})` : ""}.`, code);
}
/** The error of an agent token that Orlan did not accept: revoked or replaced. */
export const agentTokenRefused = () => new OrlanError("Orlan did not accept the agent token. It was revoked or replaced.", "not_signed_in", "orlan mcp connect --agent <id>");
/**
 * The stateless calls of the daily commands (F038): each is one plain HTTP request with the agent
 * token. No MCP session: no initialize, no DELETE, no session row. Orlan writes each call in the
 * audit log like any agent call. Human ids (#12, v5, a file or topic name) work as input.
 */
export class AgentApi {
    server;
    /** The agent token: the file downloads send it as their Bearer header too. */
    token;
    constructor(server, token) {
        this.server = server;
        this.token = token;
    }
    async send(url, init, what) {
        let response;
        try {
            response = await fetch(url, { ...init, headers: { authorization: `Bearer ${this.token}`, ...init.headers } });
        }
        catch (error) {
            throw unreachable(this.server, error);
        }
        if (response.status === 401)
            throw agentTokenRefused();
        const json = (await response.json().catch(() => undefined));
        if (!response.ok) {
            const code = json?.error;
            // A detail can end with Orlan's own next_step line: that is the next step.
            const [detail, next] = (json?.detail ?? "").split(/\n?next_step: /);
            // With no detail, a known code has its explanation.
            const message = !detail && code && explained[code]
                ? explained[code]
                : `Orlan refused ${what}: ${code ? `${code}${detail ? `. ${detail}` : ""}` : `answered ${response.status}`}`;
            throw new OrlanError(message, code, next || undefined);
        }
        return json;
    }
    /** Calls an agent tool with its input and returns its JSON answer. A refusal throws with its code. */
    call(tool, input = {}) {
        return this.send(new URL(`/api/agent/tools/${encodeURIComponent(tool)}`, this.server), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input) }, tool);
    }
    /** GET an agent route, with its query. */
    get(pathname, query, what) {
        return this.send(this.url(pathname, query), {}, what);
    }
    /** POST a local file as the raw body of an agent route, with its query. */
    postFile(pathname, query, body, what) {
        return this.send(this.url(pathname, query), { method: "POST", headers: { "content-type": "application/octet-stream" }, body: new Uint8Array(body) }, what);
    }
    /**
     * Sends a local file in one request and returns its upload id, for post or respond. The
     * file goes to the topic of the target: a file (a version of it), a request (its answer), or a topic.
     */
    async upload(body, target, what = "the upload") {
        return (await this.postFile("/api/agent/uploads", target, body, what)).uploadId;
    }
    url(pathname, query) {
        const url = new URL(pathname, this.server);
        for (const [key, value] of Object.entries(query))
            if (value)
                url.searchParams.set(key, value);
        return url;
    }
}
