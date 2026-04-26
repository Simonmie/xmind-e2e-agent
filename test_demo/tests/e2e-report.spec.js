const { test, expect } = require('@playwright/test')
const { resolve } = require('node:path')
const { pathToFileURL } = require('node:url')

const demoRootUrl = pathToFileURL(resolve(__dirname, '..') + '/').href
const demoUrl = (file) => new URL(file, demoRootUrl).href

test.describe('汪集市 test_demo E2E', () => {
  test('case-24 首页元素展示完整性', async ({ page }) => {
    await page.goto(demoUrl('index.html'))
    await expect(page.getByText('汪集市')).toBeVisible()
    await expect(page.locator('#search-input')).toBeVisible()
    await expect(page.getByText('最近更新')).toBeVisible()
    await expect(page.getByRole('link', { name: '首页' })).toBeVisible()
    await expect(page.getByRole('link', { name: '消息' })).toBeVisible()
    await expect(page.getByRole('link', { name: '我的' })).toBeVisible()
  })

  test('case-28 + case-31 首页默认加载与触底加载', async ({ page }) => {
    await page.goto(demoUrl('index.html'))
    await page.waitForTimeout(1000)
    await expect(page.locator('#product-list > div')).toHaveCount(10)
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
    await page.waitForTimeout(1200)
    await expect(page.locator('#product-list > div')).toHaveCount(20)
  })

  test('case-38 + case-41 + case-44 搜索建议展示/隐藏/点击回填', async ({ page }) => {
    await page.goto(demoUrl('index.html'))
    const input = page.locator('#search-input')
    const suggestions = page.locator('#search-suggestions')
    await input.click()
    await expect(suggestions).toBeVisible()
    await page.locator('.suggestion-item').first().click()
    await expect(input).not.toHaveValue('')
    await expect(page.locator('#global-toast')).toContainText('正在搜索')
    await page.locator('main').click()
    await page.waitForTimeout(260)
    await expect(suggestions).toBeHidden()
  })

  test('case-57 点击商品进入详情页并展示参数', async ({ page }) => {
    await page.goto(demoUrl('index.html'))
    await page.waitForTimeout(1000)
    await page.locator('#product-list > div').first().click()
    await expect(page).toHaveURL(/detail\.html/)
    await expect(page.locator('#product-title')).not.toContainText('商品加载中')
    await expect(page.locator('#product-price')).not.toContainText('0.00')
  })

  test('case-60 底部导航从首页进入消息与我的', async ({ page }) => {
    await page.goto(demoUrl('index.html'))
    await page.getByRole('link', { name: '消息' }).click()
    await expect(page).toHaveURL(/chat\.html/)
    await page.getByRole('link', { name: '我的' }).click()
    await expect(page).toHaveURL(/profile\.html/)
  })

  test('case-101 消息列表点击进入聊天详情', async ({ page }) => {
    await page.goto(demoUrl('chat.html'))
    await page.locator('main > div').first().click()
    await expect(page).toHaveURL(/chat-detail\.html/)
    await expect(page.locator('#chat-title')).not.toHaveText('')
  })

  test('case-119 + case-121 聊天输入触发发送按钮并发送消息', async ({ page }) => {
    await page.goto(demoUrl('chat-detail.html?name=爱宠人士小王'))
    const input = page.locator('#message-input')
    const sendBtn = page.locator('#send-btn')
    await expect(sendBtn).toHaveClass(/hidden/)
    await input.fill('这是一条自动化测试消息')
    await expect(sendBtn).not.toHaveClass(/hidden/)
    await sendBtn.click()
    await expect(page.getByText('这是一条自动化测试消息')).toBeVisible()
    await expect(sendBtn).toHaveClass(/hidden/)
  })

  test('case-151 + case-153 我的交易入口跳转订单页', async ({ page }) => {
    await page.goto(demoUrl('profile.html'))
    await page.getByText('我发布的').click()
    await expect(page).toHaveURL(/order-list\.html\?type=published/)
    await expect(page.locator('#page-title')).toHaveText('我发布的')
  })

  test('case-172 + case-174 订单 tab 切换标题与内容同步', async ({ page }) => {
    await page.goto(demoUrl('order-list.html?type=published'))
    await page.waitForTimeout(500)
    await page.locator('.tab-item[data-type="bought"]').click()
    await expect(page.locator('#page-title')).toHaveText('我买到的')
    await expect(page.locator('#list-container > div')).toHaveCount(2)
  })

  test('case-185 点击订单更多按钮不应跳详情页', async ({ page }) => {
    await page.goto(demoUrl('order-list.html?type=published'))
    await page.waitForTimeout(500)
    const moreBtn = page.getByRole('button', { name: '更多' }).first()
    await moreBtn.click()
    await expect(page).toHaveURL(/order-list\.html/)
    await expect(page.locator('#global-toast')).toContainText('更多操作开发中')
  })
})
