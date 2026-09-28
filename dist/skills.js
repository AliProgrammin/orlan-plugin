/**
 * The Orlan skills `orlan skills add` writes where an agent reads skills. Each is a SKILL.md in the
 * package's skills/ folder, the same files the Claude Code plugin loads (F044).
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { skillsDir } from "./agents.js";
export const skillNames = ["orlan-review", "orlan-versions"];
/** Writes every Orlan skill for the agent. Returns the folders it wrote. */
export async function writeSkills(agent, cwd = process.cwd()) {
    const root = skillsDir(agent, cwd);
    const written = [];
    for (const name of skillNames) {
        const folder = path.join(root, name);
        await mkdir(folder, { recursive: true });
        await writeFile(path.join(folder, "SKILL.md"), await readFile(new URL(`../skills/${name}/SKILL.md`, import.meta.url), "utf8"));
        written.push(folder);
    }
    return written;
}
