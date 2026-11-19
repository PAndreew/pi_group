import { mkdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve, join } from 'node:path';
import { SecretStore, loadMasterKey } from '../vault/src/store.mjs';
import { createGateway } from './server.mjs';

process.umask(0o077);
const dir = resolve(process.env.GATEWAY_DATA_DIR ?? join(homedir(), '.beezy-gateway'));
const token = process.env.GATEWAY_ADMIN_TOKEN ?? readFileSync(join(dir, 'admin.token'), 'utf8').trim();
const port = Number(process.env.GATEWAY_PORT ?? 8791);
mkdirSync(dir, { recursive: true, mode: 0o700 });
const store = new SecretStore(join(dir, 'credentials.sqlite'), loadMasterKey(dir, process.env.GATEWAY_MASTER_KEY));
const server = createGateway({ store, adminToken: token });
server.listen(port, '127.0.0.1', () => console.log(`Beezy model gateway listening on http://127.0.0.1:${port}`));
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => server.close(() => store.close()));
