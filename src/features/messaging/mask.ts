// Stealth theme: hide characters but keep spaces and line breaks, so the shape
// of a conversation stays recognisable to its owner and nothing else does.
export function maskText(text: string) {
  return text.replace(/\S/g, '•');
}
