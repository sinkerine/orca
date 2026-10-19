import { app } from 'electron'

export function isLinuxWaylandSession(): boolean {
  if (process.platform !== 'linux') {
    return false
  }
  const platform = (app.commandLine.getSwitchValue('ozone-platform') ?? '').toLowerCase()
  const hint = process.env.ELECTRON_OZONE_PLATFORM_HINT?.toLowerCase()
  return (
    platform !== 'x11' &&
    !(platform === '' && hint === 'x11') &&
    (Boolean(process.env.WAYLAND_DISPLAY) ||
      process.env.XDG_SESSION_TYPE === 'wayland' ||
      platform === 'wayland' ||
      hint === 'wayland')
  )
}
