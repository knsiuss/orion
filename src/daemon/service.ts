/**
 * @file service.ts
 * @description Cross-platform daemon management — install/uninstall/status/restart EDITH as a system service.
 *
 * ARCHITECTURE:
 *   Platform detection routes to the appropriate service manager:
 *   - macOS: launchd (~/Library/LaunchAgents)
 *   - Linux: systemd --user
 *   - Windows: Task Scheduler (schtasks)
 *   Used by `edith daemon install/status/uninstall` CLI commands.
 */
import { platform } from 'node:os'
import { createLogger } from '../logger.js'

const log = createLogger('daemon.service')

/** Daemon status snapshot. */
export interface DaemonStatus {
  running: boolean
  pid: number | null
  uptime?: number
  platform: string
}

class DaemonManager {
  /**
   * Install EDITH as a system service that starts on login.
   * Platform-aware: launchd (macOS), systemd (Linux), schtasks (Windows).
   */
  async install(): Promise<void> {
    switch (platform()) {
      case 'darwin': return this.installLaunchd()
      case 'linux': return this.installSystemd()
      case 'win32': return this.installSchtasks()
      default: throw new Error(`Unsupported platform: ${platform()}`)
    }
  }

  private async installLaunchd(): Promise<void> {
    const { writeFileSync, mkdirSync } = await import('node:fs')
    const { homedir } = await import('node:os')
    const { join } = await import('node:path')
    const plistDir = join(homedir(), 'Library', 'LaunchAgents')
    mkdirSync(plistDir, { recursive: true })
    const plistPath = join(plistDir, 'ai.edith.gateway.plist')
    const nodePath = process.execPath
    const edithPath = process.argv[1] ?? 'src/main.ts'
    const logsDir = join(homedir(), '.edith', 'logs')
    mkdirSync(logsDir, { recursive: true })
    writeFileSync(plistPath, `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>ai.edith.gateway</string>
  <key>ProgramArguments</key>
  <array>
    <string>${nodePath}</string>
    <string>${edithPath}</string>
    <string>--mode</string><string>gateway</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>${logsDir}/gateway.log</string>
  <key>StandardErrorPath</key><string>${logsDir}/gateway.error.log</string>
</dict>
</plist>`)
    const { execSync } = await import('node:child_process')
    execSync(`launchctl load "${plistPath}"`)
    log.info('launchd plist installed', { path: plistPath })
  }

  private async installSystemd(): Promise<void> {
    const { writeFileSync, mkdirSync } = await import('node:fs')
    const { homedir } = await import('node:os')
    const { join } = await import('node:path')
    const unitDir = join(homedir(), '.config', 'systemd', 'user')
    mkdirSync(unitDir, { recursive: true })
    const unitPath = join(unitDir, 'edith.service')
    writeFileSync(unitPath, `[Unit]
Description=EDITH AI Gateway
After=network.target

[Service]
Type=simple
ExecStart=${process.execPath} ${process.argv[1] ?? 'src/main.ts'} --mode gateway
Restart=always
RestartSec=10
Environment=NODE_ENV=production

[Install]
WantedBy=default.target`)
    const { execSync } = await import('node:child_process')
    execSync('systemctl --user daemon-reload && systemctl --user enable edith && systemctl --user start edith')
    log.info('systemd unit installed', { path: unitPath })
  }

  private async installSchtasks(): Promise<void> {
    const { execSync } = await import('node:child_process')
    const nodePath = process.execPath
    const edithPath = process.argv[1] ?? 'src/main.ts'
    const cmd = `"${nodePath}" "${edithPath}" --mode gateway`
    const username = process.env['USERNAME'] ?? process.env['USER'] ?? 'SYSTEM'
    execSync(`schtasks /create /tn "EDITH Gateway" /tr "${cmd}" /sc onlogon /ru "${username}" /f`)
    log.info('windows task scheduler entry created')
  }

  /**
   * Check the current daemon status by polling the health endpoint.
   * @returns Current daemon status
   */
  async status(): Promise<DaemonStatus> {
    try {
      const res = await fetch('http://localhost:18789/health', {
        signal: AbortSignal.timeout(2000),
      })
      return { running: res.ok, pid: null, platform: platform() }
    } catch {
      return { running: false, pid: null, platform: platform() }
    }
  }

  /**
   * Uninstall the EDITH daemon service.
   * Platform-aware cleanup.
   */
  async uninstall(): Promise<void> {
    const { execSync } = await import('node:child_process')
    switch (platform()) {
      case 'darwin':
        try { execSync('launchctl unload ~/Library/LaunchAgents/ai.edith.gateway.plist') } catch { /* not installed */ }
        break
      case 'linux':
        try { execSync('systemctl --user disable edith && systemctl --user stop edith') } catch { /* not installed */ }
        break
      case 'win32':
        try { execSync('schtasks /delete /tn "EDITH Gateway" /f') } catch { /* not installed */ }
        break
    }
    log.info('daemon uninstalled', { platform: platform() })
  }
}

/** Singleton daemon manager — use this for all daemon install/status/uninstall operations. */
export const daemonManager = new DaemonManager()
