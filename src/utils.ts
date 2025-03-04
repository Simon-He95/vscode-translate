const data = {}

export class Cache {
  private cache
  constructor() {
    this.cache = new Map()
    Object.keys(data).forEach((key) => {
      const val = (data as any)[key]
      this.cache.set(key, val)
    })
  }

  get(key: any) {
    return this.cache.get(key)
  }

  set(key: any, value: any) {
    this.cache.set(key, value)
  }

  has(key: any) {
    return this.cache.has(key)
  }

  clear() {
    // 同步更新写入data.json
    this.cache.clear()
  }
}

export const cacheMap = new Cache()

export function splitWords(lineText: string, character: number) {
  let word = ''
  let start = character
  let end = character + 1
  while (!/[\s'"{}<>[\]()$!`]/.test(lineText[start]) && start >= 0) {
    word = lineText[start] + word
    start--
  }
  while (!/[\s'"{}<>[\]()$!`]/.test(lineText[end]) && end < lineText.length) {
    word += lineText[end]
    end++
  }
  return word
}

const regex = /[\u4E00-\u9FA5]/
export function hasNoChinese(s: string) {
  return !regex.test(s)
}

export function fixedVariableName(result: string, isLarge?: boolean) {
  result = result.replace(/the/gi, '').trim()
  if (result.includes('and')) {
    result = result.split('and')[0]
  }
  // 如果存在 of 则颠倒
  if (result.includes(' of ')) {
    const [A, B] = result.split(' of ')
    result = `${B} ${A}`
  }
  return isLarge ? toLargeVariableName(result.replace(/\([^)]+\)/g, '').trim()) : toVariableName(result.replace(/\([^)]+\)/g, '').trim())
}

function toVariableName(name: string) {
  return name[0].toLowerCase() + name.slice(1).replace(/\s+(\w)/g, (_, v) => v.toUpperCase())
}

function toLargeVariableName(name: string) {
  return name[0].toUpperCase() + name.slice(1).replace(/\s+(\w)/g, (_, v) => v.toUpperCase())
}

/**
 * Escapes special Markdown characters in a string and handles HTML tags
 */
export function escapeMarkdown(text: string): string {
  if (!text)
    return ''

  // First check if there are HTML-like tags
  if (text.includes('<') && text.includes('>')) {
    // For HTML content, use code formatting with backticks
    return `\`${text.replace(/`/g, '\\`')}\``
  }

  // Otherwise escape Markdown special characters
  return text.replace(/([\\`*_{}[\]()#+\-.!|])/g, '\\$1')
}
