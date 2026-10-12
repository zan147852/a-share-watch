const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

function fixture(t, passing) {
  const prefix = path.join(os.tmpdir(), 'a-share-release-test-');
  const root = fs.mkdtempSync(prefix);
  t.after(() => {
    assert.ok(path.resolve(root).startsWith(path.resolve(prefix)));
    fs.rmSync(root, { recursive: true, force: true });
  });
  const repo = path.join(root, 'repo');
  const remote = path.join(root, 'remote.git');
  fs.mkdirSync(path.join(repo, 'scripts'), { recursive: true });
  fs.mkdirSync(path.join(repo, 'test'), { recursive: true });
  const git = (...args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git('init', '--bare', remote);
  git('init', '-b', 'main');
  git('config', 'user.name', 'release-test');
  git('config', 'user.email', 'release-test@example.invalid');
  git('config', 'core.autocrlf', 'false');
  fs.copyFileSync(path.join(__dirname, '../scripts/release.ps1'), path.join(repo, 'scripts/release.ps1'));
  fs.copyFileSync(path.join(__dirname, '../build-bundle.js'), path.join(repo, 'build-bundle.js'));
  fs.writeFileSync(path.join(repo, 'package.json'), '{"name":"release-test","version":"0.4.1"}\n');
  fs.writeFileSync(path.join(repo, 'CHANGELOG.md'), '# 更新记录\n\n## 0.4.1\n\n- old\n');
  fs.writeFileSync(path.join(repo, 'test/sample.test.js'), `require('node:test')('fixture',()=>{${passing ? '' : "throw new Error('intentional failure');"}});\n`);
  git('add', '.');
  git('commit', '-m', 'initial');
  git('remote', 'add', 'origin', remote);
  git('push', '-u', 'origin', 'main');
  const initial = git('rev-parse', 'HEAD');
  fs.writeFileSync(path.join(repo, 'change.md'), 'Reviewable update\n');
  return { repo, remote, git, initial };
}

function release(repo) {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  return spawnSync(process.platform === 'win32' ? 'pwsh.exe' : 'pwsh', [
    '-NoProfile', '-File', path.join(repo, 'scripts/release.ps1'), '-Bump', 'patch', '-Message', 'test update'
  ], { cwd: repo, env, encoding: 'utf8', timeout: 60000 });
}

test('发布在测试失败时不提交、不创建标签、不上传', t => {
  const f = fixture(t, false);
  const result = release(f.repo);
  assert.ifError(result.error);
  assert.notEqual(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout + result.stderr, /intentional failure/);
  assert.equal(f.git('rev-parse', 'HEAD'), f.initial);
  assert.equal(f.git('tag', '--list'), '');
  assert.equal(f.git('--git-dir', f.remote, 'rev-parse', 'main'), f.initial);
});

test('发布成功时主分支和版本标签指向同一提交并上传', t => {
  const f = fixture(t, true);
  const result = release(f.repo);
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(JSON.parse(fs.readFileSync(path.join(f.repo, 'package.json'), 'utf8')).version, '0.4.2');
  const commit = f.git('rev-parse', 'HEAD');
  assert.notEqual(commit, f.initial);
  assert.equal(f.git('--git-dir', f.remote, 'rev-parse', 'main'), commit);
  assert.equal(f.git('--git-dir', f.remote, 'rev-parse', 'v0.4.2^{}'), commit);
  assert.equal(f.git('status', '--porcelain'), '');
});
