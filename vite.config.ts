import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite-plus'

export default defineConfig({
    resolve: {
        alias: {
            '~': fileURLToPath(new URL('./packages/pkg/src', import.meta.url)),
        },
    },
    test: {
        root: 'packages',
        coverage: {
            provider: 'v8',
            reporter: ['html', 'text'],
        },
    },
})
