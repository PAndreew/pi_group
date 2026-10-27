// Loaded only by beezy's pi RPC adapter, together with project-scope.mjs. Pi's own read, write, edit
// and bash keep their contracts (truncation, exact-match edits, images), but every file and process
// operation runs on the server inside the project's Bubblewrap sandbox, where only the project's own
// and linked folders exist (read-only for the butler). Nothing here touches the host filesystem,
// except reading operator-installed skill files.
import { realpathSync } from "node:fs";
import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createBashToolDefinition, createEditToolDefinition, createReadToolDefinition, createWriteToolDefinition, getAgentDir } from "@earendil-works/pi-coding-agent";

const images = [["image/png", [0x89, 0x50, 0x4e, 0x47]], ["image/jpeg", [0xff, 0xd8, 0xff]], ["image/gif", [0x47, 0x49, 0x46, 0x38]]];
function imageType(head) {
  for (const [type, magic] of images) if (magic.every((byte, i) => head[i] === byte)) return type;
  return head.subarray(0, 4).toString("latin1") === "RIFF" && head.subarray(8, 12).toString("latin1") === "WEBP" ? "image/webp" : null;
}

export default function (pi) {
  const url = process.env.BEEZY_AGENT_URL;
  const token = process.env.BEEZY_INTERACTION_TOKEN;
  if (!url || !token) throw new Error("Missing scoped agent bridge");
  const request = async (body, signal) => {
    const response = await fetch(url, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(body), signal });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || `Sandbox request failed (${response.status})`);
    return result;
  };
  const file = (op, file, data) => request({ action: "file", op, path: file, ...(data === undefined ? {} : { data }) });

  // Skills live outside every project; pi tells the model to read their SKILL.md. Read-only.
  const skillRoots = [path.join(getAgentDir(), "skills"), path.join(os.homedir(), ".agents", "skills")].flatMap(root => { try { return [realpathSync(root)]; } catch { return []; } });
  const skill = p => { try { const real = realpathSync(p); return skillRoots.some(root => real.startsWith(root + path.sep)); } catch { return false; } };

  const readFileOp = async p => skill(p) ? readFile(p) : Buffer.from((await file("read", p)).data, "base64");
  const access = mode => async p => { if (!skill(p) || mode === "accessWrite") await file(mode, p); };
  const writeFileOp = async (p, content) => { await file("write", p, Buffer.from(content, "utf8").toString("base64")); };
  const readOps = {
    readFile: readFileOp,
    access: access("access"),
    detectImageMimeType: async p => imageType(skill(p) ? (await readFile(p)).subarray(0, 64) : Buffer.from((await file("head", p)).data, "base64")),
  };
  const writeOps = { writeFile: writeFileOp, mkdir: async dir => { await file("mkdir", dir); } };
  const editOps = { readFile: readFileOp, writeFile: writeFileOp, access: access("accessWrite") };
  const bashOps = {
    exec: async (command, cwd, { onData, signal, timeout }) => {
      const result = await request({ action: "bash", command, cwd, ...(timeout ? { timeout: Math.min(timeout, 3600) } : {}) }, signal).catch(error => {
        throw signal?.aborted ? new Error("aborted") : error;
      });
      if (result.output) onData(Buffer.from(result.output, "utf8"));
      if (result.timedOut) throw new Error(`timeout:${timeout ?? 1800}`);
      return { exitCode: result.exitCode };
    },
  };

  // The sandbox's working folder can differ from pi's (a General group chat works in its own subfolder).
  let cwd;
  const sandboxCwd = async () => cwd ??= (await request({ action: "scope" })).profile?.cwd ?? process.cwd();
  const sandboxed = (create, options) => {
    const definition = create(process.cwd(), options);
    pi.registerTool({
      ...definition,
      async execute(id, params, signal, onUpdate, ctx) {
        return create(await sandboxCwd(), options).execute(id, params, signal, onUpdate, ctx);
      },
    });
  };
  sandboxed(createReadToolDefinition, { operations: readOps });
  sandboxed(createWriteToolDefinition, { operations: writeOps });
  sandboxed(createEditToolDefinition, { operations: editOps });
  sandboxed(createBashToolDefinition, { operations: bashOps, exposeSessionEnvironment: false });
  pi.on("user_bash", () => ({ operations: bashOps }));
}
