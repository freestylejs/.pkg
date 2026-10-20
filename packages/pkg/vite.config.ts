import { defineConfig } from 'vite-plus'

export default defineConfig({
    pack: {
        entry: ['src/index.ts'],
        format: ['esm', 'cjs'],
        dts: {
            generator: 'tsgo',
        },
        fixedExtension: false,
        sourcemap: false,
        target: 'esnext',
        clean: false,
        outDir: 'dist',
    },
})
