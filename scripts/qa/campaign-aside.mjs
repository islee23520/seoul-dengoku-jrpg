import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

export class AsideFailure extends Error {
  constructor(label, output) { super(label + ': ' + output); this.name = 'AsideFailure'; this.output = output; }
}

/** Each invocation creates a fresh native REPL session; no daemon session is reused. */
export async function asideCommand(args, timeout = 90000) {
  const child = spawn(process.env.ASIDE_AGENT ?? 'aside-agent', args, { stdio: ['ignore', 'pipe', 'pipe'] });
  const chunks = [];
  child.stdout.on('data', bytes => chunks.push(bytes));
  child.stderr.on('data', bytes => chunks.push(bytes));
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, timeout);
  try {
    const exit = await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', resolve); });
    const output = Buffer.concat(chunks).toString();
    if (timedOut || exit !== 0 || /\[error\s*\|/.test(output)) throw new AsideFailure('native Aside', (timedOut ? 'step-timeout\n' : '') + output);
    return output;
  } finally { clearTimeout(timer); }
}

export async function browserStep(input) {
  const { profile, code, label, report, evidence } = input;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const output = await asideCommand(['repl', '--host', 'local', '--profile', profile, code]);
      for (const match of output.matchAll(/^CAPTURE ([\w-]+) ([A-Za-z0-9+/=]+)$/gm)) {
        const file = path.join(evidence, 'captures', match[1] + '.png');
        await mkdir(path.dirname(file), { recursive: true });
        await writeFile(file, Buffer.from(match[2], 'base64'));
      }
      const marker = output.match(/^CAMPAIGN_RESULT (.+)$/m);
      if (!marker) throw new AsideFailure(label, output);
      const result = JSON.parse(marker[1]);
      report.steps.push({ label, attempt, ...result, transcript: output.replace(/^CAPTURE .+$/gm, '[capture retained]').replace(/^CAMPAIGN_RESULT .+$/gm, '[structured result retained]') });
      if (!result.ok) throw new AsideFailure(label, result.error);
      return result;
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      const exact = error instanceof AsideFailure ? error.output : error.stack ?? error.message;
      report.incidents.push({ label, attempt, error: exact });
      // Assertion failures never retry. CDP/transport failure gets exactly one fresh session.
      if (attempt === 2 || !/CDP|Runtime\.callFunctionOn|step-timeout|connection|Session closed|Target closed|not tracked in this session/i.test(exact)) throw error;
    }
  }
  throw new TypeError('Unreachable retry state');
}
