#!/usr/bin/env node
/**
 * The orlan command (F026, decision D023). `orlan help` lists the commands; `orlan <command> --help`
 * shows one.
 */
import { readFileSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { commands } from "./commands.js";
import { OrlanError } from "./http.js";
const { version } = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
function overview() {
    const width = Math.max(...Object.keys(commands).map((name) => name.length));
    return [
        "orlan - connect an agent to Orlan, and work with its topics, files and comments.",
        "",
        "Set up:",
        "  npm i -g @orlan-maker/cli",
        "  orlan auth login",
        "  orlan skills add --agent <id>",
        "  orlan mcp connect --agent <id>",
        "",
        "Commands:",
        ...Object.entries(commands).map(([name, command]) => `  ${name.padEnd(width)}  ${command.summary}`),
        "",
        "Agents: claude-code, codex, cursor, opencode, other.",
        "Run `orlan <command> --help` for the options of a command. `orlan --version` prints the version.",
    ].join("\n");
}
function commandHelp(command) {
    return [
        `Usage: ${command.usage}`,
        "",
        command.summary,
        ...(command.details.length ? ["", ...command.details] : []),
    ].join("\n");
}
/** Finds the command the arguments name: one word ("status") or two ("auth login"). */
function findCommand(args) {
    const two = args.slice(0, 2).join(" ");
    if (commands[two])
        return { name: two, rest: args.slice(2) };
    const one = args[0] ?? "";
    if (commands[one])
        return { name: one, rest: args.slice(1) };
    return undefined;
}
/** Runs the command line and returns the exit code. */
export async function main(args, io) {
    if (args.length === 0 || args[0] === "help" || args[0] === "--help" || args[0] === "-h") {
        const asked = args[0] === "help" ? findCommand(args.slice(1)) : undefined;
        io.out(asked ? commandHelp(commands[asked.name]) : overview());
        return 0;
    }
    if (args[0] === "--version" || args[0] === "-v") {
        io.out(io.version);
        return 0;
    }
    const found = findCommand(args);
    if (!found) {
        const group = Object.keys(commands).filter((name) => name.startsWith(`${args[0]} `));
        process.stderr.write(group.length
            ? `orlan: "${args.join(" ")}" needs one of: ${group.join(", ")}.\nnext_step: orlan help\n`
            : `orlan: there is no command "${args[0]}".\nnext_step: orlan help\n`);
        return 2;
    }
    const command = commands[found.name];
    if (found.rest.includes("--help") || found.rest.includes("-h")) {
        io.out(commandHelp(command));
        return 0;
    }
    const help = `orlan ${found.name} --help`;
    let parsed;
    try {
        parsed = parseArgs({ args: found.rest, options: command.options, allowPositionals: true, strict: true });
    }
    catch (error) {
        process.stderr.write(`orlan: ${error.message}\nUsage: ${command.usage}\nnext_step: ${help}\n`);
        return 2;
    }
    const [least, most] = command.positionals;
    if (parsed.positionals.length < least || parsed.positionals.length > most) {
        process.stderr.write(`orlan: wrong arguments.\nUsage: ${command.usage}\nnext_step: ${help}\n`);
        return 2;
    }
    try {
        return (await command.run(parsed.values, parsed.positionals, io)) ?? 0;
    }
    catch (error) {
        const missing = error.code === "ENOENT";
        if (!(error instanceof OrlanError) && !missing)
            throw error;
        // Every error says what to do next (F038). With --json it is JSON, like the answer.
        const next = (error instanceof OrlanError ? error.next : undefined) ??
            (missing ? "check the path, then run the command again" : help);
        const code = error instanceof OrlanError ? error.code : "file_missing";
        if (parsed.values.json) {
            io.out(JSON.stringify({ error: code ?? "failed", message: error.message, next_step: next }));
        }
        else {
            process.stderr.write(`orlan: ${error.message}\nnext_step: ${next}\n`);
        }
        return 1;
    }
}
// Runs only as the program, not when a test imports main(). npm starts it through a link, so compare real paths.
const entry = process.argv[1];
if (entry && realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url))) {
    process.exitCode = await main(process.argv.slice(2), {
        out: (line) => process.stdout.write(`${line}\n`),
        flushed: () => new Promise((resolve) => process.stdout.write("", () => resolve())),
        version,
    });
}
