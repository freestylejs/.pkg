import { defineConfig } from 'oxlint'
import { oxlintConfig } from '@freestylejs/config/oxlint'

export default defineConfig({
    ...oxlintConfig,
    overrides: [
        ...(oxlintConfig.overrides ?? []),
        {
            files: ['packages/migrate/src/**/*.ts'],
            rules: {
                'no-console': 'off',
            },
        },
    ],
})
