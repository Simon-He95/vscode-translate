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
    provideHover(document, position) {
      if (!secret || !appid)
        return
      const editor = vscode.window.activeTextEditor
      if (!editor)
        return
      if (timer)
        clearTimeout(timer)
      // 移除样式
      vscode.window.activeTextEditor?.setDecorations(decorationType, [])
      const realRangeMap: any = []
      const selection = editor.selection
      let wordRange = new vscode.Range(selection.start, selection.end) as any
      let selectedText = editor.document.getText(wordRange)
      if (!selectedText) {
        wordRange = document.getWordRangeAtPosition(position) as any
        const lineNumber = position.line
        const line = wordRange.c.c
        const lineText = document.lineAt(lineNumber).text
        let word = document.getText(wordRange)
        let matcher = null
        const wholeReg = new RegExp(`["'$@¥%*~()（）;-!.,，。！；“‘～\\s\\w\\u4e00-\\u9fa5]*${word}["'$@¥%*~()（）;-!.,，。！；“‘～\\s\\w\\u4e00-\\u9fa5]*`, 'g')
        for (const match of lineText.matchAll(wholeReg)) {
          const { index } = match
          const pos = index! + match[0].indexOf(word)
          if (pos === wordRange?.c?.e) {
            matcher = match
            realRangeMap.push({
              content: match[0],
              range: new vscode.Range(
                new vscode.Position(line, index!),
                new vscode.Position(line, index! + match[0].length),
              ),
            })
            break
          }
        }
        if (matcher)
          word = matcher[0]
        selectedText = word
      }
      else {
        realRangeMap.push({
          content: selectedText,
          range: wordRange,
        })
      }

      if (!selectedText)
        return
      if (cacheMap.has(selectedText)) {
        const cacheText = cacheMap.get(selectedText)
        if (!cacheText)
          return
        return setStyle(editor, realRangeMap, cacheText)
      }
      const isEn = hasNoChinese(selectedText)
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
            resolve(setStyle(editor, realRangeMap, translated as string))
          })
        }, 200)
      })
    },
  })
  function setStyle(editor: vscode.TextEditor, realRangeMap: any[], translated: string) {
    editor.edit(() => editor.setDecorations(decorationType, realRangeMap.map((item: any) => item.range)))
    md.value = ''
    md.appendMarkdown(translated)
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
