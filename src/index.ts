import type * as vscode from 'vscode'
import translateLoader from '@simon_he/translate'
import { addEventListener, createExtension, createHover, createMarkdownString, createRange, createStyle, getActiveTextEditor, getConfiguration, getKeyWords, getLineText, getSelection, message, registerCommand, registerHoverProvider, setCommandParams, setCopyText, updateText } from '@vscode-use/utils'
import { cacheMap, escapeMarkdown, fixedVariableName, hasNoChinese, splitWords } from './utils'

export = createExtension((_) => {
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
          translate(textes).then((translated) => {
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
    addEventListener('selection-change', (e) => {
      if (e.textEditor.document.fileName === 'exthost')
        return
      e.textEditor.setDecorations(decorationType, [])
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
}, () => {
  cacheMap.clear()
})
