import { describe, expect, it } from 'vitest'
import { ModuleA, ModuleB, PKG } from '../index'

describe('package entrypoint', () => {
    it('exports the public API', () => {
        expect(ModuleA()).toBe(1)
        expect(ModuleB()).toBe(2)
        expect(PKG).toBe(1)
    })
})
