# Process watches

When the agent starts something long (a model fit, a build, a big download), it arms a **watch** and ends its turn instead of polling. The server does the waiting without involving a model. When the watch fires, everyone involved in the session gets a notification, and the session receives a message with the outcome, which wakes the agent so it can continue.

The agent uses the `process_watch` tool (`server/extensions/process-watch.mjs` for pi, and a built-in tool for pi-durable). Chat and memory sessions cannot arm watches.

## How it works

1. **Arming.** The server connects to the host over SSH and installs or updates the helper `~/.pi-watch/pi-watch` (`server/extensions/lib/pi-watch.sh`, which needs only POSIX `sh`). It then starts a detached watcher there with `setsid`/`nohup`, so the watcher survives the SSH session.
2. **Watching.** The watcher runs on the host and checks every 10 seconds. It renews `~/.pi-watch/<id>/heartbeat` on each check and writes `result` once, when the watch ends.
3. **Polling.** Every 30 seconds, the server reads the status of every armed watch on a host with one SSH call over a shared connection (`ControlMaster`). This read never changes anything on the host.
4. **Firing.** The server notifies the session's people (in-app and Web Push) and queues the event for the session. Once the agent is idle, every fired watch of the session goes to it in one message. The message carries the outcome, how long it ran, the log path and the log's last 40 lines, fenced as data.

The outcome is kept in a file on the host, so nothing is lost while the server restarts or the network drops: the next read picks it up.

## Kinds

| Kind | Fires when | Notes |
|---|---|---|
| `run` | The command started by beezy exits | Output goes to `~/.pi-watch/<id>/log`; reports the real exit code. The recommended kind. |
| `pid` | An existing process ends | The pid is stored with the process's start time, so a reused pid is not mistaken for it. The exit code is unknown. |
| `log` | A line written after arming matches `pattern`, or `failPattern` | Extended regex (`grep -E`). Lines already in the file when the watch was armed are ignored. |
| `file` | The path appears (or changes, if it existed) and stops growing | |

**Quiet logs.** A `run`, `log` or `pid` watch can also take `quietMinutes`: the watch fires when the log has not grown for that long, which catches a hung job before the deadline. `run` and `log` watches watch their own log; a `pid` watch needs `path` to name the process's log. A log that does not exist yet counts as quiet from the moment the watch was armed. The process is left running.

The server also fires a watch itself when:

- **stopped**: the host answers but the heartbeat is more than 3 minutes old (the watcher was killed or the host restarted).
- **lost**: `~/.pi-watch/<id>` is gone from the host.
- **deadline**: the deadline passed (default 24 hours, at most 7 days; the agent can extend it). The remote watcher is stopped; the process is left running.

If a host cannot be reached for more than 10 minutes, people are notified once. The watch stays armed until the host answers again or the deadline passes.

## Hosts

`host` is an SSH destination: a `~/.ssh/config` alias or `user@host`, optionally with `port`. The server runs `ssh` as its own user, with the keys and config already on this machine, in batch mode (no password prompts). Jump hosts and other options belong in `~/.ssh/config`. The host must already be in `known_hosts`. `local` watches this machine (not available when the server runs on Windows).

## Guards

- Arming runs only what the agent could run itself over SSH, during its own turn. Polling runs a fixed, read-only status command. Nothing an agent provides is run later without a person present, so watches need no approval, unlike scheduled-job scripts.
- At most 10 active watches per session and 30 per owner, and at most 20 watches armed per session per hour.
- Log lines are untrusted: they reach the agent fenced and labelled as data.
- The wake-up prompt is sent as the session's owner, and only while the owner can still write to the session. Delivery is retried 5 times, then people are told it failed.
- People with write access see armed watches above the message box ("Waiting on …") and can stop them. Stopping a watch leaves the process running.
- Watch folders on a host are removed two weeks after their last heartbeat.

## Where watches cannot help

- Hosts reached only with a password, a one-time code or a hardware key: batch-mode SSH cannot log in.
- Hosts without a POSIX `sh` (plain Windows), or where the home directory is read-only or full.
- Work that does not run as a process on the host: jobs inside Kubernetes, Slurm or cloud training services, where the process on the login node is only a client. Watch a log or output file on shared storage instead.
- Hangs that keep logging: `quietMinutes` catches a job that stops writing its log, but not one that keeps printing while making no progress.
- Buffered output: Python buffers stdout when it goes to a file, so log lines can arrive late. Use `python -u` or `PYTHONUNBUFFERED=1`.
