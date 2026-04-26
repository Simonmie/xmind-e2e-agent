const { defineConfig } = require('@playwright/test')

module.exports = defineConfig({
  testDir: './tests',
  timeout: 30000,
  expect: {
    timeout: 5000,
  },
  retries: 0,
  use: {
    headless: true,
    viewport: { width: 390, height: 844 },
    ignoreHTTPSErrors: true,
  },
})
