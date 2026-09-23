export function illegalTransition(from: string, event: string): Error {
  return new Error(`illegal transition: "${event}" not allowed from "${from}"`);
}
