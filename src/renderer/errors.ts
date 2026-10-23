// Electron wraps errors thrown in the main process as "Error invoking remote method 'x': Error: <message>".
export function errorText(reason: unknown, fallback: string) {
  const message = reason instanceof Error ? reason.message : '';
  return message.replace(/^Error invoking remote method '[^']+': (?:\w*Error: )?/, '') || fallback;
}
