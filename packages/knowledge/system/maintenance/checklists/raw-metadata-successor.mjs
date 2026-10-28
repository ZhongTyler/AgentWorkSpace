// Exact, approved header-only continuation. This is not a new semantic review.
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const allowed=new Set(['source','date','date_basis','captured_on','source_original_published','source_local_published']);
const split=b=>{const text=b.toString('utf8'),m=text.match(/^(?:\uFEFF)?---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/);assert(m,'Missing frontmatter');return {header:m[0],body:Buffer.from(text.slice(m[0].length))};};
export function metadataSuccessor(entry,row,read,validatePrior){
 try{
  assert.equal(typeof read,'function','Metadata continuation needs actual bytes');
  const p=entry.metadata_successor;assert.equal(p?.kind,'approved_exact_metadata_only');
  const load=v=>{assert(v?.path&&/^[a-f0-9]{64}$/.test(v.sha256));const b=read(v.path);assert.equal(sha(b),v.sha256,'Changed evidence: '+v.path);return b;};
  const before=load(p.before),after=read(row.raw_path),a=split(before),z=split(after);
  assert.equal(sha(after),row.raw_sha256);assert.equal(entry.raw_sha256,row.raw_sha256);
  assert.equal(sha(a.body),sha(z.body),'Body changed with metadata');
  const approval=JSON.parse(load(p.approval));assert.equal(approval.kind,'user_approved_metadata_plan');
  assert(approval.authorization_quote&&approval.entries?.some(e=>e.raw_path===row.raw_path&&JSON.stringify(e.edits)===JSON.stringify(p.edits)),'Correction not in approved exact scope');
  assert(Array.isArray(p.edits)&&p.edits.length);let header=a.header;
  for(const edit of p.edits){
   assert(allowed.has(edit.field),'Unsupported metadata field');
   assert.equal(typeof edit.before,'string');assert.equal(typeof edit.after,'string');
   assert.equal(edit.after.split(/\r?\n/).filter(Boolean).length,1,'Multiline replacement');
   assert(edit.after.startsWith(edit.field+':'),'Field mismatch');
   const lines=header.split(/\r?\n/);assert.equal(lines.filter(x=>x.startsWith(edit.field+':')).length,edit.before?1:0);
   const eol=header.includes('\r\n')?'\r\n':'\n';
   if(edit.before){assert(lines.includes(edit.before),'Unexpected prior field');header=header.replace(edit.before,edit.after);}
   else header=header.replace(new RegExp('---'+eol+'$'),edit.after+eol+'---'+eol);
  }
  assert.equal(header,z.header,'Unapproved header change');
  const prior=JSON.parse(load(p.prior_review));assert.equal(prior.kind,'raw_text_review');
  const old=prior.entries?.find(e=>e.raw_path===row.raw_path);assert(old&&!old.metadata_successor,'Continuation must bind an original text judgment');
  assert.deepEqual({...entry,raw_sha256:old.raw_sha256,checkout_byte_sha256:old.checkout_byte_sha256,metadata_successor:undefined},{...old,metadata_successor:undefined},'Inherited semantic scope changed');
  const priorResult=validatePrior(old,{...row,raw_sha256:sha(before)},name=>name===row.raw_path?sha(before):sha(read(name)));
  assert(priorResult.reusable,JSON.stringify(priorResult.errors));
  return {reusable:true,errors:[],not_native_v2_certification:true,metadata_only_successor:true,new_semantic_review:false,body_unchanged:true};
 }catch(error){return {reusable:false,errors:[error.message],not_native_v2_certification:true};}
}
