import { readFile, mkdir, mkdtemp, cp, symlink, rm, readdir } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const exec = promisify(execFile);
const root = fileURLToPath(new URL('../../', import.meta.url));
export const ENGINE_REVISION = '6d4907e65e315787ce49b0d20dd48b68e1277395';
const patchedFiles = ['runtimeSimulationPort.ts', 'createPlayGame.ts', 'PlayScene.ts', 'playSceneMovement.ts'];
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
export async function verifyEngine(engine, inventory) {
  const { stdout } = await exec('git', ['rev-parse', 'HEAD'], { cwd: engine, env: { ...process.env, GIT_MASTER: '1' } });
  if (stdout.trim() !== ENGINE_REVISION || inventory.revision !== ENGINE_REVISION) throw new Error('Engine revision mismatch');
  for (const [name, expected] of Object.entries(inventory.files)) {
    if (sha(await readFile(path.join(engine, name))) !== expected) throw new Error('Engine input hash mismatch: ' + name);
  }
}
export async function prepareRealtimeSource(directory) {
  const engine = path.join(root, 'engine');
  const inventory = JSON.parse(await readFile(path.join(root, 'hosting/engine-inputs.json'), 'utf8'));
  await verifyEngine(engine, inventory);
  const patch = path.join(root, 'patches/realtime-battle-host.patch');
  const patchBytes = await readFile(patch);
  const target = path.join(directory, 'engine');
  await mkdir(target, { recursive: true });
  for (const name of ['src', 'scripts', 'vite.player.config.ts', 'package.json', 'LICENSE-RUNTIME.md']) await cp(path.join(engine, name), path.join(target, name), { recursive: true });
  await symlink(path.join(engine, 'node_modules'), path.join(target, 'node_modules'));
  const patchCopy = path.join(directory, 'realtime-battle-host.patch');
  await cp(patch, patchCopy);
  if (sha(await readFile(patchCopy)) !== sha(patchBytes)) throw new Error('Realtime patch changed during preparation');
  await exec('git', ['apply', '--check', patchCopy], { cwd: directory, env: { ...process.env, GIT_MASTER: '1' } });
  await exec('git', ['apply', patchCopy], { cwd: directory, env: { ...process.env, GIT_MASTER: '1' } });
  const patched = {};
  for (const name of patchedFiles) patched[name] = sha(await readFile(path.join(target, 'src/player', name)));
  return { engine: target, provenance: { engineRevision: ENGINE_REVISION, patchSha256: sha(patchBytes), patched, productionAdmission: false } };
}
export async function typecheckRealtimeEntry(engine) {
  const { API } = await import(pathToFileURL(path.join(root, 'engine/node_modules/typescript/dist/api/sync/api.js')).href);
  const configPath = path.join(root, 'hosting/tsconfig.realtime.virtual.json');
  const entry = path.join(root, 'hosting/realtime-entry.ts');
  const entries = [entry, ...['hosting/opening-project.ts', 'hosting/opening-flow.ts', 'hosting/ui-strings.ts', 'hosting/opening-errors.ts', 'game/ui/campaignMap.ts', 'game/ui/campaignMapModel.ts', 'hosting/sampling-assets.ts', 'game/src/assets/sampling.ts', 'game/src/runtime/openingScenario.ts'].map(file => path.join(root, file)), ...(process.env.THREE_STATION_QA === '1' ? [path.join(root, 'hosting/three-station-qa.ts'), path.join(root, 'hosting/three-station-presenter.ts')] : []), ...(process.env.NATURAL_CHARSET_QA === '1' ? [path.join(root, 'hosting/natural-charset-qa.ts')] : [])];
  const config = JSON.stringify({
    extends: path.join(root, 'engine/tsconfig.json'),
    compilerOptions: {
      noEmit: true,
      paths: {
        '@/app/mode': [path.join(engine, 'src/player/exportAppModeShim.ts')],
        '@/project/store': [path.join(engine, 'src/player/exportProjectStoreShim.ts')],
        '@/*': [path.join(engine, 'src/*')],
      },
    },
    files: [...entries, path.join(engine, 'src/vite-env.d.ts')],
    include: [],
  });
  const api = new API({ cwd: root, fs: {
    fileExists: name => name === configPath ? true : undefined,
    readFile: name => name === configPath ? config : undefined,
  } });
  try {
    const snapshot = api.updateSnapshot({ openProjects: [configPath] });
    try {
      const project = snapshot.getProject(configPath);
      if (!project || !project.program.getSourceFile(entry)) throw new Error('Realtime entry typecheck project missing');
      const diagnostics = [
        ...project.program.getConfigFileParsingDiagnostics(),
        ...project.program.getProgramDiagnostics(),
        ...project.program.getGlobalDiagnostics(),
        ...entries.flatMap(file => project.program.getSyntacticDiagnostics(file)),
        ...entries.flatMap(file => project.program.getSemanticDiagnostics(file)),
      ];
      if (diagnostics.length) throw new Error('Realtime entry diagnostics: ' + JSON.stringify(diagnostics));
      return { file: 'hosting/realtime-entry.ts', diagnostics: 0, scope: 'entry and compiler configuration; dependencies checked separately' };
    } finally { snapshot.dispose(); }
  } finally { api.close(); }
}
export async function buildRealtimeGame(output) {
  await mkdir(output, { recursive: true });
  if ((await readdir(output)).length) throw new Error('Output must be empty');
  const scratch = await mkdtemp(path.join(tmpdir(), 'seoul-realtime-'));
  try {
    const prepared = await prepareRealtimeSource(scratch);
    const entryTypecheck = await typecheckRealtimeEntry(prepared.engine);
    await exec(process.execPath, [path.join(root, 'engine/node_modules/vite/bin/vite.js'), 'build', '--config', path.join(root, 'hosting/vite.realtime.config.mjs'), '--configLoader', 'runner', '--outDir', path.resolve(output)], {
      cwd: prepared.engine, env: { ...process.env, GIT_MASTER: '1', REALTIME_ENGINE_SOURCE: prepared.engine }, maxBuffer: 16 * 1024 * 1024,
    });
    // NotoSansKR ships under SIL OFL 1.1, which requires the license beside redistributed fonts.
    await mkdir(path.join(output, 'fonts'), { recursive: true });
    await cp(path.join(root, 'hosting/fonts/LICENSE.txt'), path.join(output, 'fonts/NotoSansKR-OFL.txt'));
    return { ...prepared.provenance, entryTypecheck };
  } finally { await rm(scratch, { recursive: true, force: true }); }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) console.log(JSON.stringify(await buildRealtimeGame(path.resolve(process.argv[2] ?? 'realtime-dist'))));
