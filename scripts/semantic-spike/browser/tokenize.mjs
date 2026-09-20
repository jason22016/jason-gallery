// SigLIP2 uses fixed length 64, last-position pooling, no attention mask.
export function encodeQuery(tokenizer, text) {
  const ids = tokenizer.encode(text, {add_special_tokens:false}).ids;
  // Truncation precedes the EOS postprocessor in the HF baseline.
  const result = [...ids.slice(0,63), 1];
  while (result.length < 64) result.push(0);
  return result;
}
