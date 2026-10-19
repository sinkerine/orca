import { toast } from 'sonner'
import { translate } from '@/i18n/i18n'

export function showTerminalCopyFailure(): void {
  toast.error(
    translate('components.terminalPane.copyFailed', 'Unable to copy terminal selection'),
    { id: 'terminal-selection-copy-failed' }
  )
}
