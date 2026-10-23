import { ActivityIndicator, Keyboard, Pressable, StyleSheet, Text, View } from 'react-native'
import { BottomDrawer } from '../components/BottomDrawer'
import { colors, radii, spacing, typography } from '../theme/mobile-theme'
import { DescriptorRows, SessionOptionCaption } from './MobileNativeChatSessionOptionRows'
import { useTerminalModelPicker } from './use-terminal-model-picker'
import type { RpcClient } from '../transport/rpc-client'

export function MobileTerminalModelPicker({
  client,
  terminal,
  disabled
}: {
  client: RpcClient | null
  terminal: string | null
  disabled: boolean
}) {
  const picker = useTerminalModelPicker(client, terminal)
  const descriptor = picker.result?.descriptor
  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Choose agent model"
        accessibilityState={{ disabled: disabled || picker.pending }}
        disabled={disabled || picker.pending}
        style={styles.button}
        onPress={() => {
          Keyboard.dismiss()
          picker.open()
        }}
      >
        <Text style={[styles.buttonText, disabled && styles.disabled]}>Model</Text>
      </Pressable>
      <BottomDrawer visible={picker.visible} onClose={picker.close}>
        <View style={styles.header}>
          <Text style={styles.title}>{descriptor?.label ?? 'Model'}</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close model picker"
            disabled={picker.pending}
            onPress={picker.close}
            style={styles.button}
          >
            <Text style={styles.buttonText}>Close</Text>
          </Pressable>
        </View>
        {picker.pending ? (
          <ActivityIndicator
            accessibilityLabel="Reading agent model choices"
            color={colors.textSecondary}
          />
        ) : null}
        {picker.result?.message ? (
          <SessionOptionCaption>{picker.result.message}</SessionOptionCaption>
        ) : null}
        {descriptor && picker.result?.phase !== 'uncertain' ? (
          <View style={styles.group}>
            <DescriptorRows
              descriptor={{
                ...descriptor,
                category: 'model',
                valueSource: 'unknown',
                transport: 'catalog',
                settable: true
              }}
              disabled={picker.pending}
              grouped
              onSetOption={(value) => {
                if (typeof value === 'string') {
                  picker.select(value)
                }
              }}
              onInvokeAction={() => {}}
            />
          </View>
        ) : null}
        {picker.result?.phase === 'uncertain' ? (
          <Pressable
            accessibilityRole="button"
            disabled={picker.pending}
            onPress={picker.release}
            style={styles.button}
          >
            <Text style={styles.buttonText}>
              {picker.result.transactionId ? 'Return control to terminal' : 'Recover model picker'}
            </Text>
          </Pressable>
        ) : null}
      </BottomDrawer>
    </>
  )
}

const styles = StyleSheet.create({
  button: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  buttonText: { color: colors.textSecondary, fontSize: typography.metaSize },
  disabled: { color: colors.textMuted },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.md
  },
  title: { color: colors.textPrimary, fontSize: typography.titleSize, fontWeight: '700', flex: 1 },
  group: { backgroundColor: colors.bgRaised, borderRadius: radii.card, overflow: 'hidden' }
})
