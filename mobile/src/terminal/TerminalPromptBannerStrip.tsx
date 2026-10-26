import { Pressable, Text } from 'react-native'
import { colors } from '../theme/mobile-theme'
import type { TerminalPromptContext } from './use-terminal-prompt-banner'

const UNKNOWN_PROMPT = 'No prompt recorded at this position'

/** The prompt above the terminal's viewport; a tap scrolls back to where it was submitted. */
export function TerminalPromptBannerStrip({
  context,
  onJump
}: {
  context: TerminalPromptContext
  onJump: () => void
}) {
  if (!context.known) {
    return null
  }
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={context.text || UNKNOWN_PROMPT}
      accessibilityState={{ disabled: !context.jumpable }}
      onPress={onJump}
      style={{
        minHeight: 44,
        paddingHorizontal: 12,
        justifyContent: 'center',
        backgroundColor: colors.bgPanel
      }}
    >
      <Text numberOfLines={1} style={{ color: colors.textPrimary, fontSize: 12 }}>
        {context.text || UNKNOWN_PROMPT}
      </Text>
    </Pressable>
  )
}
