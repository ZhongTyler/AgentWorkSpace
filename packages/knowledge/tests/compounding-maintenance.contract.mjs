const recipientTools = process.env.FEEDBACK_TOOLS_ROOT;
import {pathToFileURL} from 'node:url';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const {FileStore} = await import(pathToFileURL(path.join(recipientTools, 'integrations/knowledge-feedback/store.mjs')));
const {initialState,selectIssues} = await import(pathToFileURL(path.join(recipientTools, 'integrations/knowledge-feedback/core.mjs')));
import {maintenanceIssues} from '../system/integrations/compounding-maintenance.mjs';

test('maintenance inventories every eligible issue with bounded output while Query remains relevant',async t=>{
 const home=fs.mkdtempSync(path.join(os.tmpdir(),'knowledge-maintenance-'));
 t.after(()=>fs.rmSync(home,{recursive:true,force:true}));
 const now=Date.parse('2026-11-07T00:00:00Z'),namespace={host:'local-agent',library_id:'tyler-knowledge',view:'local-owner'};
 const policy={version:'synthetic-1',analysis_allowed:true,temporary:false,retention_confirmed:true};
 const context={...namespace,enabled:true,policy,expires_at:'2026-12-01T00:00:00Z'};
 const common={schema_version:1,...namespace,revision:1,occurred_at:'2026-11-01T00:00:00Z',expires_at:context.expires_at,policy};
 const state=initialState(namespace),store=new FileStore({home,namespace});
 state.records.signal.s1={...common,type:'signal',id:'s1',lookup_id:'lookup',request_ref:'request',purpose:'research',kind:'answer_omission',assertion:{by:'agent',text:'Synthetic missing condition'},knowledge:{snapshot_id:null,used_mode:null},sources:[],payload_ref:null};
 for(let i=0;i<73;i++){
  const id='issue-'+i;
  state.records.issue[id]={...common,type:'issue',id,category:'answer_omission',subject:'same synthetic subject',condition_key:'condition-'+i,signal_ids:['s1'],owner:'Knowledge',next_action:'Inspect actual evidence',review_when:'new evidence',status:'triage',handoff_ref:null,evidence:[],counterevidence:[]};
 }
 fs.writeFileSync(store.file,JSON.stringify(state));
 const before=fs.readFileSync(store.file);
 assert.equal(selectIssues(state,{now,terms:[],limit:5}).length,0);
 const options={context,home,toolsRoot:recipientTools,limit:5,now};
 const result=await maintenanceIssues(options);
 assert.equal(result.status,'selected');assert.equal(result.total,73);assert.equal(result.returned,5);assert.equal(result.remaining,68);
 assert.deepEqual(fs.readFileSync(store.file),before);
 assert.equal((await maintenanceIssues({...options,context:{...context,policy:{...policy,temporary:true}}})).status,'disabled');
 assert.equal((await maintenanceIssues({...options,context:{...context,view:'foreign'}})).status,'disabled');
 assert.equal((await maintenanceIssues({...options,context:{...context,expires_at:'2026-10-01T00:00:00Z'}})).status,'disabled');
});
