# Remote machines

Machines this Beezy server reaches over SSH, listed under **Remote machines** in the drawer. People refer to one as `#name` in a message; the agent then learns how to connect.

## Where machines come from

- **Discovered:** every concrete `Host` alias in the server's `~/.ssh/config` (and simple `Include` files) is added automatically, named after the alias. ssh resolves the rest (`ssh -G` fills in host, user, port and key for display).
- **Added by hand (admins):** host (`user@host:port` is split for you), user, port and key. The key list shows the private keys found in `~/.ssh`, or a custom path. The name defaults to the host's first label.
- Admins can rename any machine and remove it. A removed discovered machine stays hidden, so discovery does not bring it back.
- Machines are stored per tenant in `db.json` (`remoteMachines`).

## Online status

Each machine is checked with a non-interactive login (`ssh -o BatchMode=yes -o ConnectTimeout=6 -o StrictHostKeyChecking=accept-new … true`): **online** (green), **reachable but login refused** (amber: key not accepted or host key mismatch), **offline** (red). Results are cached for a minute; opening the dialog checks again.

## #name in messages

- Composers suggest machines after `#` (home, group chats and sessions) with their status dot.
- When a prompt mentions `#name` of a known machine, the server appends a `<remote-machines>` note after it with the ssh command (and the `process_watch` host). The web hides the note like injected project memory and keeps it when the prompt is edited.
- Code: `server/src/remote-machines.ts`, `web/src/components/remote-machines-dialog.tsx`, `web/src/components/machine-dropup.tsx`.

## Limits

- SSH only; no passwords (keys or the ssh agent of the server user).
- Agents use the server user's ssh setup, so any agent in the tenant can reach the listed machines; listing a machine only makes it easy to name.
