// Full-job benchmark: the repo's own CI steps vs the same steps through ci-sdk, on one runner, alternating which goes first.
// usage: node .ci-sdk/bench2.mjs .ci-sdk/steps.json   — steps.json: { "base": [[name, cmd], …], "ci": [[name, cmd], …] }
// Prints one `BENCH2_RESULT {json}` line with per-step seconds and exit codes.
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, renameSync, rmSync, statSync } from 'node:fs';

const steps = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const CLI = `node ${process.env.RUNNER_TEMP}/ci-sdk/node_modules/ci-sdk/dist/cli.js`;
const git = (...a) => execFileSync('git', a, { encoding: 'utf8', maxBuffer: 1 << 28 });
const untracked = () => git('ls-files', '-o', '-z', '--', '.', ':(exclude,glob)**/node_modules/**').split('\0').filter(Boolean);
// Restored by the ci-sdk Action for the ci variant only; the repos' own CI starts without it.
const HELD = ['.eslintcache'];
const pre = new Set(untracked().filter((f) => !HELD.includes(f)));
const reset = () => {
  for (const f of untracked()) if (!pre.has(f) && !HELD.includes(f) && statSync(f, { throwIfNoEntry: false })?.isFile()) rmSync(f, { force: true });
};
const hold = (on) => {
  for (const f of HELD) {
    if (on && existsSync(f)) renameSync(f, `${f}.held`);
    if (!on && existsSync(`${f}.held`)) {
      rmSync(f, { force: true });
      renameSync(`${f}.held`, f);
    } else if (!on) rmSync(f, { force: true });
  }
};

const order = Number(process.env.GITHUB_RUN_NUMBER) % 2 ? ['ci', 'base'] : ['base', 'ci'];
const res = { order: order.join(','), base: {}, ci: {} };
for (const variant of order) {
  if (variant === 'base') hold(true);
  for (const [name, cmd] of steps[variant]) {
    console.log(`::group::${variant}: ${name}`);
    const t = performance.now();
    const p = spawnSync('bash', ['-c', cmd.replaceAll('CI_SDK', CLI)], { stdio: ['ignore', 'inherit', 'pipe'], encoding: 'utf8', maxBuffer: 1 << 28 });
    process.stderr.write(p.stderr);
    const ci = p.stderr.split('\n').filter((l) => /^ci-sdk: (\w+: \d+ packages|\d+ changed files|All affected|Some affected)/.test(l));
    res[variant][name] = { s: +((performance.now() - t) / 1000).toFixed(2), rc: p.status, ...(ci.length && { ci: ci.join(' | ') }) };
    console.log('::endgroup::');
  }
  if (variant === 'base') hold(false);
  reset();
}
const total = (v) => +Object.values(res[v]).reduce((a, s) => a + s.s, 0).toFixed(2);
res.base_s = total('base');
res.ci_s = total('ci');
res.same_outcome = Object.keys(res.base).every((k, i) => (res.base[k].rc === 0) === (Object.values(res.ci)[i]?.rc === 0));
res.cpu = readFileSync('/proc/cpuinfo', 'utf8').match(/model name\s*:\s*(.*)/)?.[1];
console.log(`BENCH2_RESULT ${JSON.stringify(res)}`);
// Never fail the job: a failed job skips the cache save, which would leave the next commit cold.
