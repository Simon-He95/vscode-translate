import * as vscode from 'vscode'
import translate from '@simon_he/translate'
import { cacheMap } from './utils'

export function activate() {
  const { GenerateNames_Secret, GenerateNames_Appid } = process.env
  const { _secret, _appid, dark = {}, light = {} } = vscode.workspace.getConfiguration('translate') || {}
  const secret = GenerateNames_Secret || _secret
  const appid = GenerateNames_Appid || _appid
  let timer: any = null
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
  const decorationType = vscode.window.createTextEditorDecorationType(style)
  vscode.languages.registerHoverProvider('*', {
    provideHover() {
      if (!secret || !appid)
        return
      const editor = vscode.window.activeTextEditor
      if (!editor)
        return
      if (timer)
        clearTimeout(timer)
      // 移除样式
      vscode.window.activeTextEditor?.setDecorations(decorationType, [])
      const selection = editor.selection
      const wordRange = new vscode.Range(selection.start, selection.end) as any
      const selectedText = editor.document.getText(wordRange)
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
        timer = setTimeout(() => {
          translate(selectedText, {
            secret,
            appid,
            from: isEn ? 'en' : 'zh',
            to: isEn ? 'zh' : 'en',
            salt: '1435660288',
          }).then((translated) => {
            cacheMap.set(selectedText, translated)
            resolve(setStyle(isEn, editor, realRangeMap, selectedText, translated as string))
          })
        }, 200)
      })
    },
  })
  function setStyle(isEn: boolean, editor: vscode.TextEditor, realRangeMap: any[], selectedText: string, translated: string) {
    editor.edit(() => editor.setDecorations(decorationType, realRangeMap.map((item: any) => item.range)))
    md.value = ''
    md.appendMarkdown(`${isEn ? '中文翻译' : '英文翻译'}:\n`)
    md.appendMarkdown(`\n<a href="https://translate.google.com/?hl=zh-CN&sl=auto&tl=${isEn ? 'zh-CN' : 'en'}&text=${encodeURIComponent(selectedText)}&op=translate">${translated}</a>`)
    return new vscode.Hover(md)
  }

  vscode.window.onDidChangeTextEditorSelection(() => vscode.window.activeTextEditor?.setDecorations(decorationType, []))
}

export function deactivate() {
  cacheMap.clear()
}

const regex = /[\u4E00-\u9FA5]/
function hasNoChinese(s: string) {
  return !regex.test(s)
}
