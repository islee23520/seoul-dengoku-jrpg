import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir,mkdtemp,mkdir,open,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {assertServedFileSizes} from '../build-web-game.mjs';
import {createMapPreview} from '../../../hosting/preview.mjs';
const root=new URL('../../../',import.meta.url);
test('preview is isolated, retains map semantics and never grants production identity',async()=>{
 const source=JSON.parse(await readFile(new URL('game/project.json',root),'utf8')); const before=JSON.stringify(source); const preview=createMapPreview(source);
 assert.equal(JSON.stringify(source),before); assert.deepEqual(preview.maps,source.maps); assert.deepEqual(preview.startPos,source.startPos); assert.equal(preview.startMapId,source.startMapId);
 assert.equal(preview.database.actors[0].id,'public-map-navigation-marker'); assert.equal(preview.database.actors[0].characterResourceId,'easyrpg-charset-object2'); assert.equal(preview.database.actors[0].characterIndex,5); assert.deepEqual(preview.villageInfoDocuments,[]);
 assert.throws(()=>createMapPreview({...source,database:{...source.database,actors:[{}]}}));
});
test('public output contains actual player and no private publication records',async()=>{
 const out=process.env.WEB_GAME_OUTPUT?new URL('file://'+path.resolve(process.env.WEB_GAME_OUTPUT)+'/'):new URL('web-pages-dist/',root); const names=await readdir(out); assert(names.includes('player.js')); assert(names.includes('map-preview.json')); assert(!names.includes('project.json'));
 await assertServedFileSizes(fileURLToPath(out));
 async function walk(dir){for(const item of await readdir(dir,{withFileTypes:true})){const url=new URL(item.name+(item.isDirectory()?'/':''),dir); assert(!/ledger|receipt|sqlite|canon|proof/i.test(item.name),item.name);if(item.isDirectory())await walk(url);else if(/\.(json|html|css|js|md|txt)$/.test(item.name)){const text=await readFile(url,'utf8');assert(!text.includes('/Users/ilseoblee'),item.name);}}} await walk(out);
 const html=await readFile(new URL('preview.html',out),'utf8');assert(html.includes('projectUrl:"./map-preview.json"')); assert(!html.includes('qaInstrumentation'));
});
for(const bytes of [20*1024*1024-1,20*1024*1024,20*1024*1024+1]) {
 test('served file size gate at '+bytes+' bytes',async()=>{
  // Given a nested served asset, including non-JavaScript files.
  const dir=await mkdtemp(path.join(tmpdir(),'web-size-test-'));
  try {
   await mkdir(path.join(dir,'assets'));
   const file=await open(path.join(dir,'assets/data.bin'),'w');
   try {await file.truncate(bytes);} finally {await file.close();}
   // When the builder checks the complete served tree, then the limit applies.
   if(bytes<=20*1024*1024) await assert.doesNotReject(assertServedFileSizes(dir));
   else await assert.rejects(assertServedFileSizes(dir));
  } finally {await rm(dir,{recursive:true,force:true});}
 });
}
