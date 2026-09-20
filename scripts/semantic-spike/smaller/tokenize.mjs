// Actual text tokenization, independent of evaluation fixtures; fixed per-model contract.
export function encodeInputs(tokenizer,text,kind) {
 if(kind==='siglip') {
  const ids=[...tokenizer.encode(text,{add_special_tokens:false}).ids.slice(0,63),1];
  while(ids.length<64)ids.push(0);
  return {input_ids:ids};
 }
 if(kind==='multiclip') {
  const raw=tokenizer.encode(text,{add_special_tokens:false}).ids;
  const ids=[101,...raw.slice(0,126),102];const mask=ids.map(()=>1);
  while(ids.length<128){ids.push(0);mask.push(0);}
  return {input_ids:ids,attention_mask:mask};
 }
 if(kind==='mobileclip2') {
  // OpenCLIP basic cleaning on the tested valid-Unicode input domain. Not a full ftfy port.
  text=text.replace(/[\uff01-\uff5e]/g,c=>String.fromCharCode(c.charCodeAt(0)-0xfee0)).replace(/\u3000/g,' ').trim();
  const ids=[49406,...tokenizer.encode(text,{add_special_tokens:false}).ids.slice(0,75),49407];
  while(ids.length<77)ids.push(0);
  return {input_ids:ids};
 }
 throw Error('Unknown tokenizer kind '+kind);
}
