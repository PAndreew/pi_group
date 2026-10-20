// Run after stopping the server: node scripts/setup-family.mjs andris nyuszi
import { randomBytes } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { loadStore, saveNow, store } from '../dist/store.js';
import { createUser } from '../dist/auth.js';
import { config } from '../dist/config.js';
import { inTenant } from '../dist/tenant-context.js';
import { closeChats, ensureChatFolder, staleChats } from '../dist/chats.js';

const [ownerName, partnerName] = process.argv.slice(2);
if (!ownerName || !partnerName) throw new Error('Usage: node scripts/setup-family.mjs <owner> <partner>');
loadStore();
const owner = store.userByName(ownerName);
if (!owner || owner.role !== 'admin') throw new Error('The owner must be an existing admin');
let family = store.data.tenants.find(t => t.id === 'family');
if (!family) {
  const root = path.join(config.dataDir, 'tenants', 'family', 'workspace');
  family = { id: 'family', name: 'Family', root, chatFolder: path.join(root, 'chat'), memberIds: [owner.id] };
  store.data.tenants.push(family);
}
if (!family.memberIds.includes(owner.id)) family.memberIds.push(owner.id);
mkdirSync(family.root, { recursive: true, mode: 0o700 });
inTenant(family, () => {
  let partner = store.userByName(partnerName);
  if (!partner) {
    // No shared/default password: an admin sets the initial password in Manage users.
    partner = createUser(partnerName, randomBytes(32).toString('base64url'), 'member');
  }
  if (!family.memberIds.includes(partner.id)) family.memberIds.push(partner.id);
  const work = store.data.tenants.find(t => t.id === 'work');
  if (work) work.memberIds = work.memberIds.filter(id => id !== partner.id);
  ensureChatFolder();
});
// This applies the idempotent SQLite migration; existing chats default to Work.
staleChats('9999-12-31');
closeChats();
saveNow();
console.log('Tenants configured:', store.data.tenants.map(t => ({ id: t.id, name: t.name, members: t.memberIds.map(id => store.userById(id)?.username) })));
console.log(`${partnerName}: set an initial password in Manage users. No reusable default password was created.`);
