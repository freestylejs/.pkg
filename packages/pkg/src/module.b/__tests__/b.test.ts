import { describe, expect, it } from 'vite-plus/test'
import { ModuleB } from '../b'

describe('ModuleB', () => {
    it('should handle absolute path import', () => {
        expect(ModuleB()).toBe(2)
    })
})
