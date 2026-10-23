/** Only checked transcript user prose can supply historical prompt text. */
export function terminalTranscriptPrompts(
  messages: readonly unknown[]
): { id: string; text: string }[] {
  return messages
    .flatMap((message) => {
      if (
        !message ||
        typeof message !== 'object' ||
        !('role' in message) ||
        message.role !== 'user' ||
        !('id' in message) ||
        typeof message.id !== 'string' ||
        !('blocks' in message) ||
        !Array.isArray(message.blocks)
      ) {
        return []
      }
      const text = message.blocks
        .flatMap((block: unknown) =>
          block &&
          typeof block === 'object' &&
          'type' in block &&
          block.type === 'text' &&
          'text' in block &&
          typeof block.text === 'string'
            ? [block.text]
            : []
        )
        .join('\n')
      return text.trim() ? [{ id: message.id, text }] : []
    })
    .slice(-200)
}
