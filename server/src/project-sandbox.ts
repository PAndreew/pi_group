import { existsSync, realpathSync, statSync } from "node:fs";
import path from "node:path";

/** Explicit mounts only. Never bind the host root, HOME, /proc, or /tmp. */
export interface ProjectSandbox {
	readOnly: string[];
	writable: string[];
	cwd: string;
}

const contains = (root: string, file: string) => file === root || file.startsWith(root + path.sep);
const runtimeRoots = ["/usr", "/lib", "/lib64", "/bin", "/sbin"];
const reserved = ["/etc", "/proc", "/sys", "/dev", "/run", "/tmp", ...runtimeRoots];

function canonicalDirectory(input: string) {
	if (!path.isAbsolute(input)) throw new Error("Sandbox roots must be absolute");
	const root = realpathSync(input);
	if (!statSync(root).isDirectory()) throw new Error("Sandbox roots must be directories");
	if (root === "/" || reserved.some(p => contains(p, root) || contains(root, p))) throw new Error(`Unsafe sandbox root: ${root}`);
	return root;
}

/** Deny socket creation (including mounted Unix sockets) and io_uring bypasses.
 * Only these audited architectures are supported; unknown ones fail closed.
 * socketpair remains available for private child-process IPC.
 */
export function sandboxSeccomp() {
	const arch = process.arch === "arm64" ? { audit: 0xc00000b7, socket: 198 } : process.arch === "x64" ? { audit: 0xc000003e, socket: 41 } : undefined;
	if (!arch) throw new Error("Unsupported sandbox seccomp architecture");
	const instructions = [
		[0x20, 0, 0, 4], // load seccomp_data.arch
		[0x15, 1, 0, arch.audit],
		[0x06, 0, 0, 0x80000000], // kill wrong ABI
		[0x20, 0, 0, 0], // load syscall number
		[0x35, 3, 0, 0x40000000], // reject x32 syscall ABI
		[0x15, 2, 0, arch.socket],
		[0x15, 1, 0, 425], // io_uring_setup
		[0x06, 0, 0, 0x7fff0000], // allow
		[0x06, 0, 0, 0x00050001], // EPERM
	];
	const buffer = Buffer.alloc(instructions.length * 8);
	instructions.forEach(([code, jt, jf, k], i) => {
		buffer.writeUInt16LE(code, i * 8);
		buffer[i * 8 + 2] = jt;
		buffer[i * 8 + 3] = jf;
		buffer.writeUInt32LE(k, i * 8 + 4);
	});
	return buffer;
}

/**
 * A Linux filesystem boundary for untrusted commands, with no network or server
 * credentials. Network access must later go through a capability-scoped proxy.
 * Callers must authorize every root first. This does not infer permission from cwd.
 * A missing/unusable bwrap fails closed; there is no unsandboxed fallback.
 */
export function projectSandboxCommand(profile: ProjectSandbox, command: string, args: string[]) {
	const readOnly = [...new Set(profile.readOnly.map(canonicalDirectory))];
	const writable = [...new Set(profile.writable.map(canonicalDirectory))];
	// Overlapping mounts make read-only guarantees ambiguous. Reject, don't guess.
	const roots = [...readOnly, ...writable];
	for (let i = 0; i < roots.length; i++) for (let j = i + 1; j < roots.length; j++) {
		if (contains(roots[i], roots[j]) || contains(roots[j], roots[i])) throw new Error("Overlapping sandbox roots");
	}
	const cwd = realpathSync(profile.cwd);
	if (!roots.some(root => contains(root, cwd))) throw new Error("Working directory is outside sandbox roots");
	if (!path.isAbsolute(command)) throw new Error("Sandbox command must be absolute");
	const argv = ["--die-with-parent", "--new-session", "--unshare-all", "--cap-drop", "ALL", "--clearenv", "--setenv", "PATH", "/usr/bin:/bin", "--setenv", "HOME", "/tmp/home", "--setenv", "TMPDIR", "/tmp"];
	for (const root of runtimeRoots) if (existsSync(root)) argv.push("--ro-bind", realpathSync(root), root);
	argv.push("--proc", "/proc", "--dev", "/dev", "--tmpfs", "/tmp", "--dir", "/tmp/home");
	for (const root of readOnly) argv.push("--ro-bind", root, root);
	for (const root of writable) argv.push("--bind", root, root);
	argv.push("--chdir", cwd, "--", command, ...args);
	return { command: "/usr/bin/bwrap", args: argv };
}
