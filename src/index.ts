import * as vscode from 'vscode'
import translateLoader from '@simon_he/translate'
import ClaudeApi from 'anthropic-ai'
import { addEventListener, createExtension, createStyle, getActiveTextEditor, getConfiguration, getKeyWords, getSelection, registerCommand, registerHoverProvider } from '@vscode-use/utils'
import { cacheMap } from './utils'

export const { activate, deactivate } = createExtension((_, disposals) => {
  let copyedText = ''
  const translate = translateLoader()
  const { dark = {}, light = {} } = getConfiguration('translate') || {}
  let timer: any = null
  const colorTheme = vscode.window.activeColorTheme
  const copyIco = colorTheme.kind === vscode.ColorThemeKind.Light
    ? 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIzMiIgaGVpZ2h0PSIzMiIgdmlld0JveD0iMCAwIDI0IDI0Ij48cGF0aCBmaWxsPSJjdXJyZW50Q29sb3IiIGQ9Ik01IDIycS0uODI1IDAtMS40MTMtLjU4OFQzIDIwVjZoMnYxNGgxMXYySDVabTQtNHEtLjgyNSAwLTEuNDEzLS41ODhUNyAxNlY0cTAtLjgyNS41ODgtMS40MTNUOSAyaDlxLjgyNSAwIDEuNDEzLjU4OFQyMCA0djEycTAgLjgyNS0uNTg4IDEuNDEzVDE4IDE4SDlabTAtMmg5VjRIOXYxMlptMCAwVjR2MTJaIi8+PC9zdmc+'
    : 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIzMiIgaGVpZ2h0PSIzMiIgdmlld0JveD0iMCAwIDI0IDI0Ij48cGF0aCBmaWxsPSIjZmZmZmZmIiBkPSJNNSAyMnEtLjgyNSAwLTEuNDEzLS41ODhUMyAyMFY2aDJ2MTRoMTF2Mkg1Wm00LTRxLS44MjUgMC0xLjQxMy0uNTg4VDcgMTZWNHEwLS44MjUuNTg4LTEuNDEzVDkgMmg5cS44MjUgMCAxLjQxMy41ODhUMjAgNHYxMnEwIC44MjUtLjU4OCAxLjQxM1QxOCAxOEg5Wm0wLTJoOVY0SDl2MTJabTAgMFY0djEyWiIvPjwvc3ZnPg=='
  const md = new vscode.MarkdownString()
  md.isTrusted = true
  md.supportHtml = true

  const style = {
    dark: Object.assign({
      textDecoration: 'underline',
    }, dark),
    light: Object.assign({
      textDecoration: 'underline',
    }, light),
  }

  const decorationType = createStyle(style)

  disposals.push(registerHoverProvider('*',
    (_, position) => {
      const editor = vscode.window.activeTextEditor

      if (!editor)
        return
      if (timer)
        clearTimeout(timer)
      // 移除样式
      const activeTextEditor = getActiveTextEditor()
      if (!activeTextEditor)
        return
      activeTextEditor.setDecorations(decorationType, [])
      const selection = getSelection()
      if (!selection)
        return
      const { line, selectedTextArray } = selection
      const selected = selectedTextArray[0]
      const wordRange = new vscode.Range(editor.selection.start, editor.selection.end) as any
      const isUseSelect = selected && line === position.line
      const selectedText = isUseSelect ? selected : getKeyWords(position)
      if (!selectedText)
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
        return setStyle(isEn, editor, realRangeMap, selectedText, cacheText)
      }

      return new Promise((resolve) => {
        timer = setTimeout(async () => {
          translate(selectedText).then((translated) => {
            cacheMap.set(selectedText, translated)
            resolve(setStyle(isEn, editor, realRangeMap, selectedText, translated as string))
          }).catch(async () => {
            try {
              const translated = (await request(2, selectedText) as string).trim()
              cacheMap.set(selectedText, translated)
              return resolve(setStyle(undefined, editor, realRangeMap, selectedText, translated))
            }
            catch (e) {
              console.error('api 请求太频繁')
            }
          })
        }, 200)
      })
    }))

  disposals.push(registerCommand('extension.copyText', () => {
    vscode.env.clipboard.writeText(copyedText)
    vscode.window.showInformationMessage('复制成功')
  }))

  disposals.push(addEventListener('selection-change', () => vscode.window.activeTextEditor?.setDecorations(decorationType, [])))

  function setStyle(isEn: boolean | undefined, editor: vscode.TextEditor, realRangeMap: any[], selectedText: string, translated: string) {
    editor.edit(() => editor.setDecorations(decorationType, realRangeMap.map((item: any) => item.range)))
    md.value = ''
    copyedText = translated
    if (isEn !== undefined)
      md.appendMarkdown(`${isEn ? '中文翻译' : '英文翻译'}: \n`)
    md.appendMarkdown(`\n<a href="https://translate.google.com/?hl=zh-CN&sl=auto&tl=${isEn ? 'zh-CN' : 'en'}&text=${encodeURIComponent(selectedText)}&op=translate">${translated}</a>`)
    md.appendMarkdown(`&nbsp;&nbsp;&nbsp;&nbsp;<a href="command:extension.copyText"><img width="14" src="${copyIco}"/></a>`)
    return new vscode.Hover(md)
  }
}, () => {
  cacheMap.clear()
})

const regex = /[\u4E00-\u9FA5]/
function hasNoChinese(s: string) {
  return !regex.test(s)
}
let claude: any

function aiTransfer(content: string, en: boolean) {
  if (!claude)
    claude = new ClaudeApi('')
  return claude.complete(`Spell check ${content} and Translate ${content} to ${en ? 'Chinese' : 'English'}`, {
    model: '1.3',
  })
}

function request(times: number, content: string) {
  return new Promise((resolve) => {
    let breakFlag = false
    const isEn = hasNoChinese(content)
    for (let i = 0; i < times; i++) {
      if (breakFlag)
        return
      aiTransfer(content, isEn).then((translated: string) => {
        resolve(translated)
        breakFlag = true
      })
    }
  })
}
