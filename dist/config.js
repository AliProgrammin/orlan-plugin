/**
 * What the CLI keeps between commands, in the user config folder: the server, who signed in, and the
 * agents it connected. The secrets are not in this file: they go to the OS keychain (secrets.ts).
 */
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
/** The server when neither --server nor ORLAN_SERVER names one. */
export const DEFAULT_SERVER = "https://orlan.app";
/** $ORLAN_CONFIG_DIR, else the platform's user config folder. */
export function configDir(env = process.env) {
    if (env.ORLAN_CONFIG_DIR)
        return env.ORLAN_CONFIG_DIR;
    if (process.platform === "win32" && env.APPDATA)
        return path.join(env.APPDATA, "orlan");
    return path.join(env.XDG_CONFIG_HOME || path.join(homedir(), ".config"), "orlan");
}
const configFile = () => path.join(configDir(), "config.json");
/** The origin of a server address: https://orlan.app/ and https://orlan.app/t/1 are the same server. */
export function serverOrigin(server) {
    let url;
    try {
        url = new URL(server);
    }
    catch {
        throw new Error(`"${server}" is not a server address. Use a full address, for example https://orlan.app.`);
    }
    if (url.protocol !== "https:" && url.protocol !== "http:") {
        throw new Error(`"${server}" is not an http or https address.`);
    }
    return url.origin;
}
export async function readConfig() {
    let saved = {};
    try {
        saved = JSON.parse(await readFile(configFile(), "utf8"));
    }
    catch (error) {
        if (error.code !== "ENOENT")
            throw error;
    }
    return {
        ...saved,
        server: serverOrigin(process.env.ORLAN_SERVER || saved.server || DEFAULT_SERVER),
        agents: saved.agents ?? {},
    };
}
/** Writes the whole file at once, so a stopped command never leaves half a file. */
export async function writeConfig(config) {
    const file = configFile();
    await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
    const temporary = `${file}.${process.pid}.tmp`;
    await writeFile(temporary, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
    await rename(temporary, file);
}
