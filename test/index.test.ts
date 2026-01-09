import { describe, expect, it } from 'vitest'

import { shellSplit } from '../src/local-server'

describe('should', () => {
  it('exported', () => {
    expect(1).toEqual(1)
  })

  it('shellSplit', () => {
    expect(shellSplit('python3 -u local_server/app.py --port 0')).toEqual([
      'python3',
      '-u',
      'local_server/app.py',
      '--port',
      '0',
    ])

    expect(shellSplit('cmd "a b" c')).toEqual(['cmd', 'a b', 'c'])
  })
})
