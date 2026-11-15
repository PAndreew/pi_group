// The process_watch tool, shared by the pi RPC extension (../process-watch.mjs) and the pi-durable adapter.
// The server does the waiting, so a long job costs no tokens until it ends. See docs/process-watches.md.

export const WATCH_TOOL = {
  name: "process_watch",
  label: "Process watch",
  description: [
    "Wait for something long-running without polling: a training run, a build, a download, a batch job.",
    "action=arm starts a watch on a machine you reach over SSH (host = a ~/.ssh/config alias or user@host, keys only, no passwords) or on this machine (host=local). Then END YOUR TURN: when the watch fires, the people in this session are notified and you receive a message here with the outcome (and the log's last lines), so you can continue. Never poll a watched process yourself.",
    "Kinds:",
    "- run: beezy starts `command` itself (in `cwd`), detached so it survives your SSH session, logs its output to ~/.pi-watch/<id>/log and reports its exit code. Prefer this for anything you start. For Python use `python -u` so the log is not buffered.",
    "- pid: a process that is already running; fires when it ends (the exit code is unknown, so check its output).",
    "- log: fires when a line written to `path` after arming matches `pattern` (extended regex, e.g. \"Epoch 50/50|Training complete\"), or `failPattern` (e.g. \"Traceback|Error|Killed\") for an early failure.",
    "- file: fires when `path` appears (or changes, if it already exists) and has stopped growing.",
    "Add quietMinutes to a run, log or pid watch to also be woken when its log stops growing for that long, so a hung job is caught before the deadline (pick well above the slowest normal gap between log lines, e.g. 30 for a fit that logs every epoch).",
    "Every watch has a deadline (deadlineHours, default 24, at most 168); when it passes you are woken too. If the watcher stops reporting (the machine restarted, the watcher was killed) or its files disappear, you are woken with that.",
    "action=list shows this session's watches; action=cancel stops watching (the process keeps running); action=extend sets a new deadline from now.",
  ].join("\n"),
  parameters: {
    type: "object",
    additionalProperties: false,
    properties: {
      action: { type: "string", enum: ["arm", "list", "cancel", "extend"] },
      host: { type: "string", maxLength: 200, description: "arm: SSH destination (alias or user@host), or \"local\"." },
      port: { type: "integer", minimum: 1, maximum: 65535, description: "arm: SSH port, if not 22 and not set in ~/.ssh/config." },
      kind: { type: "string", enum: ["run", "pid", "log", "file"], description: "arm: what to watch." },
      label: { type: "string", maxLength: 120, description: "arm: short name people see in the notification, e.g. \"XGBoost fit\"." },
      command: { type: "string", maxLength: 4000, description: "run: the shell command to start." },
      cwd: { type: "string", maxLength: 1000, description: "run: absolute folder to start it in (default: home)." },
      pid: { type: "integer", minimum: 1, description: "pid: the process id." },
      path: { type: "string", maxLength: 1000, description: "log/file: absolute path on the host; pid with quietMinutes: the process's log." },
      pattern: { type: "string", maxLength: 500, description: "log: extended regex for success." },
      failPattern: { type: "string", maxLength: 500, description: "log: extended regex for failure (optional)." },
      quietMinutes: { type: "number", minimum: 1, maximum: 1440, description: "run/log/pid: also fire when the log has not grown for this many minutes (a hang). For pid, `path` names the log." },
      deadlineHours: { type: "number", minimum: 0.05, maximum: 168, description: "arm/extend: hours until the deadline (default 24)." },
      id: { type: "string", maxLength: 100, description: "cancel/extend: the watch id." },
    },
    required: ["action"],
  },
};

/** Drops absent fields so the server's strict per-action schema accepts the call. */
export function watchInput(params) {
  return Object.fromEntries(Object.entries(params ?? {}).filter(([, v]) => v !== undefined && v !== null && v !== ""));
}
