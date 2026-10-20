# Scheduled jobs

Ask the agent for something recurring ("every weekday at 7:30, …"). The agent calls its `propose_scheduled_job` tool (`server/extensions/scheduled-jobs.mjs`, pi sessions only) and the job is saved **paused**. It runs only after a person approves it under **Scheduled jobs**: the clock icon below the message box. There, each job is an accordion where you can edit, approve, run, pause or delete it.

## Template

The tool takes, and the server validates, this shape:

```json
{
  "name": "Umbrella check",
  "schedule": "30 7 * * 1-5",
  "session": "new",
  "recipients": ["berci"],
  "reason": "You asked for a weekday rain warning.",
  "steps": [
    { "type": "http", "method": "GET", "url": "https://api.open-meteo.com/v1/forecast?latitude=48.1&longitude=11.6&daily=precipitation_probability_max", "headers": {}, "timeoutSec": 30 },
    { "type": "prompt", "text": "Tell me in one line whether I need an umbrella today:\n{{output}}" }
  ]
}
```

- **schedule**: five-field cron in the server's local time, `@hourly`, `@daily`, `@weekly`, `@monthly` or `@every 2h` (units m, h or d). Nothing runs more often than every 5 minutes.
- **steps** (1–5) run in order. Each step's output goes to the next, and a failing step stops the run.
  - `prompt`: sent to the job's agent session. `{{output}}` marks where the previous output goes; without it, the output is appended. The agent's final reply becomes this step's output.
  - `script`: a shell command run in the job's folder, with the previous output on stdin. `timeoutSec` can be at most 600.
  - `http`: one request using GET, POST, PUT, PATCH or DELETE. `timeoutSec` can be at most 120.
- **session**: `new` (the default) gets a dedicated "⏰ name" session on the first run. `this` uses the session that proposed the job; chat and memory sessions always get a new one.

## Output recipients

Agents can supply `recipients`, an array of exact Beezy account usernames. Unknown usernames are rejected; naming someone in the prompt does not route output. Recipients require `session: "new"` and at least one prompt step. The approval screen displays recipients before approval.

The job still runs as its owner. Recipients receive **read access to the entire dedicated session**, including tool output, and the normal session run notifications. The owner retains access and notifications. Device push requires notification permission and a valid subscription; delivery is not guaranteed. Output is stored in the session, not automatically written to a file. End a multi-step job with a prompt to put its final summary in that session. Existing session history is never shared by an agent proposal using `session: "this"`.

## Guards

- **Nothing an agent proposes runs by itself.** Proposals arrive disabled and unapproved, through a per-session credential the browser never sees. Approval is explicit, and each run checks it again.
- **Scripts need an admin.** They run with the server's permissions, like the terminal. If anyone else changes a job's schedule or steps, the admin has to approve it again. If the approver stops being an admin, the job stops running.
- **Scripts get a minimal environment.** Their environment holds PATH, HOME, TEMP and locale variables, never the server's keys or tokens. Output is capped at 20 KB, and a timeout kills the whole process tree.
- **HTTP is limited to `http` and `https`.** Redirects are reported, not followed. Local and private addresses (loopback, LAN, link-local, cloud metadata) need an admin's approval. Responses are capped.
- **Earlier output is treated as data.** Output from a previous step is fenced and labelled as data, not instructions, before it reaches the agent, because web content may contain prompt injections.
- **Prompts run as the job's owner.** They go only to sessions the owner can still write to.
- **Limits:** at most 20 jobs per person, no overlapping runs of the same job, and automatic pausing after 3 failures in a row. The owner gets a push notification for failures and pauses.
- **Credentials:** a job stores its headers in plain text in the app's data file. Only put a token in a job if its owner explicitly provided it for that purpose. A vault that injects secrets after approval is planned but not built yet.
