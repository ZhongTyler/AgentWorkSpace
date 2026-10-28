import {requireValue} from './state.mjs';
// Structural privacy guard only. Source qualification/retention and the shared
// core still own record semantics; this does not certify assertion text.
export function assertMinimalMetadata(value){
 const visit=v=>{if(v&&typeof v==='object')for(const [key,child]of Object.entries(v)){
  requireValue(!/^(api_?key|key|password|cookie|messages|question|answer|authorization|identity|email)$/i.test(key),'nonminimal_private_metadata');visit(child);
 }};visit(value);
}
