# Tenants

The home toolbar's **Tenant** selector switches between memberships. Chats, sessions, sharing, user mentions, notification streams, jobs, file APIs and memory are checked server-side against the active tenant, including for admins. Account administration remains instance-wide and admin-only.

Existing data migrates to **Work**; new tenants never inherit its sessions or memory. Tenancy is app metadata, not a modification of Pi's JSONL format. Logins remember their active tenant. Other tabs reload after a switch, session caches are namespaced, and stale requests are rejected rather than interpreting their paths in a different tenant.

## Initial Family setup

After building, stop the server and back up `DATA_DIR/db.json` and `DATA_DIR/chats.sqlite` (including any WAL files), then:

```sh
cd server
node scripts/setup-family.mjs andris nyuszi
```

The idempotent script keeps existing conversations and accounts in Work, adds the owner to Family, and creates a Family-only partner account. Set the partner's initial password in **Manage users**; there is no reusable default password. Family's workspace and chat/memory folder live under `DATA_DIR/tenants/family/workspace`, outside the existing Work file root. Do not nest one tenant's root inside another's root.

Memberships live in `db.json`'s `tenants[].memberIds`; session and job metadata have `tenantId`; chat rows have `tenant_id` (legacy default: `work`). Back up both stores together. Additional tenant definitions can be provisioned in the same metadata; there is not yet a general tenant-admin UI.

Default chat working folders and memory master sessions are per tenant. Existing Work folders and memories are preserved, not copied to Family. Scheduled jobs and deferred forwarding carry the originating tenant; user streams are pinned to the tenant in which they opened. Provider credentials and installed extensions remain shared.

## Trust boundary

**This is not an OS sandbox.** Agent tools, admin terminals and scheduled scripts still run as the server's Unix user and can access host files outside their working folder. Separate OS users/containers, credentials, and process/storage policies are needed before hosting mutually untrusted infrastructure customers. The application API boundary and default context separation do not provide that protection.

## Validation

```sh
cd server && npx tsx --test src/tenants.test.ts
# With the web dev server running:
cd web && TEST_URL=http://localhost:5173 node test/tenants.mjs
```

Integration tests cover legacy migration, membership-restricted switching, forged/stale tenant headers, direct session/chat/SSE URLs, forwarding, sharing, file traversal, directory lists, jobs, memory candidates and notification fan-out. Browser tests cover switching with an open conversation/draft and clearing the old route.
