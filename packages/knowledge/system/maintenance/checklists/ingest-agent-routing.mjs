import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
export function agentPolicy(root,{codex=Boolean(process.env.CODEX_THREAD_ID)}={}){
 const policy=JSON.parse(fs.readFileSync(new URL('./ingest-agent-policy.json',import.meta.url),'utf8'));
 if(policy.schema_version!==1||!policy.writer?.model||!policy.writer.reasoning_effort||!policy.post_ingest_reread?.model||!policy.post_ingest_reread.reasoning_effort)throw Error('Invalid ingest agent policy');
 const file=path.join(root,'system/maintenance/ingest-agent-bindings.local.json');let bindings=null;
 if(codex&&fs.existsSync(file)){
  const value=JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''));
  if(value.schema_version!==1||value.host!=='codex'||typeof value.enabled!=='boolean')throw Error('Invalid Codex ingest binding');
  if(value.post_ingest_reread?.enabled!==undefined){
   if(typeof value.post_ingest_reread.enabled!=='boolean')throw Error('Post-ingest reread choice must be boolean');
   policy.post_ingest_reread.enabled=value.post_ingest_reread.enabled;
  }
  if(value.enabled){
   for(const role of ['writer','post_ingest_reread'])if(!/^[a-f0-9-]{36}$/.test(value[role]?.thread_id??''))throw Error('Missing bound task session: '+role);
   if(value.writer.thread_id===value.post_ingest_reread.thread_id||[value.writer.thread_id,value.post_ingest_reread.thread_id].includes(process.env.CODEX_THREAD_ID))throw Error('Writer, reread repairer and main reviewer must be different sessions');
   bindings={host:'codex',writer:value.writer,post_ingest_reread:value.post_ingest_reread};
  }
 }
 return {writer_config:policy.writer,post_ingest_reread:policy.post_ingest_reread,task_session_bindings:bindings};
}
export function taskDispatch(binding,config,message){
 return binding?{tool:'send_message_to_thread',arguments:{threadId:binding.thread_id,model:config.model,thinking:config.reasoning_effort,prompt:message}}:null;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
 try{const args=process.argv.slice(2);if(args[0]!=='policy'||args[1]!=='--root'||!args[2])throw Error('Usage: policy --root <Knowledge>');console.log(JSON.stringify(agentPolicy(path.resolve(args[2]))));}
 catch(e){console.error(e.message);process.exitCode=2;}
}
