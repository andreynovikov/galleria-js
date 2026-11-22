import { defineConfig, devices } from '@playwright/test'

import { baseURL, env, port } from './e2e/env'

const ci = !!process.env.CI

export default defineConfig({
    testDir: './e2e',
    globalSetup: './e2e/global-setup.ts',
    fullyParallel: true,
    forbidOnly: ci,
    retries: ci ? 1 : 0,
    workers: ci ? 2 : undefined,
    reporter: ci ? [['github'], ['html', { open: 'never' }]] : [['list'], ['html', { open: 'never' }]],
    use: {
        baseURL,
        locale: 'ru-RU',
        trace: 'retain-on-failure',
        screenshot: 'only-on-failure'
    },
    projects: [
        {
            name: 'desktop',
            use: { ...devices['Desktop Chrome'] },
            // Runs behind nginx, with playwright.nginx.config.ts
            testIgnore: /nginx\.spec\.ts/
        },
        {
            name: 'mobile',
            use: { ...devices['Pixel 7'] },
            // Plain HTTP checks do not depend on the browser
            testIgnore: /(api|log|nginx)\.spec\.ts/
        }
    ],
    webServer: {
        // Production build: closer to what runs in Docker, and the dev server compiles pages too slowly for tests
        command: `npm run build && npm start -- --port ${port}`,
        url: `${baseURL}/api/auth/ok`,
        env,
        reuseExistingServer: false,
        timeout: 300_000,
        stderr: 'pipe'
    }
})
