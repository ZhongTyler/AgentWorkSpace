// Tokenize authored Markdown using an explicitly provided local Marked module.
// The input is data; HTML and commands are not executed.
import fs from 'node:fs';
import crypto from 'node:crypto';
import {pathToFileURL} from 'node:url';
const [bookPath,modulePath]=process.argv.slice(2);
if(!bookPath||!modulePath)throw Error('usage: node parse_markdown.mjs book.json /local/marked.esm.js');
const {marked}=await import(pathToFileURL(modulePath));
const book=JSON.parse(fs.readFileSync(bookPath,'utf8'));
for(const doc of book.documents){
 const md=fs.readFileSync(doc.reader_path,'utf8');
 doc.tokens=marked.lexer(md,{gfm:true,breaks:false});
 doc.reader_sha256=crypto.createHash('sha256').update(md).digest('hex');
}
book.lexer={module:modulePath,sha256:crypto.createHash('sha256').update(fs.readFileSync(modulePath)).digest('hex'),node:process.version};
fs.writeFileSync(bookPath,JSON.stringify(book,null,2)+'\n');
console.log(JSON.stringify({documents:book.documents.length,blocks:book.documents.reduce((n,d)=>n+d.tokens.length,0)}));
