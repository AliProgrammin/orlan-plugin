import { spawn } from "node:child_process";
/**
 * Opens a URL in the person's browser, without waiting for it. $BROWSER wins when it is set, as in
 * other command line tools. Returns false when no browser could start: the command then prints the URL.
 */
export function openBrowser(url) {
    const [command, args] = process.env.BROWSER
        ? [process.env.BROWSER, [url]]
        : process.platform === "darwin"
            ? ["open", [url]]
            : process.platform === "win32"
                ? ["cmd", ["/c", "start", '""', url.replaceAll("&", "^&")]]
                : ["xdg-open", [url]];
    return new Promise((resolve) => {
        try {
            const child = spawn(command, args, { detached: true, stdio: "ignore" });
            child.on("error", () => resolve(false));
            child.on("spawn", () => {
                child.unref();
                resolve(true);
            });
        }
        catch {
            resolve(false);
        }
    });
}
