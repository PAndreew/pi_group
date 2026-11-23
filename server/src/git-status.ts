import { execFile } from "node:child_process";

/** A session folder's git state, as shown under the session title. */
export interface GitStatus {
	/** Branch name, or a short commit id when the HEAD is detached. */
	branch: string;
	detached: boolean;
	/** Changed, staged, untracked and conflicted files together. */
	files: number;
	/** Remote tracking branch (e.g. origin/main), if any. */
	upstream?: string;
	ahead: number;
	behind: number;
	/** When the remote was last fetched successfully by us, if ever (behind is only as fresh as that). */
	fetchedAt?: number;
	/** The last background fetch failed (no network, no credentials); `behind` may be out of date. */
	fetchFailed?: boolean;
}

/** git never prompts here: a fetch that needs credentials fails instead of hanging. */
const env = { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_SSH_COMMAND: "ssh -o BatchMode=yes -o ConnectTimeout=10", LC_ALL: "C" };

function git(cwd: string, args: string[], timeout = 5000): Promise<string> {
	return new Promise((resolve, reject) => {
		execFile("git", args, { cwd, env, timeout, maxBuffer: 16 * 1024 * 1024 }, (error, stdout) => (error ? reject(error) : resolve(stdout)));
	});
}

/** Parses `git status --porcelain=v2 --branch` output. */
export function parseStatus(out: string): GitStatus {
	const status: GitStatus = { branch: "", detached: false, files: 0, ahead: 0, behind: 0 };
	let oid = "";
	for (const line of out.split("\n")) {
		if (!line) continue;
		if (line.startsWith("# branch.oid ")) oid = line.slice(13);
		else if (line.startsWith("# branch.head ")) status.branch = line.slice(14);
		else if (line.startsWith("# branch.upstream ")) status.upstream = line.slice(18);
		else if (line.startsWith("# branch.ab ")) {
			const [, ahead, behind] = /\+(\d+) -(\d+)/.exec(line) ?? [];
			status.ahead = Number(ahead) || 0;
			status.behind = Number(behind) || 0;
		} else if (!line.startsWith("#")) status.files++;
	}
	if (status.branch === "(detached)") {
		status.detached = true;
		status.branch = oid && oid !== "(initial)" ? oid.slice(0, 7) : "detached";
	}
	return status;
}

/** Fetch the remote at most this often per repository, in the background. */
const FETCH_EVERY_MS = 5 * 60_000;
const fetches = new Map<string, { at: number; ok?: number; failed?: boolean; running?: Promise<void> }>();

function fetchInBackground(root: string) {
	const entry = fetches.get(root) ?? { at: 0 };
	fetches.set(root, entry);
	if (entry.running || Date.now() - entry.at < FETCH_EVERY_MS) return;
	entry.at = Date.now();
	entry.running = git(root, ["fetch", "--quiet", "--no-tags", "--no-recurse-submodules"], 30_000)
		.then(() => { entry.ok = Date.now(); entry.failed = false; })
		.catch(() => { entry.failed = true; })
		.finally(() => { entry.running = undefined; });
}

/**
 * The git state of `cwd`, or null when it is not inside a work tree (or git is missing).
 * Reading never waits for the network; a throttled fetch keeps `behind` reasonably fresh.
 */
export async function gitStatus(cwd: string, options: { fetch?: boolean } = {}): Promise<GitStatus | null> {
	let root: string;
	try {
		root = (await git(cwd, ["rev-parse", "--show-toplevel"])).trim();
	} catch {
		return null;
	}
	let status: GitStatus;
	try {
		status = parseStatus(await git(root, ["--no-optional-locks", "status", "--porcelain=v2", "--branch", "--untracked-files=normal"], 10_000));
	} catch {
		return null;
	}
	if (status.upstream && options.fetch !== false) fetchInBackground(root);
	const fetched = fetches.get(root);
	if (fetched?.ok) status.fetchedAt = fetched.ok;
	if (fetched?.failed) status.fetchFailed = true;
	return status;
}
