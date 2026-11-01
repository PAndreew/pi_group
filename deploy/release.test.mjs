import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
const controller = new URL('./release.sh', import.meta.url).pathname;

for (const scenario of ['success', 'build failure', 'activation failure', 'legacy refusal']) {
  test(`release controller: ${scenario}`, () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'beezy-release-test-'));
    const root = path.join(dir, 'source'), bin = path.join(dir, 'bin');
    mkdirSync(path.join(root, 'server', 'dist'), { recursive: true }); mkdirSync(bin);
    const run = (cmd, args) => {
      const r = spawnSync(cmd, args, { cwd: root, encoding: 'utf8' }); assert.equal(r.status, 0, r.stderr); return r.stdout.trim();
    };
    const script = (name, body) => writeFileSync(path.join(bin, name), '#!/bin/bash\nset -eu\n' + body, { mode: 0o700 });
    // Build and service operations are fakes; the controller, locks, files and JSON parsing are real.
    writeFileSync(path.join(root, 'server/dist/index.js'), 'setInterval(()=>{}, 1000);');
    writeFileSync(path.join(root, 'server/dist/config.js'), `export const config = ${JSON.stringify({ dataDir: path.join(dir, 'data'), fsRoot: dir, chatFolder: path.join(dir, 'chat'), piSessionsDir: path.join(dir, 'sessions'), piAgentDir: path.join(dir, 'agent') })};`);
    run('git', ['init', '-q']); run('git', ['add', '.']);
    run('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.org', 'commit', '-qm', 'fixture']);
    const ref = run('git', ['rev-parse', 'HEAD']);
    script('npm', 'echo npm >> "$TEST_DIR/actions"\n[[ "$SCENARIO" != "build failure" ]]');
    script('systemctl', `echo "$*" >> "$TEST_DIR/actions"
case "$*" in
  *--property=WorkingDirectory*) echo "$TEST_ROOT/server" ;;
  *"start pi-group.service"*)
    if [[ "$SCENARIO" == 'activation failure' && ! -e "$TEST_DIR/failed" ]]; then touch "$TEST_DIR/failed"; exit 1; fi
    touch "$TEST_DIR/started" ;;
esac
`);
    script('curl', `if [[ "$*" == *18788* ]]; then
  printf '{"ready":true,"release":"%s"}' "$TEST_REF"
elif [[ "$SCENARIO" == 'legacy refusal' ]]; then
  echo '<html>legacy</html>'
else
  release=old; [[ ! -e "$TEST_DIR/started" ]] || release="$TEST_REF"
  drain=false; [[ ! -e "$XDG_STATE_HOME/beezy/draining" ]] || drain=true
  printf '{"ready":true,"busy":0,"draining":%s,"release":"%s"}' "$drain" "$release"
fi
`);
    try {
      const r = spawnSync('bash', [controller, root, ref], { timeout: 20000, encoding: 'utf8', env: {
        ...process.env, HOME: dir, XDG_STATE_HOME: path.join(dir, 'state'), PATH: `${bin}:${process.env.PATH}`,
        TEST_ROOT: root, TEST_DIR: dir, TEST_REF: ref, SCENARIO: scenario,
      } });
      assert.equal(r.error, undefined, r.error?.message);
      const actions = readFileSync(path.join(dir, 'actions'), 'utf8');
      const dropin = path.join(dir, '.config/systemd/user/pi-group.service.d/90-beezy-release.conf');
      if (scenario === 'success') {
        assert.equal(r.status, 0, r.stderr); assert.ok(existsSync(dropin));
        assert.ok(existsSync(path.join(dir, 'state/beezy/current')));
      } else {
        assert.notEqual(r.status, 0); assert.equal(existsSync(dropin), false);
        if (scenario === 'activation failure') assert.match(actions, /restart pi-group.service/);
        else assert.doesNotMatch(actions, /(?:stop|start|restart) pi-group.service/);
      }
      assert.equal(existsSync(path.join(dir, 'state/beezy/draining')), false);
      assert.doesNotMatch(actions, /pi-web|beezy-vault/);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
}
