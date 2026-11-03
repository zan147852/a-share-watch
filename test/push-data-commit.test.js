const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const script = path.join(__dirname, '../scripts/push-data-commit.sh');
const workflow = path.join(__dirname, '../.github/workflows/screen.yml');
const realGit = execFileSync('which', ['git'], { encoding: 'utf8' }).trim();

const http408 = [
  'error: RPC failed; HTTP 408 curl 22 The requested URL returned error: 408',
  'send-pack: unexpected disconnect while reading sideband packet',
  'fatal: the remote end hung up unexpectedly',
  'Everything up-to-date'
].join('\n');

function classify(log) {
  const result = spawnSync('bash', ['-c', 'source "$1"; classify_push_failure "$2"', 'bash', script, log], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

function writeFakeGit(dir) {
  const fake = `#!/usr/bin/env bash
set -euo pipefail
real=${JSON.stringify(realGit)}
dir=${JSON.stringify(dir)}
count_file="$dir/push-count"
args_file="$dir/push-args"
if [ ! -f "$count_file" ]; then echo 0 > "$count_file"; fi
cmd=""
prev=""
for a in "$@"; do
  if [ "$prev" = "-c" ] || [ "$prev" = "-C" ]; then
    prev=""
    continue
  fi
  case "$a" in
    -c|-C) prev="$a"; continue ;;
    --) continue ;;
    -*) continue ;;
  esac
  cmd="$a"
  break
done
if [ "$cmd" = "push" ]; then
  n=$(cat "$count_file")
  n=$((n + 1))
  echo "$n" > "$count_file"
  printf '%s\\n' "$*" >> "$args_file"
  fail_times="\${FAKE_GIT_FAIL_TIMES:-0}"
  if [ "$n" -le "$fail_times" ]; then
    mode="\${FAKE_GIT_ON_FAIL:-}"
    if [ -n "$mode" ]; then
      scratch="$dir/scratch-$n"
      rm -rf "$scratch"
      "$real" clone --branch main "\$FAKE_GIT_REMOTE" "$scratch"
      if [ "$mode" = "conflict" ]; then
        echo remote-race > "$scratch/note.txt"
      else
        echo side > "$scratch/other.txt"
      fi
      "$real" -C "$scratch" add -A
      "$real" -C "$scratch" -c user.name=fake -c user.email=fake@example.invalid -c commit.gpgsign=false commit -m "remote moved"
      "$real" -C "$scratch" push origin HEAD:main
    fi
    printf '%s' "\${FAKE_GIT_FAIL_MESSAGE:-push failed}" >&2
    exit 1
  fi
fi
exec "$real" "$@"
`;
  fs.writeFileSync(path.join(dir, 'git'), fake, { mode: 0o755 });
}

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'a-share-push-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const repo = path.join(root, 'repo');
  const remote = path.join(root, 'remote.git');
  const fakeDir = path.join(root, 'fake-bin');
  fs.mkdirSync(fakeDir);
  writeFakeGit(fakeDir);
  const git = (...args) => execFileSync(realGit, args, { cwd: repo, encoding: 'utf8' }).trim();
  execFileSync(realGit, ['-c', 'init.defaultBranch=main', 'init', '--bare', '-b', 'main', remote]);
  execFileSync(realGit, ['-c', 'init.defaultBranch=main', 'init', '-b', 'main', repo]);
  git('config', 'user.name', 'screen-bot');
  git('config', 'user.email', 'screen-bot@example.invalid');
  git('config', 'commit.gpgsign', 'false');
  fs.writeFileSync(path.join(repo, 'note.txt'), 'base\n');
  git('add', 'note.txt');
  git('commit', '-m', 'initial');
  git('remote', 'add', 'origin', remote);
  git('push', '-u', 'origin', 'main');
  fs.writeFileSync(path.join(repo, 'note.txt'), 'local-data\n');
  git('add', 'note.txt');
  git('commit', '-m', 'Update daily screen results');
  return { root, repo, remote, fakeDir, git };
}

function runPush(fx, env = {}) {
  return spawnSync('bash', [script], {
    cwd: fx.repo,
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${fx.fakeDir}:${process.env.PATH}`,
      PUSH_RETRY_DELAY_SECONDS: '0',
      PUSH_MAX_ATTEMPTS: '5',
      FAKE_GIT_DIR: fx.fakeDir,
      FAKE_GIT_REMOTE: fx.remote,
      FAKE_GIT_FAIL_TIMES: '0',
      FAKE_GIT_FAIL_MESSAGE: '',
      FAKE_GIT_ON_FAIL: '',
      ...env
    }
  });
}

function pushCount(fx) {
  const file = path.join(fx.fakeDir, 'push-count');
  return fs.existsSync(file) ? Number(fs.readFileSync(file, 'utf8')) : 0;
}

function pushArgs(fx) {
  const file = path.join(fx.fakeDir, 'push-args');
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
}

function show(remote, spec) {
  return execFileSync(realGit, ['--git-dir', remote, 'show', spec], { encoding: 'utf8' });
}

test('408 断线归为暂时失败，401 和分支保护不重试', () => {
  assert.equal(classify(http408), 'transient');
  assert.equal(classify('error: RPC failed; HTTP 502 curl 22 The requested URL returned error: 502'), 'transient');
  assert.equal(classify('fatal: the remote end hung up unexpectedly'), 'transient');
  assert.equal(classify([
    'error: RPC failed; HTTP 401 curl 22 The requested URL returned error: 401',
    "fatal: Authentication failed for 'https://github.com/example/repo.git/'"
  ].join('\n')), 'auth');
  assert.equal(classify([
    'remote: Permission to example/repo.git denied to github-actions[bot].',
    "fatal: unable to access 'https://github.com/example/repo.git/': The requested URL returned error: 403"
  ].join('\n')), 'auth');
  assert.equal(classify("fatal: could not read Username for 'https://github.com': terminal prompts disabled"), 'auth');
  assert.equal(classify([
    ' ! [rejected]        main -> main (fetch first)',
    "error: failed to push some refs to 'https://github.com/example/repo.git'",
    'hint: Updates were rejected because the remote contains work that you do not'
  ].join('\n')), 'rejected');
  assert.equal(classify([
    'remote: error: GH006: Protected branch update failed for refs/heads/main.',
    ' ! [remote rejected] main -> main (protected branch hook declined)',
    "error: failed to push some refs to 'https://github.com/example/repo.git'"
  ].join('\n')), 'fatal');
  assert.equal(classify('fatal: pack-objects died of signal 9'), 'fatal');
  assert.equal(classify(''), 'fatal');
});

test('正常推送使用 HTTP/1.1 和大 postBuffer，并写入 main', t => {
  const fx = fixture(t);
  const result = runPush(fx);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(fx.git('--git-dir', fx.remote, 'rev-parse', 'main'), fx.git('rev-parse', 'HEAD'));
  assert.equal(show(fx.remote, 'main:note.txt'), 'local-data\n');
  assert.match(pushArgs(fx), /http\.version=HTTP\/1\.1/);
  assert.match(pushArgs(fx), /http\.postBuffer=67108864/);
  assert.equal(pushCount(fx), 1);
});

test('HTTP 408 退避重试后推送成功', t => {
  const fx = fixture(t);
  const result = runPush(fx, { FAKE_GIT_FAIL_TIMES: '2', FAKE_GIT_FAIL_MESSAGE: http408 });
  const output = result.stdout + result.stderr;
  assert.equal(result.status, 0, output);
  assert.equal(pushCount(fx), 3);
  assert.match(output, /transient git push failure \(attempt 1\/5\)/);
  assert.match(output, /transient git push failure \(attempt 2\/5\)/);
  assert.equal(show(fx.remote, 'main:note.txt'), 'local-data\n');
  assert.equal(fx.git('--git-dir', fx.remote, 'rev-parse', 'main'), fx.git('rev-parse', 'HEAD'));
});

test('408 连续失败达到上限后工作流失败且远端不变', t => {
  const fx = fixture(t);
  const before = fx.git('--git-dir', fx.remote, 'rev-parse', 'main');
  const result = runPush(fx, {
    PUSH_MAX_ATTEMPTS: '3',
    FAKE_GIT_FAIL_TIMES: '9',
    FAKE_GIT_FAIL_MESSAGE: http408
  });
  const output = result.stdout + result.stderr;
  assert.notEqual(result.status, 0);
  assert.equal(pushCount(fx), 3);
  assert.match(output, /failed after 3 attempts \(transient\)/);
  assert.equal(fx.git('--git-dir', fx.remote, 'rev-parse', 'main'), before);
  assert.equal(show(fx.remote, 'main:note.txt'), 'base\n');
});

test('认证失败只推一次', t => {
  const fx = fixture(t);
  const before = fx.git('--git-dir', fx.remote, 'rev-parse', 'main');
  const result = runPush(fx, {
    FAKE_GIT_FAIL_TIMES: '9',
    FAKE_GIT_FAIL_MESSAGE: 'fatal: Authentication failed for \'https://github.com/example/repo.git/\''
  });
  const output = result.stdout + result.stderr;
  assert.notEqual(result.status, 0);
  assert.equal(pushCount(fx), 1);
  assert.match(output, /git push failed \(auth\); not retrying/);
  assert.equal(fx.git('--git-dir', fx.remote, 'rev-parse', 'main'), before);
});

test('未知推送错误不重试', t => {
  const fx = fixture(t);
  const result = runPush(fx, {
    FAKE_GIT_FAIL_TIMES: '9',
    FAKE_GIT_FAIL_MESSAGE: 'fatal: pack-objects died of signal 9'
  });
  assert.notEqual(result.status, 0);
  assert.equal(pushCount(fx), 1);
  assert.match(result.stdout + result.stderr, /git push failed \(fatal\); not retrying/);
});

test('远端先前进时重新变基后再推送', t => {
  const fx = fixture(t);
  const result = runPush(fx, {
    FAKE_GIT_FAIL_TIMES: '1',
    FAKE_GIT_ON_FAIL: 'advance',
    FAKE_GIT_FAIL_MESSAGE: [
      ' ! [rejected]        main -> main (fetch first)',
      "error: failed to push some refs to 'https://github.com/example/repo.git'",
      'hint: Updates were rejected because the remote contains work that you do not'
    ].join('\n')
  });
  const output = result.stdout + result.stderr;
  assert.equal(result.status, 0, output);
  assert.equal(pushCount(fx), 2);
  assert.match(output, /rebasing before retry/);
  assert.equal(show(fx.remote, 'main:note.txt'), 'local-data\n');
  assert.equal(show(fx.remote, 'main:other.txt'), 'side\n');
});

test('变基冲突立即失败且不覆盖远端', t => {
  const fx = fixture(t);
  const before = fx.git('--git-dir', fx.remote, 'rev-parse', 'main');
  fx.git('reset', '--hard', 'HEAD~1');
  const remoteEdit = path.join(fx.root, 'remote-edit');
  execFileSync(realGit, ['-c', 'init.defaultBranch=main', 'clone', '--branch', 'main', fx.remote, remoteEdit], { stdio: 'pipe' });
  fs.writeFileSync(path.join(remoteEdit, 'note.txt'), 'remote-race\n');
  execFileSync(realGit, ['-C', remoteEdit, '-c', 'user.name=fake', '-c', 'user.email=fake@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-am', 'remote edit'], { encoding: 'utf8' });
  execFileSync(realGit, ['-C', remoteEdit, 'push', 'origin', 'HEAD:main'], { encoding: 'utf8' });
  const moved = fx.git('--git-dir', fx.remote, 'rev-parse', 'main');
  fs.writeFileSync(path.join(fx.repo, 'note.txt'), 'local-data\n');
  fx.git('add', 'note.txt');
  fx.git('commit', '-m', 'Update daily screen results');
  const result = runPush(fx);
  const output = result.stdout + result.stderr;
  assert.notEqual(result.status, 0);
  assert.match(output, /rebase onto origin\/main failed; not pushing over a conflict/);
  assert.match(output, /CONFLICT/);
  assert.equal(pushCount(fx), 0);
  assert.equal(fx.git('--git-dir', fx.remote, 'rev-parse', 'main'), moved);
  assert.notEqual(moved, before);
  assert.equal(show(fx.remote, 'main:note.txt'), 'remote-race\n');
});

test('推送被拒绝后若变基冲突则停止', t => {
  const fx = fixture(t);
  const result = runPush(fx, {
    FAKE_GIT_FAIL_TIMES: '1',
    FAKE_GIT_ON_FAIL: 'conflict',
    FAKE_GIT_FAIL_MESSAGE: ' ! [rejected]        main -> main (non-fast-forward)\nerror: failed to push some refs'
  });
  const output = result.stdout + result.stderr;
  assert.notEqual(result.status, 0);
  assert.equal(pushCount(fx), 1);
  assert.match(output, /rebase onto origin\/main failed; not pushing over a conflict/);
  assert.equal(show(fx.remote, 'main:note.txt'), 'remote-race\n');
});

test('保存步骤失败仍会使工作流失败', () => {
  const yml = fs.readFileSync(workflow, 'utf8');
  const save = yml.split('- name: 保存结果和状态')[1].split('\n      - ')[0];
  assert.match(save, /bash scripts\/push-data-commit\.sh/);
  assert.doesNotMatch(save, /continue-on-error/);
  assert.match(yml, /permissions:[\s\S]*contents: write/);
  assert.match(yml, /actions\/deploy-pages@v4/);
});
