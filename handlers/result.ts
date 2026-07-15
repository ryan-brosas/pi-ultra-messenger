export function result(text: string, details: Record<string, unknown>) {
  return {
    content: [{ type: 'text' as const, text }],
    details,
  };
}

export function notRegisteredError() {
  return result('Not registered. Use MCP Agent Mail to register your agent identity.', {
    mode: 'error',
    error: 'not_registered',
  });
}
