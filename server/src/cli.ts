/**
 * User management from the shell (the web app has an admin page too):
 *   npm run user -- list
 *   npm run user -- add <username> <password> [--admin]
 *   npm run user -- passwd <username> <password>
 *   npm run user -- remove <username>
 * Stop the server first or restart it afterwards; it keeps its own copy of the store in memory.
 */
import { createUser, hashPassword } from "./auth.js";
import { loadStore, saveNow, store } from "./store.js";

loadStore();
const [command, name, password] = process.argv.slice(2);

function fail(message: string): never {
	console.error(message);
	process.exit(1);
}

switch (command) {
	case "list":
		for (const u of store.data.users) console.log(`${u.username}\t${u.role}\t${u.createdAt}`);
		break;
	case "add":
		if (!name || !password) fail("usage: add <username> <password> [--admin]");
		createUser(name, password, process.argv.includes("--admin") ? "admin" : "member");
		console.log(`Added ${name}`);
		break;
	case "passwd": {
		const user = store.userByName(name ?? "") ?? fail("No such user");
		if (!password || password.length < 8) fail("Password must be at least 8 characters");
		user.passwordHash = hashPassword(password);
		store.data.logins = store.data.logins.filter((l) => l.userId !== user.id);
		console.log(`Password changed for ${user.username}`);
		break;
	}
	case "remove": {
		const user = store.userByName(name ?? "") ?? fail("No such user");
		store.data.users = store.data.users.filter((u) => u.id !== user.id);
		store.data.logins = store.data.logins.filter((l) => l.userId !== user.id);
		console.log(`Removed ${user.username}`);
		break;
	}
	default:
		fail("commands: list | add <user> <pass> [--admin] | passwd <user> <pass> | remove <user>");
}
saveNow();
