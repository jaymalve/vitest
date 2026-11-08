// Runs the repo's own build and `ci-sdk run build` on the same runner, alternating which goes first,
// then compares every output file. Prints one `BENCH_RESULT {json}` line.
// usage: node .ci-sdk/bench.mjs "<baseline command>" <ci-sdk --filter glob>
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, rmSync, statSync } from 'node:fs';

const [baseCmd, filter] = process.argv.slice(2);
const git = (...a) => execFileSync('git', a, { encoding: 'utf8', maxBuffer: 1 << 28 });
const untracked = () => git('ls-files', '-o', '-z', '--', '.', ':(exclude,glob)**/node_modules/**').split('\0').filter(Boolean);
const pre = new Set(untracked());
const outputs = () => {
  const r = {};
  for (const f of untracked()) if (!pre.has(f) && statSync(f, { throwIfNoEntry: false })?.isFile()) r[f] = createHash('sha256').update(readFileSync(f)).digest('hex');
  return r;
};
const reset = () => {
  for (const f of untracked()) if (!pre.has(f)) rmSync(f, { force: true });
};
const cli = `${process.env.RUNNER_TEMP}/ci-sdk/node_modules/ci-sdk/dist/cli.js`;
const runs = {
  base: ['bash', ['-c', baseCmd]],
  ci: ['node', [cli, 'run', 'build', '--filter', filter]],
};
const order = Number(process.env.GITHUB_RUN_NUMBER) % 2 ? ['ci', 'base'] : ['base', 'ci'];
const res = { order: order.join(',') };
const outs = {};
for (const name of order) {
  console.log(`::group::${name}`);
  const t = performance.now();
  const p = spawnSync(runs[name][0], runs[name][1], { stdio: ['ignore', 'inherit', 'pipe'], maxBuffer: 1 << 28, encoding: 'utf8' });
  res[`${name}_s`] = +((performance.now() - t) / 1000).toFixed(2);
  res[`${name}_rc`] = p.status;
  process.stderr.write(p.stderr);
  if (name === 'ci') res.ci_summary = p.stderr.split('\n').filter((l) => l.startsWith('ci-sdk: build:')).pop();
  outs[name] = outputs();
  reset();
  console.log('::endgroup::');
}
const [b, c] = [outs.base, outs.ci];
res.outputs = Object.keys(b).length;
res.missing = Object.keys(b).filter((f) => !(f in c));
res.extra = Object.keys(c).filter((f) => !(f in b));
// wireit manifests record timestamps, so they differ between any two builds.
res.differ = Object.keys(b).filter((f) => f in c && b[f] !== c[f] && !f.includes('/.wireit/'));
res.cpu = readFileSync('/proc/cpuinfo', 'utf8').match(/model name\s*:\s*(.*)/)?.[1];
res.nproc = execFileSync('nproc', { encoding: 'utf8' }).trim();
console.log(`BENCH_RESULT ${JSON.stringify(res)}`);
// Never fail the job: a failed job skips the cache save, which would leave the next commit cold.
