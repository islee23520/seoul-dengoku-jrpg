import { readFile, writeFile, mkdir, cp, readdir, mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createMapPreview } from '../../hosting/preview.mjs';
export const ENGINE_REVISION='6d4907e65e315787ce49b0d20dd48b68e1277395';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const engine=path.join(root,'engine');
export const MAX_SERVED_FILE_BYTES=20*1024*1024;
export async function assertServedFileSizes(directory) {
 for(const item of await readdir(directory,{withFileTypes:true})) {
  const file=path.join(directory,item.name);
  if(item.isDirectory()) await assertServedFileSizes(file);
  else {
   const {size}=await stat(file);
   if(size>MAX_SERVED_FILE_BYTES) throw new Error('Served file must be at most '+MAX_SERVED_FILE_BYTES+' bytes: '+file+' ('+size+')');
  }
 }
}
export async function buildWebGame(output=path.join(root,'web-dist')) {
 const inventory=JSON.parse(await readFile(path.join(root,'hosting/engine-inputs.json'),'utf8'));
 const revision=inventory.revision;
 if(revision!==ENGINE_REVISION) throw new Error('Engine input inventory revision mismatch');
 for(const [name,expected] of Object.entries(inventory.files)) {
  const actual=createHash('sha256').update(await readFile(path.join(engine,name))).digest('hex');
  if(actual!==expected) throw new Error('Pinned engine input changed: '+name);
 }
 const source=await readFile(path.join(root,'game/project.json'),'utf8');
 const preview=createMapPreview(JSON.parse(source));
 const scratch=await mkdtemp(path.join(tmpdir(),'seoul-web-'));
 try {
  const runtime=path.join(scratch,'runtime');
  const timestamp=execFileSync('git',['show','-s','--format=%cI',ENGINE_REVISION],{cwd:engine,env:{...process.env,GIT_MASTER:'1'},encoding:'utf8'}).trim();
  execFileSync(process.execPath,[path.join(engine,'node_modules/vite/bin/vite.js'),'build','--config',path.join(root,'hosting/vite.player.config.mjs'),'--configLoader','runner','--outDir',runtime],{cwd:engine,env:{...process.env,GIT_MASTER:'1',HOSTING_BUILD_TIMESTAMP:timestamp},stdio:'inherit'});
  await mkdir(output,{recursive:true});
  if((await readdir(output)).length) throw new Error('Output must be empty; remove only your previous web-dist before rebuilding');
  for(const name of await readdir(runtime)) if(name!=='player.html'&&!name.endsWith('manifest.json')) await cp(path.join(runtime,name),path.join(output,name),{recursive:true});
  const html=await readFile(path.join(runtime,'player.html'),'utf8');
  await writeFile(path.join(output,'preview.html'),html.replace('<title>OPRN Player</title>','<title>지도 미리보기 — 비정식 탐색 표식</title>').replace('<script type="module"', '<script>window.__OPENRPG_BOOT__={projectUrl:"./map-preview.json",saveNamespace:"seoul-public-map-preview-v1",touchControls:"auto"};</script><script type="module"'));
  await writeFile(path.join(output,'map-preview.json'),JSON.stringify(preview));
  for(const name of ['index.html','host.css']) await cp(path.join(root,'hosting',name),path.join(output,name));
  const runtimeAssets=JSON.parse(await readFile(path.join(engine,'src/player/runtimeAssets.json'),'utf8')).paths;
  for(const asset of [...runtimeAssets,...["assets/generated/title/oprn-title-field.png","assets/easyrpg/sound/Buzzer1.wav","assets/easyrpg/sound/Cancel1.wav","assets/easyrpg/sound/Cancel2.wav","assets/easyrpg/sound/Cursor1.wav","assets/easyrpg/sound/Decision1.wav","assets/easyrpg/sound/Decision2.wav","assets/easyrpg/sound/Attack1.wav","assets/easyrpg/sound/Barrier1.wav","assets/easyrpg/sound/Blow4.wav","assets/easyrpg/sound/Chime1.wav","assets/easyrpg/sound/Collapse1.wav","assets/easyrpg/sound/Collapse2.wav","assets/easyrpg/sound/Damage2.wav","assets/easyrpg/sound/Escape.wav","assets/easyrpg/sound/Evade1.wav","assets/easyrpg/sound/Fall1.wav","assets/easyrpg/sound/Recovery5.wav","assets/easyrpg/sound/Recovery7.wav","assets/easyrpg/sound/Blow2.wav","assets/easyrpg/sound/Item1.wav","assets/easyrpg/sound/Buff.wav","assets/easyrpg/sound/Darkness3.wav","assets/easyrpg/sound/Earth2.wav","assets/easyrpg/sound/Fire1.wav","assets/easyrpg/sound/Flash1.wav","assets/easyrpg/sound/Flash3.wav","assets/easyrpg/sound/Holy2.wav","assets/easyrpg/sound/Ice1.wav","assets/easyrpg/sound/Magic2.wav","assets/easyrpg/sound/Move.wav","assets/easyrpg/sound/Shot1.wav","assets/easyrpg/sound/Teleport2.wav","assets/easyrpg/sound/Wind8.wav","assets/easyrpg/charset/Object2.png","assets/beodeul-warm-trees/tree-03a8f7.png","assets/cc0/audio/bgm/field-of-dreams.mp3","assets/generated/battle-scenery/plains/preview.png","assets/generated/battle-scenery/desert/preview.png","assets/generated/battle-scenery/snow/preview.png"]]) { await mkdir(path.dirname(path.join(output,asset)),{recursive:true}); await cp(path.join(engine,'public',asset),path.join(output,asset)); }
  for(const name of ['LICENSE-RUNTIME.md','ASSET-LICENSE.md','THIRD_PARTY_NOTICES.md']) await cp(path.join(engine,name),path.join(output,name));
  await cp(path.join(engine,'licenses'),path.join(output,'licenses'),{recursive:true});
  await writeFile(path.join(output,'loading.json'),JSON.stringify({title:preview.meta.title}));
  await writeFile(path.join(output,'preload-files.json'),JSON.stringify({files:[]}));
  await assertServedFileSizes(output);
  const inputs=createHash('sha256');
  for(const name of ['scripts/tools/build-web-game.mjs','hosting/vite.player.config.mjs','hosting/engine-inputs.json','hosting/preview.mjs','hosting/index.html','hosting/host.css']) inputs.update(name).update('\0').update(await readFile(path.join(root,name))).update('\0');
  const receipt={engineRevision:revision,projectSha256:createHash('sha256').update(source).digest('hex'),buildInputsSha256:inputs.digest('hex'),mode:'noncanonical-map-preview',productionAvailable:false};
  console.log(JSON.stringify(receipt)); return receipt;
 } finally { await rm(scratch,{recursive:true,force:true}); }
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) await buildWebGame(process.argv[2]&&path.resolve(process.argv[2]));
