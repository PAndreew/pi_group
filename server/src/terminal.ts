import { type ChildProcess, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import type { IncomingMessage, Server } from "node:http";
import os from "node:os";
import type { Duplex } from "node:stream";
import type { Request, Response } from "express";
import { WebSocketServer, type WebSocket } from "ws";
import { authenticate } from "./auth.js";
import { config } from "./config.js";
import { resolveSafe } from "./files.js";
import { store } from "./store.js";
import { tenantAccess, isTenantMember } from "./tenants.js";
import { tenantId } from "./tenant-context.js";

/** A shell on a pseudo-terminal, whichever backend provides it. */
interface Pty {
	write(data: string): void;
	resize(cols: number, rows: number): void;
	kill(): void;
	onData(listener: (data: string) => void): void;
	onExit(listener: (code: number | null) => void): void;
}

/**
 * Fallback when node-pty is not built (common on Termux or a Pi without a compiler): Python's pty
 * module relays stdin/stdout, and resize requests arrive as "cols rows" lines on fd 3.
 */
const PY_PTY = `
import fcntl, os, pty, select, struct, sys, termios
pid, fd = pty.fork()
if pid == 0:
    os.execvp(sys.argv[1], [sys.argv[1], "-l"])
ctl = b""
watched = [fd, 0, 3]
while True:
    try:
        ready = select.select(watched, [], [])[0]
    except InterruptedError:
        continue
    if fd in ready:
        try:
            data = os.read(fd, 65536)
        except OSError:
            break
        if not data:
            break
        os.write(1, data)
    if 0 in ready:
        data = os.read(0, 65536)
        if not data:
            break
        os.write(fd, data)
    if 3 in ready:
        chunk = os.read(3, 1024)
        if not chunk:
            watched.remove(3)
            continue
        ctl += chunk
        while b"\\n" in ctl:
            line, ctl = ctl.split(b"\\n", 1)
            cols, rows = (int(v) for v in line.split())
            fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", rows, cols, 0, 0))
try:
    os.kill(pid, 1)
except OSError:
    pass
_, status = os.waitpid(pid, 0)
sys.exit(os.waitstatus_to_exitcode(status) if hasattr(os, "waitstatus_to_exitcode") else 0)
`;

function pythonPty(shell: string, cwd: string, env: NodeJS.ProcessEnv, cols: number, rows: number): Pty {
	const child: ChildProcess = spawn(process.env.PYTHON || "python3", ["-c", PY_PTY, shell], { cwd, env, stdio: ["pipe", "pipe", "pipe", "pipe"] });
	const control = child.stdio[3] as NodeJS.WritableStream;
	const resize = (c: number, r: number) => control.write(`${c} ${r}\n`);
	resize(cols, rows);
	return {
		write: (data) => child.stdin?.write(data),
		resize,
		kill: () => child.kill("SIGHUP"),
		onData: (listener) => {
			child.stdout?.setEncoding("utf8").on("data", listener);
			child.stderr?.setEncoding("utf8").on("data", listener);
		},
		onExit: (listener) => {
			child.on("exit", listener);
			child.on("error", (error) => {
				listener(null);
				console.warn("terminal:", error.message);
			});
		},
	};
}

type NodePty = { spawn: (file: string, args: string[], options: Record<string, unknown>) => Any };
type Any = any;
let nodePty: Promise<NodePty | undefined> | undefined;

async function openPty(cwd: string, cols: number, rows: number): Promise<Pty> {
	const shell = process.env.SHELL || (process.platform === "win32" ? "powershell.exe" : "bash");
	const env = { ...process.env, TERM: "xterm-256color", COLORTERM: "truecolor" };
	nodePty ??= import("node-pty" as string).then(
		(m) => (m.default ?? m) as NodePty,
		() => undefined,
	);
	const native = await nodePty;
	if (!native) return pythonPty(shell, cwd, env, cols, rows);
	const pty = native.spawn(shell, process.platform === "win32" ? [] : ["-l"], { name: "xterm-256color", cols, rows, cwd, env });
	return {
		write: (data) => pty.write(data),
		resize: (c, r) => pty.resize(c, r),
		kill: () => pty.kill(),
		onData: (listener) => pty.onData(listener),
		onExit: (listener) => pty.onExit(({ exitCode }: { exitCode: number }) => listener(exitCode)),
	};
}

const size = (value: unknown, fallback: number, max: number) => Math.min(Math.max(Number(value) || fallback, 2), max);

/** WebSockets cannot carry the X-Pi-Group header, so cross-site use is blocked by checking Origin. */
function sameOrigin(req: IncomingMessage) {
	const origin = req.headers.origin;
	if (!origin) return false;
	const host = new URL(origin).host;
	const forwarded = String(req.headers["x-forwarded-host"] ?? "").split(",")[0].trim();
	return host === req.headers.host || (forwarded !== "" && host === forwarded);
}

/**
 * Admin shell over a WebSocket at /api/terminal?key=<session>|path=<folder>&cols=&rows=, started in
 * the session's folder (or the given one). Client frames are JSON: {type:"input",data} or {type:"resize",cols,rows}; server frames
 * are raw terminal output. Closing the socket ends the shell.
 */
export function attachTerminal(server: Server) {
	const wss = new WebSocketServer({ noServer: true, maxPayload: 1024 * 1024 });

	server.on("upgrade", (req: IncomingMessage, socket: Duplex, head: Buffer) => {
		const url = new URL(req.url ?? "/", "http://localhost");
		if (url.pathname !== "/api/terminal") return void socket.destroy();
		const request = req as Request;
		authenticate(request, {} as Response, () => {
		const refuse = (status: string) => {
			socket.write(`HTTP/1.1 ${status}\r\nConnection: close\r\n\r\n`);
			socket.destroy();
		};
		if (!request.user) return refuse("401 Unauthorized");
		if (request.user.role !== "admin" || !isTenantMember(request.user.id)) return refuse("403 Forbidden");
		if (url.searchParams.get("tenant") && url.searchParams.get("tenant") !== tenantId()) return refuse("403 Forbidden");
		if (!sameOrigin(req)) return refuse("403 Forbidden");
		const meta = store.session(url.searchParams.get("key") ?? "");
		if (url.searchParams.has("key") && (!meta || !tenantAccess(request.user, meta))) return refuse("404 Not Found");
		const folder = (() => {
			try {
				return url.searchParams.has("path") ? resolveSafe(url.searchParams.get("path")) : undefined;
			} catch {
				return undefined;
			}
		})();
		const cwd = meta && existsSync(meta.cwd) ? meta.cwd : folder && existsSync(folder) ? folder : existsSync(config.fsRoot) ? config.fsRoot : os.homedir();
		wss.handleUpgrade(req, socket, head, (ws) => void run(ws, cwd, size(url.searchParams.get("cols"), 80, 500), size(url.searchParams.get("rows"), 24, 200)));
		});
	});

	async function run(ws: WebSocket, cwd: string, cols: number, rows: number) {
		let pty: Pty;
		try {
			pty = await openPty(cwd, cols, rows);
		} catch (error) {
			return ws.close(4000, `Could not start a shell: ${(error as Error).message}`.slice(0, 120));
		}
		pty.onData((data) => ws.readyState === ws.OPEN && ws.send(data));
		pty.onExit((code) => ws.close(1000, code === null ? "Shell could not start (is python3 installed?)" : `Shell exited (${code})`));
		ws.on("message", (raw) => {
			try {
				const message = JSON.parse(String(raw));
				if (message.type === "input" && typeof message.data === "string") pty.write(message.data);
				else if (message.type === "resize") pty.resize(size(message.cols, cols, 500), size(message.rows, rows, 200));
			} catch {
				// Ignore malformed frames.
			}
		});
		ws.on("close", () => {
			// Also after the shell exited: node-pty releases its handles only on kill.
			try {
				pty.kill();
			} catch {
				// Already gone.
			}
		});
	}
}
