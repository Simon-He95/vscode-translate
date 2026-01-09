import * as vscode from 'vscode'
import translateLoader from '@simon_he/translate'
import { addEventListener, createExtension, createHover, createMarkdownString, createRange, createStyle, getActiveTextEditor, getConfiguration, getKeyWords, getLineText, getSelection, message, registerCommand, registerHoverProvider, setCommandParams, setCopyText, updateText } from '@vscode-use/utils'
import { cacheMap, escapeMarkdown, fixedVariableName, hasNoChinese, splitWords } from './utils'
import { LocalTranslateServer } from './local-server'

let localServer: LocalTranslateServer | null = null

export = createExtension((ctx) => {
  const remoteTranslate = translateLoader()
  let hasShownLocalStartError = false
  let hasLoggedLocalConfig = false

  const getPathBases = () => {
    const bases: string[] = []

    const folders = vscode.workspace.workspaceFolders
    if (folders?.length)
      bases.push(folders[0].uri.fsPath)

    const extPath = (ctx as any)?.extensionPath as string | undefined
    if (extPath)
      bases.push(extPath)

    bases.push(process.cwd())
    return bases
  }

  const resolveExistingPath = (inputPath: string) => {
    const raw = (inputPath || '').trim()
    if (!raw)
      return null
    try {
      const fs = require('node:fs') as typeof import('node:fs')
      const path = require('node:path') as typeof import('node:path')

      if (path.isAbsolute(raw) && fs.existsSync(raw))
        return raw

      for (const base of getPathBases()) {
        const candidate = path.join(base, raw)
        if (fs.existsSync(candidate))
          return candidate
      }

      return null
    }
    catch {
      return null
    }
  }

  const validateModelDir = (dirPath: string) => {
    try {
      const fs = require('node:fs') as typeof import('node:fs')

      if (!fs.existsSync(dirPath))
        return { ok: false, problems: ['Path does not exist'] }
      const stat = fs.statSync(dirPath)
      if (!stat.isDirectory())
        return { ok: false, problems: ['Path is not a directory'] }

      const entries = fs.readdirSync(dirPath)
      const has = (name: string) => entries.includes(name)
      const hasAny = (pred: (n: string) => boolean) => entries.some(pred)

      const problems: string[] = []
      if (!has('config.json'))
        problems.push('Missing config.json')

      const hasWeights = has('pytorch_model.bin')
        || has('model.safetensors')
        || hasAny(n => n.endsWith('.bin') || n.endsWith('.safetensors'))
      if (!hasWeights)
        problems.push('Missing model weights (*.bin or *.safetensors)')

      const hasTokenizer = has('tokenizer.json')
        || has('tokenizer_config.json')
        || has('sentencepiece.bpe.model')
        || has('spiece.model')
        || has('source.spm')
        || has('target.spm')
        || has('vocab.json')
      if (!hasTokenizer)
        problems.push('Missing tokenizer files (tokenizer.json/tokenizer_config.json/sentencepiece/spm/etc)')

      // small sanity: avoid obviously wrong folders
      if (entries.length < 2)
        problems.push('Directory looks empty')

      return { ok: problems.length === 0, problems }
    }
    catch (e: any) {
      return { ok: false, problems: [e?.message || String(e)] }
    }
  }

  const getBestDefaultCommand = () => {
    // Prefer workspace-local venv if present (works for installed extension too)
    const bases: string[] = []

    const folders = vscode.workspace.workspaceFolders
    if (folders?.length)
      bases.push(folders[0].uri.fsPath)

    // Fallbacks
    const extPath = (ctx as any)?.extensionPath as string | undefined
    if (extPath)
      bases.push(extPath)
    bases.push(process.cwd())

    const candidatePythons = (base: string) => {
      // macOS/Linux
      const unix = [`${base}/.venv/bin/python`, `${base}/.venv/bin/python3`]
      // Windows
      const win = [`${base}\\.venv\\Scripts\\python.exe`]
      return [...unix, ...win]
    }

    try {
      const fs = require('node:fs') as typeof import('node:fs')
      for (const base of bases) {
        for (const py of candidatePythons(base)) {
          if (fs.existsSync(py))
            return `${py} -u local_server/app.py --host 127.0.0.1 --port 0`
        }
      }
    }
    catch {
      // ignore
    }
    return 'python3 -u local_server/app.py --host 127.0.0.1 --port 0'
  }

  const readConfig = () => {
    const cfg = vscode.workspace.getConfiguration('translate')

    const commandInspect = cfg.inspect<string>('local.command')
    const userSetCommand = !!(
      commandInspect?.globalValue
      || commandInspect?.workspaceValue
      || commandInspect?.workspaceFolderValue
    )

    const defaultCommand = getBestDefaultCommand()
    return {
      dark: cfg.get<Record<string, any>>('dark', {}),
      light: cfg.get<Record<string, any>>('light', {}),

      useLocal: cfg.get<boolean>('useLocal', false),
      localAutoStart: cfg.get<boolean>('local.autoStart', true),
      localUrl: cfg.get<string>('local.url', ''),
      localCommand: userSetCommand
        ? cfg.get<string>('local.command', defaultCommand)
        : defaultCommand,
      localStartupTimeoutMs: cfg.get<number>('local.startupTimeoutMs', 30000),
      localRequestTimeoutMs: cfg.get<number>('local.requestTimeoutMs', 20000),
      localIdleTimeoutMs: cfg.get<number>('local.idleTimeoutMs', 0),
      localMaxRestart: cfg.get<number>('local.maxRestart', 2),

      localOffline: cfg.get<boolean>('local.offline', false),
      localModelRoot: cfg.get<string>('local.model.root', ''),
      localModelEnZh: cfg.get<string>('local.model.enZh', ''),
      localModelZhEn: cfg.get<string>('local.model.zhEn', ''),
    }
  }

  let config = readConfig()
  const { dark, light } = config

  const createLocalServer = () => {
    localServer = new LocalTranslateServer(
      ctx as any,
      {
        enabled: config.useLocal,
        autoStart: config.localAutoStart,
        url: config.localUrl || undefined,
        command: config.localCommand,
        startupTimeoutMs: Number(config.localStartupTimeoutMs),
        requestTimeoutMs: Number(config.localRequestTimeoutMs),
        idleTimeoutMs: Number(config.localIdleTimeoutMs),
        maxRestart: Number(config.localMaxRestart),

        offline: !!config.localOffline,
        modelRoot: config.localModelRoot || undefined,
        modelEnZh: config.localModelEnZh || undefined,
        modelZhEn: config.localModelZhEn || undefined,
      },
      {
        info: (s) => console.log(s),
        warn: (s) => console.warn(s),
        error: (s) => console.error(s),
      },
    )
  }

  createLocalServer()

  if (!hasLoggedLocalConfig) {
    hasLoggedLocalConfig = true
    console.log('[local] effective config:', {
      useLocal: config.useLocal,
      autoStart: config.localAutoStart,
      url: config.localUrl || null,
      command: config.localCommand,
      startupTimeoutMs: config.localStartupTimeoutMs,
      requestTimeoutMs: config.localRequestTimeoutMs,
    })
  }

  // Start early so hover feels responsive (no-op if not enabled)
  setTimeout(() => {
    localServer?.ensureStarted().then((url) => {
      if (!url && config.useLocal && !hasShownLocalStartError) {
        hasShownLocalStartError = true
        const detail = localServer?.getLastStartError()
        const hint = [
          'Local translate server failed to start.',
          'Install deps: pip install -r local_server/requirements.txt && pip install torch',
          'Or set translate.local.command to your python/venv.',
          detail ? `\n---\n${detail}` : '',
        ].join('\n')
        message.warn(hint)
      }
    }).catch(() => {
      // ignore
    })
  }, 0)
  let timer: any = null
  const md = createMarkdownString()
  md.isTrusted = true
  md.supportHtml = true

  const decorationType = createStyle({
    dark: Object.assign({
      textDecoration: 'underline',
    }, dark),
    light: Object.assign({
      textDecoration: 'underline',
    }, light),
  })

  return [
    registerHoverProvider('*', (document, position) => {
      if (document.fileName === 'exthost')
        return
      const activeTextEditor = getActiveTextEditor()
      if (!activeTextEditor)
        return
      if (timer)
        clearTimeout(timer)
      // 移除样式
      activeTextEditor.setDecorations(decorationType, [])
      const selection = getSelection()
      if (!selection)
        return
      const { selectedTextArray } = selection
      const selected = selectedTextArray[0].trim()
      const wordRange = createRange(activeTextEditor.selection.start, activeTextEditor.selection.end)
      const isUserSelect = selected

      if (!isUserSelect && getKeyWords(position)?.includes(' '))
        return

      const selectedText = isUserSelect ? selectedTextArray[0] : splitWords(getLineText(position.line) || '', position.character)

      if (!selectedText.length)
        return

      const realRangeMap: any = [
        {
          content: selectedText,
          range: wordRange,
        },
      ]

      if (!selectedText)
        return

      const isEn = hasNoChinese(selectedText)
      if (cacheMap.has(selectedText)) {
        const cacheText = cacheMap.get(selectedText)
        if (!cacheText)
          return
        return setStyle(isEn, activeTextEditor, realRangeMap, cacheText.textes, cacheText.translated)
      }

      return new Promise((resolve) => {
        timer = setTimeout(async () => {
          const _selectedText = selectedText.replace(/\?\./g, '.').replace(/(^[./]|\^|[/.~!{}$]$)/, '')
          const textes = isUserSelect
            ? [_selectedText]
            : Array.from(new Set([_selectedText, ..._selectedText.split(/[/.:=?,]/g).filter(item => /[a-z]/i.test(item)), ..._selectedText.split(/[-_/.:=?,]/g).filter(item => /[a-z]/i.test(item))])).filter(item => item && !/[.?:=/]$/.test(item))

          const sourceLang = isEn ? 'en' : 'zh'
          const targetLang = isEn ? 'zh' : 'en'

          const doTranslate = async () => {
            const local = await localServer?.translate(textes, sourceLang as any, targetLang as any)
            if (!local && config.useLocal && !hasShownLocalStartError) {
              hasShownLocalStartError = true
              const detail = localServer?.getLastStartError()
              const hint = [
                'Local translate server not available; falling back to remote.',
                'Install deps: pip install -r local_server/requirements.txt && pip install torch',
                'Or set translate.local.command to your python/venv.',
                detail ? `\n---\n${detail}` : '',
              ].join('\n')
              message.warn(hint)
            }
            if (local)
              return local
            return await remoteTranslate(textes)
          }

          doTranslate().then((translated) => {
            cacheMap.set(selectedText, { textes, translated })
            resolve(setStyle(isEn, activeTextEditor, realRangeMap, textes, translated))
          }).catch(() => {
            console.error('api 请求太频繁')
          })
        }, 200)
      })
    }),
    registerCommand('vscode-translate.copyText', (text, isReplaced) => {
      // vscode.env.clipboard.writeText(copyedText)
      if (isReplaced) {
        // 替换当前选中内容
        const selection = getSelection()!
        if (selection.selection) {
          updateText((edit) => {
            edit.replace(createRange(selection.selection.start, selection.selection.end), text)
          })
          message.info('替换成功')
          return
        }
      }
      setCopyText(text)
      message.info('复制成功')
    }),
    registerCommand('vscode-translate.checkLocalModel', async () => {
      const cfg = readConfig()

      if (!cfg.useLocal) {
        message.info('translate.useLocal=false（当前未启用本地翻译）')
        return
      }

      const details: string[] = []
      details.push(`useLocal=true, offline=${cfg.localOffline ? 'true' : 'false'}`)

      const offline = !!cfg.localOffline
      const root = (cfg.localModelRoot || '').trim()
      const enZh = (cfg.localModelEnZh || '').trim()
      const zhEn = (cfg.localModelZhEn || '').trim()

      const problems: string[] = []

      if (offline && !root && (!enZh || !zhEn)) {
        problems.push('Offline=true 时需要设置 translate.local.model.root，或同时设置 translate.local.model.enZh 与 translate.local.model.zhEn')
      }

      if (root) {
        const resolvedRoot = resolveExistingPath(root)
        if (!resolvedRoot) {
          problems.push(`model.root not found: ${root}`)
        }
        else {
          const path = require('node:path') as typeof import('node:path')
          const enDir = path.join(resolvedRoot, 'en-zh')
          const zhDir = path.join(resolvedRoot, 'zh-en')

          const enCheck = validateModelDir(enDir)
          const zhCheck = validateModelDir(zhDir)

          if (!enCheck.ok)
            problems.push(`root/en-zh: ${enCheck.problems.join('; ')}`)
          if (!zhCheck.ok)
            problems.push(`root/zh-en: ${zhCheck.problems.join('; ')}`)

          details.push(`model.root -> ${resolvedRoot}`)
        }
      }

      if (enZh) {
        const resolved = resolveExistingPath(enZh)
        if (!resolved)
          problems.push(`model.enZh not found: ${enZh}`)
        else {
          const check = validateModelDir(resolved)
          if (!check.ok)
            problems.push(`model.enZh: ${check.problems.join('; ')}`)
          details.push(`model.enZh -> ${resolved}`)
        }
      }

      if (zhEn) {
        const resolved = resolveExistingPath(zhEn)
        if (!resolved)
          problems.push(`model.zhEn not found: ${zhEn}`)
        else {
          const check = validateModelDir(resolved)
          if (!check.ok)
            problems.push(`model.zhEn: ${check.problems.join('; ')}`)
          details.push(`model.zhEn -> ${resolved}`)
        }
      }

      if (problems.length) {
        message.warn([
          '本地模型配置检查失败：',
          ...problems.map(p => `- ${p}`),
          '',
          ...details,
        ].join('\n'))
        return
      }

      message.info(['本地模型配置检查通过。', ...details].join('\n'))
    }),
    addEventListener('selection-change', (e) => {
      if (e.textEditor.document.fileName === 'exthost')
        return
      e.textEditor.setDecorations(decorationType, [])
    }),

    addEventListener('config-change', async (e: any) => {
      // Only react to our namespace
      if (typeof e?.affectsConfiguration === 'function' && !e.affectsConfiguration('translate'))
        return

      const nextConfig = readConfig()
      const nextUseLocal = nextConfig.useLocal
      config = nextConfig

      // Stop existing server if user disabled it
      if (!nextUseLocal) {
        await localServer?.stop()
        return
      }

      // Restart with new config (command/url/timeouts etc)
      await localServer?.stop()
      createLocalServer()
      await localServer?.ensureStarted().catch(() => {})
    }),
  ]
  function setStyle(isEn: boolean | undefined, editor: vscode.TextEditor, realRangeMap: any[], textes: string[], translated: string[]) {
    editor.edit(() => editor.setDecorations(decorationType, realRangeMap.map((item: any) => item.range)))
    md.value = ''
    if (isEn !== undefined)
      md.appendMarkdown(`### vscode-translate(${isEn ? '中文翻译' : '英文翻译'}): \n`)

    for (let i = 0; i < textes.length; i++) {
      const originText = textes[i]
      const translatedText = translated[i]

      const copyIcon = '<img width="14" height="14" src="data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxZW0iIGhlaWdodD0iMWVtIiB2aWV3Qm94PSIwIDAgMjQgMjQiPjxwYXRoIGZpbGw9IiMyNTZlOTMiIGQ9Ik05IDE4cS0uODI1IDAtMS40MTItLjU4N1Q3IDE2VjRxMC0uODI1LjU4OC0xLjQxMlQ5IDJoOXEuODI1IDAgMS40MTMuNTg4VDIwIDR2MTJxMCAuODI1LS41ODcgMS40MTNUMTggMTh6bTAtMmg5VjRIOXptLTQgNnEtLjgyNSAwLTEuNDEyLS41ODdUMyAyMFY3cTAtLjQyNS4yODgtLjcxMlQ0IDZ0LjcxMy4yODhUNSA3djEzaDEwcS40MjUgMCAuNzEzLjI4OFQxNiAyMXQtLjI4OC43MTNUMTUgMjJ6bTQtNlY0eiIvPjwvc3ZnPg==" />'
      const pasteIcon = '<img width="14" height="14" src="data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxZW0iIGhlaWdodD0iMWVtIiB2aWV3Qm94PSIwIDAgMzYgMzYiPjxwYXRoIGZpbGw9IiMwYjI1ZWEiIGQ9Ik0zMCAxMmgtNHYyaDR2Mmgydi0yYTIgMiAwIDAgMC0yLTIiIGNsYXNzPSJjbHItaS1vdXRsaW5lIGNsci1pLW91dGxpbmUtcGF0aC0xIi8+PHBhdGggZmlsbD0iIzBiMjVlYSIgZD0iTTMwIDE4aDJ2NmgtMnoiIGNsYXNzPSJjbHItaS1vdXRsaW5lIGNsci1pLW91dGxpbmUtcGF0aC0yIi8+PHBhdGggZmlsbD0iIzBiMjVlYSIgZD0iTTMwIDMwaC0ydjJoMmEyIDIgMCAwIDAgMi0ydi00aC0yWiIgY2xhc3M9ImNsci1pLW91dGxpbmUgY2xyLWktb3V0bGluZS1wYXRoLTMiLz48cGF0aCBmaWxsPSIjMGIyNWVhIiBkPSJNMjQgMjJWNmEyIDIgMCAwIDAtMi0ySDZhMiAyIDAgMCAwLTIgMnYxNmEyIDIgMCAwIDAgMiAyaDE2YTIgMiAwIDAgMCAyLTJNNiA2aDE2djE2SDZaIiBjbGFzcz0iY2xyLWktb3V0bGluZSBjbHItaS1vdXRsaW5lLXBhdGgtNCIvPjxwYXRoIGZpbGw9IiMwYjI1ZWEiIGQ9Ik0yMCAzMGg2djJoLTZ6IiBjbGFzcz0iY2xyLWktb3V0bGluZSBjbHItaS1vdXRsaW5lLXBhdGgtNSIvPjxwYXRoIGZpbGw9IiMwYjI1ZWEiIGQ9Ik0xNCAyNmgtMnY0YTIgMiAwIDAgMCAyIDJoNHYtMmgtNFoiIGNsYXNzPSJjbHItaS1vdXRsaW5lIGNsci1pLW91dGxpbmUtcGF0aC02Ii8+PHBhdGggZmlsbD0ibm9uZSIgZD0iTTAgMGgzNnYzNkgweiIvPjwvc3ZnPg==" />'
      const variableIcon = '<img width="14" height="14" src="data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIzMiIgaGVpZ2h0PSIzMiIgdmlld0JveD0iMCAwIDI0IDI0Ij48cGF0aCBmaWxsPSIjMDU3ZWYwIiBkPSJNMjAuNDEgM2MxLjM5IDIuNzEgMS45NCA1Ljg0IDEuNTkgOWMtLjIgMy4xNi0xLjMgNi4yOS0zLjE3IDlsLTEuNTMtMWMxLjYxLTIuNDMgMi41NS01LjIgMi43LThjLjM0LTIuOC0uMTEtNS41Ny0xLjMtOHpNNS4xNyAzTDYuNyA0QzUuMDkgNi40MyA0LjE1IDkuMiA0IDEyYy0uMzQgMi44LjEyIDUuNTcgMS4zIDhsLTEuNjkgMWMtMS40LTIuNzEtMS45Ni01LjgzLTEuNjEtOWMuMi0zLjE2IDEuMy02LjI5IDMuMTctOW02LjkxIDcuNjhsMi4zMi0zLjIzaDIuNTNsLTMuNzggNWwyLjIgNC45MmgtMi4yNkwxMS43MSAxNGwtMi40MyAzLjMzSDYuNzZsMy45LTUuMTJsLTIuMTMtNC43NmgyLjI3eiIvPjwvc3ZnPg==" />'
      const variableLargeIcon = '<img width="14" height="14" src="data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIzMiIgaGVpZ2h0PSIzMiIgdmlld0JveD0iMCAwIDI0IDI0Ij48ZyBmaWxsPSJub25lIiBzdHJva2U9IiMwNTdlZjAiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIgc3Ryb2tlLWxpbmVqb2luPSJyb3VuZCIgc3Ryb2tlLXdpZHRoPSIxLjUiIGNvbG9yPSIjMDU3ZWYwIj48cGF0aCBkPSJNMjAgMy41Yy02LjM2NyAwLTkuNjMzIDE3LTE2IDE3Ii8+PHBhdGggZD0iTTE5IDIwLjVjLTEuNjE4IDAtMi40MjYgMC0zLjEwOC0uMzQyYTMuNSAzLjUgMCAwIDEtMS4wNC0uOGMtLjUzLS41OTEtLjgyLTEuNDM4LTEuNDAxLTMuMTNsLTIuOTAyLTguNDU2Yy0uNTgtMS42OTItLjg3LTIuNTM5LTEuNC0zLjEzYTMuNSAzLjUgMCAwIDAtMS4wNC0uOEM3LjQyNSAzLjUgNi42MTcgMy41IDUgMy41Ii8+PC9nPjwvc3ZnPg==" />'

      md.appendMarkdown(`- ${escapeMarkdown(originText)}: ${escapeMarkdown(translatedText)} &nbsp;&nbsp;&nbsp;&nbsp;<a href="command:vscode-translate.copyText?${setCommandParams([translatedText])}">${copyIcon}</a>&nbsp;&nbsp;&nbsp;<a href="command:vscode-translate.copyText?${setCommandParams([translatedText, true])}">${pasteIcon}</a>&nbsp;&nbsp;&nbsp;<a href="command:vscode-translate.copyText?${setCommandParams([fixedVariableName(translatedText)])}">${variableIcon}</a>&nbsp;&nbsp;&nbsp;<a href="command:vscode-translate.copyText?${setCommandParams([fixedVariableName(translatedText, true)])}">${variableLargeIcon}</a>\n\n`)
    }
    return createHover(md)
  }
}, async () => {
  cacheMap.clear()
  await localServer?.stop()
  localServer = null
})
