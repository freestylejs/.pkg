import { defineConfig } from 'vite-plus'

export default defineConfig({
    pack: {
        entry: ['src/cli.ts'],
        format: ['esm'],
        dts: false,
        fixedExtension: false,
        sourcemap: false,
        target: 'node22',
        platform: 'node',
        clean: true,
        outDir: 'dist',
    },
})
