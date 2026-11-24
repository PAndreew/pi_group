import assert from "node:assert/strict";
import { test } from "node:test";
import { parseSshConfigHosts, sshCommand, type RemoteMachine } from "./remote-machines.js";

test("ssh config: concrete Host aliases only, includes followed", () => {
	const config = "Host *\n  ServerAliveInterval 30\nHost prod prod-db\n  HostName 10.0.0.1\n# Host commented\nHost=gpu\nHost !bad web-?\nInclude extra\n";
	assert.deepEqual(parseSshConfigHosts(config, () => ["Host lab\n  User me\n"]), ["prod", "prod-db", "gpu", "lab"]);
});

test("ssh command uses the alias, or port and key for manual machines", () => {
	const base = { id: "1", name: "x", source: "manual", createdAt: "" } satisfies Partial<RemoteMachine>;
	assert.equal(sshCommand({ ...base, source: "ssh-config", alias: "prod" } as RemoteMachine), "ssh prod");
	assert.equal(sshCommand({ ...base, host: "10.0.0.2", user: "pi", port: 2222, identityFile: "~/.ssh/id_lab" } as RemoteMachine), "ssh -p 2222 -i ~/.ssh/id_lab pi@10.0.0.2");
	assert.equal(sshCommand({ ...base, host: "box", port: 22 } as RemoteMachine), "ssh box");
});
