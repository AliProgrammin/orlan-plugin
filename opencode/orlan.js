// The Orlan plugin for OpenCode (F045). `orlan mcp connect --agent opencode` writes it to OpenCode's
// plugins folder, and `orlan mcp disconnect --agent opencode` takes it out.
//
// OpenCode has no stop hook and no monitor: a turn that ends raises `session.idle`, and a plugin may
// answer it with a new prompt. So when a session goes idle, this plugin runs `orlan hook wait`. When a
// person mentions the agent on Orlan, the wait prints the request, and the plugin sends it to the
// session with prompt_async: a new turn starts. When the session works again before a request
// comes, the plugin ends the wait, and an untaken request stays in the inbox.
// The board shows the session's state from OpenCode's events through `orlan hook <state>`.
import { spawn } from "node:child_process";

// The orlan command. `orlan mcp connect` writes this Node and this CLI by full path here, because
// OpenCode started from the desktop often has no `orlan` on its PATH.
const ORLAN = ["orlan"];
const AGENT = ["--agent", "opencode"];

/** Runs `orlan <args>` with the JSON the hook reads on standard input. */
function orlan(args, input) {
  const child = spawn(ORLAN[0], [...ORLAN.slice(1), ...args, ...AGENT], { stdio: ["pipe", "pipe", "pipe"] });
  child.on("error", () => {});
  if (input !== undefined) child.stdin.end(JSON.stringify(input));
  return child;
}

export const OrlanPlugin = async ({ client }) => {
  /** The open wait: the session it wakes, and the `orlan hook wait` process. */
  let wait;
  /** The parent of each subagent session: the parent answers for the board. */
  const parents = new Map();
  const root = (sessionID) => parents.get(sessionID) ?? sessionID;
  /** The last state each session reported, so a state goes to the board once. */
  const states = new Map();
  /** A person stopped the agent on the board: no wait until the session works again. */
  let stopped = false;

  const report = (sessionID, state, more = []) => {
    const id = root(sessionID);
    if (!id || states.get(id) === state) return;
    states.set(id, state);
    orlan(["hook", state, ...more], { sessionID: id });
  };

  const endWait = () => {
    wait?.child.kill();
    wait = undefined;
  };

  const startWait = (sessionID) => {
    if (stopped || wait?.sessionID === sessionID) return;
    endWait();
    // Standard input stays open: when OpenCode exits, it closes, and the wait ends with it.
    const child = orlan(["hook", "wait"]);
    wait = { sessionID, child };
    let out = "";
    child.stdout.setEncoding("utf8").on("data", (chunk) => {
      out += chunk;
    });
    child.on("close", async (code) => {
      if (wait?.child === child) wait = undefined;
      // A wait that printed and exited 0 took the request: it goes to the session even when the
      // session works again now. OpenCode queues a prompt for a busy session.
      if (code !== 0 || !out.trim()) return;
      const answer = JSON.parse(out);
      if (answer.prompt) {
        await client.session.promptAsync({
          path: { id: sessionID },
          body: { parts: [{ type: "text", text: answer.prompt }] },
        });
      } else if (answer.stopped) {
        stopped = true;
        await client.tui.showToast({ body: { message: answer.stopped, variant: "warning" } }).catch(() => {});
      }
    });
  };

  return {
    event: async ({ event }) => {
      const properties = event.properties ?? {};
      switch (event.type) {
        case "session.created":
        case "session.updated":
          if (properties.info?.parentID) parents.set(properties.info.id, root(properties.info.parentID));
          return;
        case "session.status":
          if (properties.status?.type !== "busy" || parents.has(properties.sessionID)) return;
          stopped = false;
          if (wait?.sessionID === properties.sessionID) endWait();
          report(properties.sessionID, "working");
          return;
        case "permission.asked":
          report(properties.sessionID, "needs-input", ["--prompt", "permission"]);
          return;
        case "permission.replied":
          report(properties.sessionID, "working");
          return;
        case "session.idle":
          if (parents.has(properties.sessionID)) return;
          report(properties.sessionID, "idle");
          startWait(properties.sessionID);
          return;
        case "session.deleted":
          if (parents.has(properties.info?.id)) return;
          if (wait?.sessionID === properties.info?.id) endWait();
          report(properties.info?.id, "done");
          return;
      }
    },
  };
};
