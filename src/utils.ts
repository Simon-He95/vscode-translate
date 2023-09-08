import fsp from 'node:fs/promises'
import data from './data.json'

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
    const data = [...this.cache].reduce((result, key: any) => {
      result[key] = (this.cache as any)[key]
      return result
    }, {} as Record<string, string>)
    fsp.writeFile('./data.json', JSON.stringify(data))
    this.cache.clear()
  }
}

export const cacheMap = new Cache()
