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

/** Allow TCP/UDP sockets (the shell may use the internet) but deny every other socket family:
 * Unix sockets would reach host services such as D-Bus or Docker, including abstract
 * sockets in the shared network namespace. Also deny io_uring, which bypasses this filter.
 * Only these audited architectures are supported; unknown ones fail closed.
 * socketpair remains available for private child-process IPC.
 */
export function sandboxSeccomp() {
	const arch = process.arch === "arm64" ? { audit: 0xc00000b7, socket: 198 } : process.arch === "x64" ? { audit: 0xc000003e, socket: 41 } : undefined;
	if (!arch) throw new Error("Unsupported sandbox seccomp architecture");
	const instructions = [
		[0x20, 0, 0, 4], // 0: load seccomp_data.arch
		[0x15, 1, 0, arch.audit],
		[0x06, 0, 0, 0x80000000], // 2: kill wrong ABI
		[0x20, 0, 0, 0], // 3: load syscall number
		[0x35, 6, 0, 0x40000000], // 4: reject x32 syscall ABI
		[0x15, 5, 0, 425], // 5: io_uring_setup
		[0x15, 0, 3, arch.socket], // 6: socket → check its family; any other syscall → allow
		[0x20, 0, 0, 16], // 7: load socket's domain (args[0], low word)
		[0x15, 1, 0, 2], // 8: AF_INET
		[0x15, 0, 1, 10], // 9: AF_INET6
		[0x06, 0, 0, 0x7fff0000], // 10: allow
		[0x06, 0, 0, 0x00050001], // 11: EPERM
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

/** Read-only host configuration a networked shell needs: DNS, TLS roots, user names, git defaults. */
const etcFiles = ["/etc/resolv.conf", "/etc/hosts", "/etc/nsswitch.conf", "/etc/passwd", "/etc/group", "/etc/ssl", "/etc/ca-certificates", "/etc/pki", "/etc/alternatives", "/etc/localtime", "/etc/gitconfig"];

/**
 * A Linux filesystem boundary for untrusted commands, without server credentials.
 * TCP/UDP networking is shared with the host; other socket families are denied by sandboxSeccomp.
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
	const argv = ["--die-with-parent", "--new-session", "--unshare-all", "--share-net", "--cap-drop", "ALL", "--clearenv", "--setenv", "PATH", "/usr/bin:/bin", "--setenv", "HOME", "/tmp/home", "--setenv", "TMPDIR", "/tmp"];
	for (const root of runtimeRoots) if (existsSync(root)) argv.push("--ro-bind", realpathSync(root), root);
	for (const file of etcFiles) if (existsSync(file)) argv.push("--ro-bind", realpathSync(file), file);
	argv.push("--proc", "/proc", "--dev", "/dev", "--tmpfs", "/tmp", "--dir", "/tmp/home");
	for (const root of readOnly) argv.push("--ro-bind", root, root);
	for (const root of writable) argv.push("--bind", root, root);
	argv.push("--chdir", cwd, "--", command, ...args);
	return { command: "/usr/bin/bwrap", args: argv };
}
