/**
 * The CLI token and the agent tokens. They go to the OS keychain when there is one: the macOS
 * keychain (`security`), or the Secret Service on Linux (`secret-tool`). Else, or with
 * ORLAN_KEYCHAIN=off, to credentials.json in the config folder, readable by this user only (0600).
 * A secret never goes on a command line: both keychain tools read it from standard input.
 */
import { spawn } from "node:child_process";
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { configDir } from "./config.js";
const SERVICE = "orlan";
/** The account name of a secret: the server and what it is for, for example "https://orlan.app#cli". */
export const account = (server, name) => `${server}#${name}`;
function run(command, args, input) {
    return new Promise((resolve, reject) => {
        const child = spawn(command, args, { stdio: ["pipe", "pipe", "ignore"] });
        let stdout = "";
        child.stdout.on("data", (chunk) => {
            stdout += chunk.toString("utf8");
        });
        child.on("error", reject);
        child.on("close", (code) => resolve({ code: code ?? 1, stdout }));
        child.stdin.end(input ?? "");
    });
}
/** Only these characters reach a keychain command, so no quoting can break. */
const safe = (value) => {
    if (!/^[A-Za-z0-9_\-.:/#]+$/.test(value))
        throw new Error(`Orlan cannot store "${value}" in the keychain.`);
    return value;
};
const macKeychain = {
    // `security -i` reads its commands from standard input, so the secret is not in the process list.
    set: async (name, secret) => (await run("/usr/bin/security", ["-i"], `add-generic-password -U -s ${SERVICE} -a "${safe(name)}" -l "Orlan CLI" -w "${safe(secret)}"\n`)).code === 0,
    get: async (name) => {
        const found = await run("/usr/bin/security", ["find-generic-password", "-s", SERVICE, "-a", safe(name), "-w"]);
        return found.code === 0 ? found.stdout.trim() || undefined : undefined;
    },
    delete: async (name) => {
        await run("/usr/bin/security", ["delete-generic-password", "-s", SERVICE, "-a", safe(name)]);
    },
};
const secretService = {
    set: async (name, secret) => (await run("secret-tool", ["store", "--label=Orlan CLI", "service", SERVICE, "account", name], secret)).code === 0,
    get: async (name) => {
        const found = await run("secret-tool", ["lookup", "service", SERVICE, "account", name]);
        return found.code === 0 ? found.stdout.trim() || undefined : undefined;
    },
    delete: async (name) => {
        await run("secret-tool", ["clear", "service", SERVICE, "account", name]);
    },
};
function keychain() {
    if (process.env.ORLAN_KEYCHAIN === "off")
        return undefined;
    if (process.platform === "darwin")
        return macKeychain;
    if (process.platform === "linux")
        return secretService;
    return undefined;
}
/** A keychain call that fails to start (no secret-tool, no D-Bus session) counts as no keychain. */
async function tryKeychain(work) {
    const chain = keychain();
    if (!chain)
        return undefined;
    try {
        return await work(chain);
    }
    catch {
        return undefined;
    }
}
const credentialsFile = () => path.join(configDir(), "credentials.json");
async function readFileStore() {
    try {
        return JSON.parse(await readFile(credentialsFile(), "utf8"));
    }
    catch (error) {
        if (error.code === "ENOENT")
            return {};
        throw error;
    }
}
async function writeFileStore(store) {
    const file = credentialsFile();
    await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
    const temporary = `${file}.${process.pid}.tmp`;
    await writeFile(temporary, `${JSON.stringify(store, null, 2)}\n`, { mode: 0o600 });
    await chmod(temporary, 0o600);
    await rename(temporary, file);
}
/** Stores a secret. Returns where it went. */
export async function setSecret(name, secret) {
    // Read back: `security -i` can end with 0 when its command failed.
    const stored = await tryKeychain(async (chain) => (await chain.set(name, secret)) && (await chain.get(name)) === secret);
    const store = await readFileStore();
    if (stored) {
        // An older copy in the file would outlive the keychain entry.
        if (name in store) {
            delete store[name];
            await writeFileStore(store);
        }
        return "keychain";
    }
    store[name] = secret;
    await writeFileStore(store);
    return "file";
}
export async function getSecret(name) {
    return (await tryKeychain((chain) => chain.get(name))) ?? (await readFileStore())[name];
}
export async function deleteSecret(name) {
    await tryKeychain((chain) => chain.delete(name));
    const store = await readFileStore();
    if (name in store) {
        delete store[name];
        await writeFileStore(store);
    }
}
