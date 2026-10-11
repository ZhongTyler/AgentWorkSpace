import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {init,inside,write,read,hash,now,loadTrip} from '../scripts/lib/core.mjs';
import {intake,sourceAudit,captureAudit} from '../scripts/lib/intake.mjs';
import {importSource,digest,rawGallery} from '../scripts/lib/research.mjs';
import {build} from '../scripts/lib/generate.mjs';
import {validate} from '../scripts/lib/validate.mjs';
import {archiveInfo} from '../scripts/lib/archive-info.mjs';
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a94UAAAAASUVORK5CYII=','base64');
function fixture(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'travel-intake-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const project=path.join(root,'trip');init(project,'test','2027-01-01','2027-01-01');
 write(path.join(root,'body.txt'),'人工提供的正文，脚本不推断独立价值。');write(path.join(root,'01.png'),png);
 const manifest={id:'manual',title:'test',url:'https://example.com/note',textFile:'body.txt',images:[{file:'01.png',position:1}],
 capture:{method:'manual',by:'test',at:now(),scope:'complete',bodyExpanded:true,expectedImages:1}};
 const file=path.join(root,'intake.json');write(file,manifest);return {root,project,manifest,file};
}
test('manual intake binds ordered pages and preserves private archive bytes without execution',t=>{
 const {root,project,manifest,file}=fixture(t);const bytes='<html><script>throw Error("never execute")</script>ARCHIVE_PRIVATE_MARKER</html>';
 write(path.join(root,'saved.html'),bytes);manifest.archive={file:'saved.html'};write(file,manifest);intake(project,file);
 const row=read(inside(project,'research/registry.json'))[0],raw=read(inside(project,row.raw));
 assert.equal(raw.images[0].position,1);assert.ok(raw.archive.file.startsWith('private/'));
 assert.equal(fs.readFileSync(inside(project,raw.archive.file),'utf8'),bytes);
 assert.equal(sourceAudit(project).counts.complete,1);
 assert.ok(!fs.readFileSync(build(project).file,'utf8').includes('ARCHIVE_PRIVATE_MARKER'));
 assert.ok(fs.readFileSync(rawGallery(project,'manual').file,'utf8').includes('data:image/png;base64'));
});
test('missing pages, unexpanded body and unknown totals cannot claim complete capture',()=>{
 const c={method:'manual',by:'test',at:now(),scope:'complete',bodyExpanded:true,expectedImages:2};
 assert.throws(()=>captureAudit(c,[{position:1}]),/Cannot declare complete/);
 assert.throws(()=>captureAudit({...c,expectedImages:1},[{position:2}]),/exceeds/);
 assert.throws(()=>captureAudit({...c,expectedImages:1,bodyExpanded:false},[{position:1}]),/expanded body/);
 assert.throws(()=>captureAudit({...c,expectedImages:null},[]),/unknown/);
 assert.throws(()=>captureAudit(c,[{position:1},{position:1}]),/Duplicate/);
 assert.equal(captureAudit({...c,scope:'partial'},[{position:1}]).status,'partial');
});
test('failed intake never updates registry; paths cannot escape input folder',t=>{
 const {project,manifest,file}=fixture(t);manifest.capture.expectedImages=2;write(file,manifest);
 assert.throws(()=>intake(project,file),/Cannot declare complete/);assert.deepEqual(read(inside(project,'research/registry.json')),[]);
 manifest.capture.scope='unknown';manifest.textFile='../secret.txt';write(file,manifest);assert.throws(()=>intake(project,file),/escapes/);
});
test('partial capture remains partial even when all saved bytes have been read',t=>{
 const {project,manifest,file}=fixture(t);manifest.capture.scope='partial';manifest.capture.expectedImages=2;write(file,manifest);intake(project,file);
 const row=read(inside(project,'research/registry.json'))[0],raw=read(inside(project,row.raw));write(inside(project,'knowledge/note.md'),raw.url);
 const review={id:row.id,rawHash:row.rawHash,reviewer:'test',reviewedAt:now(),status:'complete',bodyRead:true,
 images:raw.images.map(i=>({hash:i.hash,read:true})),outcomes:[{topic:'test',reason:'test',file:'knowledge/note.md'}]};
 assert.throws(()=>digest(project,review),/Partial\/unknown capture/);
 digest(project,{...review,status:'partial'});assert.equal(sourceAudit(project).counts.partial,1);
});
test('archive tampering is detected by audit and project validation',t=>{
 const {root,project,manifest,file}=fixture(t);write(path.join(root,'saved.html'),'<html>original</html>');manifest.archive={file:'saved.html'};write(file,manifest);intake(project,file);
 const row=read(inside(project,'research/registry.json'))[0],raw=read(inside(project,row.raw));write(inside(project,raw.archive.file),'changed');
 assert.equal(sourceAudit(project).valid,false);assert.equal(validate(loadTrip(project),project).valid,false);
});
test('legacy raw stays immutable and coverage unknown, not retroactively attested',t=>{
 const {project}=fixture(t);importSource(project,{id:'legacy',title:'legacy',url:'https://example.com/legacy',text:'legacy',images:[]},project);
 const row=read(inside(project,'research/registry.json'))[0],before=fs.readFileSync(inside(project,row.raw));
 assert.equal(sourceAudit(project).counts.unknown,1);assert.equal(hash(fs.readFileSync(inside(project,row.raw))),hash(before));
});
test('HTML archive inspection never executes scripts or declares offline success',t=>{
 const {root}=fixture(t),file=path.join(root,'page.html');
 write(file,'<!-- url: https://example.com/travel?token=DO_NOT_REPORT -->\n<title>Test &amp; archive</title><img src="data:image/png;base64,AA"><img src="https://example.com/image"><script>throw Error("not executed")</script>');
 const info=archiveInfo(file);
 assert.equal(info.title,'Test & archive');assert.equal(info.sourceUrl,'https://example.com/travel');
 assert.equal(info.embeddedImageReferences,1);assert.equal(info.externalResourceTags,1);assert.equal(info.scriptTags,1);
 assert.equal(info.requiresBrowserOfflineTest,true);assert.ok(!JSON.stringify(info).includes('DO_NOT_REPORT'));
});
