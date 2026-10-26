export function createAppResourcesBanner(): string {
  // Shared Electron's resources belong to the runtime, not the application.
  return `;(() => {
  if (process.type !== 'browser') return;
  const { dirname, basename } = require('node:path');
  const appPath = require('electron').app.getAppPath();
  if (basename(appPath) === 'app.asar') {
    Object.defineProperty(process, 'resourcesPath', { value: dirname(appPath), configurable: true });
  }
})();\n`
}
