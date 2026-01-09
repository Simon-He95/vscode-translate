import type { ChildProcess } from 'node:child_process'
import { spawn } from 'node:child_process'
import * as fs from 'node:fs'
import * as http from 'node:http'
import * as https from 'node:https'
import * as path from 'node:path'

export type Lang = 'en' | 'zh'

export interface LocalServerConfig {
  enabled: boolean
  autoStart: boolean
  url?: string
  command: string
  startupTimeoutMs: number
  requestTimeoutMs: number
  idleTimeoutMs: number
  maxRestart: number

  offline?: boolean
  modelRoot?: string
  modelEnZh?: string
  modelZhEn?: string
}

export interface Logger {
  info: (msg: string) => void
  warn: (msg: string) => void
  error: (msg: string) => void
}

export interface ExtensionLikeContext {
  extensionPath?: string
  globalStorageUri?: { fsPath: string }
}

interface PortState {
  url: string
  pid?: number
  updatedAt: number
}

function safeMkdirp(dir: string) {
  try {
    fs.mkdirSync(dir, { recursive: true })
  }
  catch {
    // ignore
  }
}

function readJsonFile<T>(filePath: string): T | null {
  try {
    const raw = fs.readFileSync(filePath, 'utf8')
    return JSON.parse(raw) as T
  }
  catch {
    return null
  }
}

function writeJsonFileAtomic(filePath: string, data: unknown) {
  const tmpPath = `${filePath}.tmp`
  fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf8')
  fs.renameSync(tmpPath, filePath)
}

export function shellSplit(command: string): string[] {
  const result: string[] = []
  let current = ''
  let quote: '"' | "'" | null = null

  for (let i = 0; i < command.length; i++) {
    const ch = command[i]

    if (quote) {
      if (ch === quote) {
        quote = null
        continue
      }
      if (ch === '\\' && quote === '"') {
        // Basic escape support inside double quotes
        const next = command[i + 1]
        if (next) {
          current += next
          i++
          continue
        }
      }
      current += ch
      continue
    }

    if (ch === '"' || ch === "'") {
      quote = ch as any
      continue
    }

    if (whitespaceRegex.test(ch)) {
      if (current.length) {
        result.push(current)
        current = ''
      }
      continue
    }

    current += ch
  }

  if (current.length)
    result.push(current)

  return result
}

const whitespaceRegex = /\s/

function requestJson<T>(urlStr: string, method: 'GET' | 'POST', body: any | undefined, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const url = new URL(urlStr)
    const isHttps = url.protocol === 'https:'
    const lib = isHttps ? https : http

    const payload = body === undefined ? undefined : Buffer.from(JSON.stringify(body), 'utf8')

    const req = lib.request({
      protocol: url.protocol,
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method,
      headers: {
        ...(payload
          ? {
              'Content-Type': 'application/json',
              'Content-Length': payload.length,
            }
          : {}),
      },
    }, (res) => {
      const chunks: Buffer[] = []
      res.on('data', (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)))
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8')
        if (res.statusCode && res.statusCode >= 400) {
          reject(new Error(`HTTP ${res.statusCode}: ${text}`))
          return
        }
        try {
          resolve(JSON.parse(text) as T)
        }
        catch (e) {
          reject(e)
        }
      })
    })

    req.on('error', reject)
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error('Request timeout'))
    })

    if (payload)
      req.write(payload)
    req.end()
  })
}

async function isHealthy(baseUrl: string, timeoutMs: number) {
  const health = await requestJson<{ ok: boolean }>(`${baseUrl.replace(/\/$/, '')}/health`, 'GET', undefined, timeoutMs)
  return !!health?.ok
}

export class LocalTranslateServer {
  private child: ChildProcess | null = null
  private baseUrl: string | null = null
  private spawnedByUs = false
  private restartCount = 0
  private lastStartError: string | null = null
  private hasLoggedEnsureStartOnce = false

  private readonly portStatePath: string | null

  constructor(
    private readonly ctx: ExtensionLikeContext,
    private readonly config: LocalServerConfig,
    private readonly logger: Logger,
  ) {
    const storagePath = ctx.globalStorageUri?.fsPath
    if (storagePath) {
      safeMkdirp(storagePath)
      this.portStatePath = path.join(storagePath, 'local-translate-server.json')
    }
    else {
      this.portStatePath = null
    }
  }

