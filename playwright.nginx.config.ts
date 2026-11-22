import { join } from 'node:path'

import { defineConfig, devices } from '@playwright/test'

import { basePath, baseURL, env, port, publicURL } from './e2e/env'

/*
 * Tests of the README nginx example in front of the app built with BASE_PATH=/photos (e2e/nginx.spec.ts). Run with
 * `npm run test:e2e:nginx`, which sets the base path and the nginx origin; nginx runs as the current user.
 */

if (basePath === '')
    throw new Error('Run with npm run test:e2e:nginx, which sets E2E_BASE_PATH and E2E_PUBLIC_URL')

const ci = !!process.env.CI
const nginx = process.env.NGINX ?? '/usr/sbin/nginx'
const nginxDir = join(__dirname, 'e2e', '.nginx')
const nginxArgs = `-p ${nginxDir} -e ${join(nginxDir, 'logs', 'error.log')} -c ${join(nginxDir, 'nginx.conf')}`

export default defineConfig({
    testDir: './e2e',
    testMatch: 'nginx.spec.ts',
    globalSetup: './e2e/global-setup.ts',
    fullyParallel: true,
    forbidOnly: ci,
    retries: ci ? 1 : 0,
    workers: ci ? 2 : undefined,
    outputDir: 'test-results-nginx',
    reporter: ci
        ? [['github'], ['html', { open: 'never', outputFolder: 'playwright-report-nginx' }]]
        : [['list'], ['html', { open: 'never', outputFolder: 'playwright-report-nginx' }]],
    use: {
        baseURL: publicURL,
        locale: 'ru-RU',
        trace: 'retain-on-failure'
    },
    projects: [
        {
            name: 'nginx',
            use: { ...devices['Desktop Chrome'] }
        }
    ],
    webServer: [
        {
            command: `npm run build && npm start -- --port ${port}`,
            url: `${baseURL}${basePath}/api/auth/ok`,
            env,
            reuseExistingServer: false,
            timeout: 300_000,
            stderr: 'pipe'
        },
        {
            // Ready once it proxies to the app
            command: `node e2e/nginx/config.mts && ${nginx} ${nginxArgs} -t -q && exec ${nginx} ${nginxArgs} -g 'daemon off;'`,
            url: `${publicURL}${basePath}/api/auth/ok`,
            env: { E2E_PORT: String(port), E2E_PUBLIC_URL: publicURL },
            reuseExistingServer: false,
            timeout: 300_000,
            stderr: 'pipe'
        }
    ]
})
