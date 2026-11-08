// Deliberately limited to the reviewed backend schema's keyword set. Unknown
// keywords and nonlocal references fail closed; this is not a general validator.
import {canonical,requireValue,SyncError} from './state.mjs';
const keywords=new Set('$schema $id $defs $ref type properties required additionalProperties const enum minimum maximum minItems maxItems maxLength pattern format items allOf anyOf if then else'.split(' '));
export function compileReviewedSchema(root){
 const inspect=s=>{requireValue(s&&typeof s==='object'&&!Array.isArray(s),'analysis_schema_unsupported');for(const k of Object.keys(s))requireValue(keywords.has(k),'analysis_schema_unsupported');
  if(s.$ref)requireValue(/^#\/\$defs\/[A-Za-z0-9_-]+$/.test(s.$ref)&&root.$defs?.[s.$ref.slice(8)],'analysis_schema_unsupported');
  for(const k of ['properties','$defs'])for(const v of Object.values(s[k]??{}))inspect(v);
  for(const k of ['items','if','then','else'])if(s[k])inspect(s[k]);for(const k of ['allOf','anyOf'])for(const v of s[k]??[])inspect(v);
  if(s.format)requireValue(s.format==='date-time','analysis_schema_unsupported');
 };inspect(root);
 const plain=v=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&Object.getPrototypeOf(v)===Object.prototype;
 const type=(v,t)=>t==='null'?v===null:t==='object'?plain(v):t==='array'?Array.isArray(v):t==='integer'?Number.isSafeInteger(v):t==='number'?typeof v==='number'&&Number.isFinite(v):typeof v===t;
 return value=>{
  let visits=0;const bad=()=>{throw new SyncError('analysis_snapshot_invalid');};
  const match=(v,s,depth)=>{try{check(v,s,depth);return true;}catch(e){if(e.code==='analysis_snapshot_invalid')return false;throw e;}};
  const check=(v,s,depth=0)=>{requireValue(++visits<=1000000&&depth<=64,'analysis_snapshot_capacity');
   if(s.$ref)check(v,root.$defs[s.$ref.slice(8)],depth+1);
   if(s.type&&!([].concat(s.type)).some(t=>type(v,t)))bad();
   if('const'in s&&canonical(v)!==canonical(s.const))bad();if(s.enum&&!s.enum.some(x=>canonical(x)===canonical(v)))bad();
   if(typeof v==='number'&&(s.minimum!==undefined&&v<s.minimum||s.maximum!==undefined&&v>s.maximum))bad();
   if(typeof v==='string'){if(s.maxLength!==undefined&&[...v].length>s.maxLength)bad();if(s.pattern&&!new RegExp(s.pattern,'u').test(v))bad();if(s.format==='date-time'&&(!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/.test(v)||!Number.isFinite(Date.parse(v))))bad();}
   if(Array.isArray(v)){if(s.minItems!==undefined&&v.length<s.minItems||s.maxItems!==undefined&&v.length>s.maxItems)bad();if(s.items)for(const x of v)check(x,s.items,depth+1);}
   if(plain(v)){if(s.required?.some(k=>!Object.hasOwn(v,k)))bad();for(const [k,x]of Object.entries(v)){if(s.properties?.[k])check(x,s.properties[k],depth+1);else if(s.additionalProperties===false)bad();}}
   for(const x of s.allOf??[])check(v,x,depth+1);if(s.anyOf&&!s.anyOf.some(x=>match(v,x,depth+1)))bad();
   if(s.if){const branch=match(v,s.if,depth+1)?s.then:s.else;if(branch)check(v,branch,depth+1);}
  };check(value,root);return true;
 };
}