  get url() {
    return this.baseUrl
  }

  getLastStartError() {
    return this.lastStartError
  }

  async ensureStarted(): Promise<string | null> {
    if (!this.config.enabled) {
      if (!this.hasLoggedEnsureStartOnce) {
        this.hasLoggedEnsureStartOnce = true
        this.logger.info('[local] ensureStarted: disabled (translate.useLocal=false)')
      }
      return null
    }

    this.lastStartError = null

    if (!this.hasLoggedEnsureStartOnce) {
      this.hasLoggedEnsureStartOnce = true
      this.logger.info(`[local] ensureStarted: enabled, autoStart=${this.config.autoStart}, url=${this.config.url || ''}`)
    }

    // 1) explicit URL
    if (this.config.url) {
      const ok = await this.safeHealthCheck(this.config.url)
      if (ok) {
        this.logger.info(`[local] reuse url: ${this.config.url}`)
        this.baseUrl = this.config.url
        return this.baseUrl
      }
      this.logger.warn(`[local] configured url not healthy: ${this.config.url}`)
    }

    // 2) cached URL from previous session
    if (this.portStatePath) {
      const state = readJsonFile<PortState>(this.portStatePath)
      if (state?.url) {
        const ok = await this.safeHealthCheck(state.url)
        if (ok) {
          this.logger.info(`[local] reuse cached url: ${state.url}`)
          this.baseUrl = state.url
          return this.baseUrl
        }
        this.logger.warn(`[local] cached url not healthy: ${state.url}`)
      }
    }

    // 3) spawn
    if (!this.config.autoStart) {
      this.logger.warn('[local] autoStart=false; will not spawn local server')
      return null
    }

    return await this.spawnAndWaitReady()
  }

  async translate(texts: string[], sourceLang: Lang, targetLang: Lang): Promise<string[] | null> {
    const baseUrl = await this.ensureStarted()
    if (!baseUrl)
      return null

    try {
      const { translated } = await requestJson<{ translated: string[] }>(
        `${baseUrl.replace(/\/$/, '')}/translate`,
        'POST',
        { texts, sourceLang, targetLang },
        this.config.requestTimeoutMs,
      )

      return translated
    }
    catch (e: any) {
      this.logger.warn(`[local] translate request failed: ${e?.message || String(e)}`)
      return null
    }
  }

  async stop(): Promise<void> {
    const baseUrl = this.baseUrl
    const child = this.child

    this.baseUrl = null

    // Only stop if we spawned it
    if (!this.spawnedByUs)
      return

    if (baseUrl) {
      try {
        await requestJson(`${baseUrl.replace(/\/$/, '')}/shutdown`, 'POST', {}, 1500)
      }
      catch {
        // ignore
      }
    }

    if (child && !child.killed) {
      await new Promise<void>((resolve) => {
        const timeout = setTimeout(() => {
          try {
            child.kill('SIGKILL')
          }
          catch {
            // ignore
          }
          resolve()
        }, 3000)

        child.once('exit', () => {
          clearTimeout(timeout)
          resolve()
        })

        try {
          child.kill('SIGTERM')
        }
        catch {
          clearTimeout(timeout)
          resolve()
        }
      })
    }

    this.child = null
    this.spawnedByUs = false
  }

  private async safeHealthCheck(url: string): Promise<boolean> {
    try {
      return await isHealthy(url, Math.min(1500, this.config.requestTimeoutMs))
    }
    catch {
      return false
    }
  }

