import * as vscode from 'vscode'
import translateLoader from '@simon_he/translate'
import { addEventListener, createExtension, createMarkdownString, createStyle, getActiveTextEditor, getConfiguration, getKeyWords, getLineText, getSelection, registerHoverProvider } from '@vscode-use/utils'
import { cacheMap, hasNoChinese, splitWords } from './utils'

export = createExtension((_) => {
  // const copyedText = ''
  const translate = translateLoader()
  const { dark = {}, light = {} } = getConfiguration('translate') || {}
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
    registerHoverProvider('*',
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
        if (!isUseSelect && getKeyWords(position)?.includes(' '))
          return
        const selectedText = isUseSelect ? selectedTextArray[0] : splitWords(getLineText(position.line)!, position.character)

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
          return setStyle(isEn, editor, realRangeMap, cacheText.textes, cacheText.translated)
        }

        return new Promise((resolve) => {
          timer = setTimeout(async () => {
            const _selectedText = selectedText.replace(/\?\./g, '.')
            const textes = isUseSelect
              ? [_selectedText]
              : Array.from(new Set([_selectedText, ..._selectedText.split('/').filter(item => /[a-zA-Z]/.test(item) && !/[.:]/.test(item)), ..._selectedText.split(/[-_\/\.:]/g).filter(item => /[a-zA-Z]/.test(item) && !/[-_\/\.:]/.test(item))])).filter(item => item && !/[\.?:]$/.test(item))
            translate(textes).then((translated) => {
              cacheMap.set(selectedText, { textes, translated })
              resolve(setStyle(isEn, editor, realRangeMap, textes, translated))
            }).catch(() => {
              console.error('api 请求太频繁')
            })
          }, 200)
        })
      }),
    // registerCommand('extension.copyText', () => {
    //   vscode.env.clipboard.writeText(copyedText)
    //   vscode.window.showInformationMessage('复制成功')
    // }),
    addEventListener('selection-change', () => getActiveTextEditor()?.setDecorations(decorationType, [])),
  ]
  function setStyle(isEn: boolean | undefined, editor: vscode.TextEditor, realRangeMap: any[], textes: string[], translated: string[]) {
    editor.edit(() => editor.setDecorations(decorationType, realRangeMap.map((item: any) => item.range)))
    md.value = ''
    // copyedText = translated
    if (isEn !== undefined)
      md.appendMarkdown(`### vscode-translate(${isEn ? '中文翻译' : '英文翻译'}): \n`)
    for (let i = 0; i < textes.length; i++) {
      const originText = textes[i]
      const translatedText = translated[i]
      md.appendMarkdown(`- ${originText}: ${translatedText}\n\n`)
    }
    // md.appendMarkdown(`\n<a href="https://translate.google.com/?hl=zh-CN&sl=auto&tl=${isEn ? 'zh-CN' : 'en'}&text=${encodeURIComponent(selectedText)}&op=translate">${translated}</a>`)
    // md.appendMarkdown(`&nbsp;&nbsp;&nbsp;&nbsp;<a href="command:extension.copyText"><img width="14" src="${copyIco}"/></a>`)
    return new vscode.Hover(md)
  }
}, () => {
  cacheMap.clear()
})