  private async spawnAndWaitReady(): Promise<string | null> {
    if (this.restartCount >= this.config.maxRestart) {
      this.logger.warn('[local] reached max restart count; not starting again')
      return null
    }

    const extensionPath = this.ctx.extensionPath || process.cwd()

    const cmd = this.config.command?.trim()
    if (!cmd) {
      this.logger.warn('[local] translate.local.command is empty')
      return null
    }

    const parts = shellSplit(cmd)
    const file = parts[0]
    const args = parts.slice(1)

    this.logger.info(`[local] starting: ${file} ${args.join(' ')}`)

    const child = spawn(file, args, {
      cwd: extensionPath,
      env: {
        ...process.env,
        PYTHONUNBUFFERED: '1',
        VSCODE_TRANSLATE_IDLE_TIMEOUT_MS: String(this.config.idleTimeoutMs || 0),
        // Do not block READY on model downloads/loading.
        VSCODE_TRANSLATE_PRELOAD: '0',

         ...(this.config.offline
           ? {
               VSCODE_TRANSLATE_OFFLINE: '1',
               TRANSFORMERS_OFFLINE: '1',
               HF_HUB_OFFLINE: '1',
             }
           : {}),
         ...(this.config.modelRoot ? { VSCODE_TRANSLATE_MODEL_ROOT: this.config.modelRoot } : {}),
         ...(this.config.modelEnZh ? { VSCODE_TRANSLATE_MODEL_EN_ZH: this.config.modelEnZh } : {}),
         ...(this.config.modelZhEn ? { VSCODE_TRANSLATE_MODEL_ZH_EN: this.config.modelZhEn } : {}),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    this.child = child
    this.spawnedByUs = true
    this.restartCount++

    const stderrCollector = this.collectStderr(child)

    // spawn can fail before any stdout/stderr is produced (e.g. ENOENT)
    child.on('error', (err: any) => {
      const msg = err?.message ? String(err.message) : String(err)
      const code = err?.code ? ` (${String(err.code)})` : ''
      this.lastStartError = `[spawn error] ${msg}${code}`
      this.logger.error(`[local] spawn error: ${msg}${code}`)
    })

    const readyUrl = await this.waitForReadyLine(child, this.config.startupTimeoutMs)
    if (!readyUrl) {
      this.logger.warn('[local] server did not become ready in time')
      this.lastStartError = this.lastStartError || stderrCollector.getText()
      try {
        child.kill('SIGTERM')
      }
      catch {
        // ignore
      }
      return null
    }

    // Health check
    const ok = await this.safeHealthCheck(readyUrl)
    if (!ok) {
      this.logger.warn('[local] health check failed after READY')
      this.lastStartError = this.lastStartError || stderrCollector.getText()
      return null
    }

    this.baseUrl = readyUrl

    if (this.portStatePath) {
      try {
        writeJsonFileAtomic(this.portStatePath, { url: readyUrl, pid: child.pid, updatedAt: Date.now() } satisfies PortState)
      }
      catch {
        // ignore
      }
    }

    child.on('exit', (code, signal) => {
      this.logger.warn(`[local] process exited: code=${code} signal=${signal}`)
      if (this.baseUrl === readyUrl)
        this.baseUrl = null
      this.child = null
      this.spawnedByUs = false
    })

    child.stderr?.on('data', (b) => {
      const s = String(b)
      if (s.trim())
        this.logger.warn(`[local] ${s.trim()}`)
    })

    return readyUrl
  }

  private collectStderr(child: ChildProcess) {
    let text = ''
    const onData = (b: any) => {
      // keep bounded
      text += String(b)
      if (text.length > 8000)
        text = text.slice(-8000)
    }
    child.stderr?.on('data', onData)
    return {
      getText: () => text.trim() || null,
    }
  }

  private waitForReadyLine(child: ChildProcess, timeoutMs: number): Promise<string | null> {
    return new Promise((resolve) => {
      let buffer = ''

      const done = (url: string | null) => {
        cleanup()
        resolve(url)
      }

      const onData = (chunk: any) => {
        buffer += String(chunk)
        const lines = buffer.split(/\r?\n/)
        buffer = lines.pop() || ''
        for (const line of lines) {
          const m = line.match(/LOCAL_TRANSLATE_READY\s+(https?:\/\/\S+)/)
          if (m?.[1]) {
            done(m[1])
            return
          }
        }
      }

      const onExit = () => done(null)
      const onError = () => done(null)

      const t = setTimeout(() => done(null), timeoutMs)

      const cleanup = () => {
        clearTimeout(t)
        child.stdout?.off('data', onData)
        child.off('exit', onExit)
        child.off('error', onError)
      }

      child.stdout?.on('data', onData)
      child.on('exit', onExit)
      child.on('error', onError)
    })
  }
}
