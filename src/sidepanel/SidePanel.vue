<template>
  <div class="side-panel">
    <div v-if="xmindPreviewVisible" class="xmind-modal-mask" @click="closeXmindPreview">
      <div class="xmind-modal" @click.stop>
        <div class="xmind-modal-header">
          <h3>XMind 解析预览</h3>
          <span>{{ xmindPreviewSeconds }}s</span>
        </div>
        <pre class="xmind-modal-content">{{ xmindPreviewText }}</pre>
      </div>
    </div>

    <div class="header">
      <div class="brand">
        <img src="./assets/logo.png" alt="logo" class="logo" />
        <div>
          <h1 class="title">XMind E2E Agent</h1>
          <p class="subtitle">Vision + XMind + 自动化执行</p>
        </div>
      </div>
      <button class="settings-btn" @click="openOptions" title="设置">⚙️</button>
    </div>

    <div v-if="!isConfigured" class="warning-box">
      <p>⚠️ 请先配置模型 API 信息</p>
      <button class="btn small" @click="openOptions">去配置</button>
    </div>

    <div class="main-content">
      <div class="section">
        <h3>1. 上传 XMind 测试用例</h3>
        <div class="file-upload">
          <input
            type="file"
            accept=".xmind"
            @change="handleFileUpload"
            id="fileInput"
            class="hidden-input"
          />
          <label for="fileInput" class="upload-label">
            {{ fileName || '点击选择 XMind 文件' }}
          </label>
        </div>
      </div>

      <div class="section">
        <h3>2. 生成测试脚本</h3>
        <button class="btn primary full-width" :disabled="!canGenerate" @click="startGeneration">
          {{ loading ? '生成中...' : '开始生成 (基于当前页面)' }}
        </button>
        <div class="meta-row">
          <span class="chip">{{ isConfigured ? '模型已配置' : '待配置' }}</span>
          <span class="chip">{{ recordingStateLabel }}</span>
        </div>
      </div>

      <div v-if="conversation.length" class="section">
        <h3>3. 对话流</h3>
        <div class="chat-stream">
          <div
            v-for="item in conversation"
            :key="item.id"
            class="chat-item"
            :class="`chat-${item.role}`"
          >
            <div class="chat-role">{{ item.roleLabel }}</div>
            <pre class="chat-text">{{ item.text }}</pre>
          </div>
        </div>
      </div>

      <div v-if="automationLogs.length" class="section">
        <h3>4. 自动化跳转执行记录</h3>
        <ul class="log-list">
          <li v-for="log in automationLogs" :key="log.id">
            {{ log.text }}
          </li>
        </ul>
      </div>

      <div v-if="recordingUrl" class="section">
        <h3>5. 操作录屏</h3>
        <video class="recording-video" :src="recordingUrl" controls playsinline></video>
        <button class="btn secondary" @click="downloadRecording">下载录屏（webm）</button>
      </div>

      <div v-if="loading" class="status-indicator">
        <div class="spinner"></div>
        <p>{{ statusMessage }}</p>
      </div>

      <div v-if="error" class="error-message">
        {{ error }}
      </div>

      <div v-if="resultCode" class="result-section">
        <h3>6. 生成结果</h3>
        <textarea class="code-area" readonly :value="resultCode"></textarea>
        <div class="result-actions">
          <button class="btn secondary" @click="copyCode">复制代码</button>
          <button class="btn secondary" @click="openHtmlReport">打开 HTML 报告</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { parseXMindFile } from '../utils/xmind'
import { runVisualAnalysisAgent, runCaseSelectorAgent, runCodegenAgent } from '../utils/api'

defineOptions({
  name: 'SidePanel',
})

const isConfigured = ref(false)
const fileName = ref('')
const fileContent = ref(null)
const loading = ref(false)
const statusMessage = ref('')
const error = ref('')
const resultCode = ref('')
const conversation = ref([])
const automationLogs = ref([])
const visualRawOutput = ref('')
const visualParsedOutput = ref(null)
const activeTabSnapshots = ref([])
const recordingUrl = ref('')
const recordingState = ref('idle')
const xmindPreviewVisible = ref(false)
const xmindPreviewText = ref('')
const xmindPreviewSeconds = ref(15)
let xmindPreviewTimer = null
let xmindPreviewInterval = null
let recordingChunks = []
let mediaRecorder = null
let recordingStream = null

const config = ref({
  visualModel: null,
  codeModel: null,
})

onMounted(async () => {
  await checkConfig()
  chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === 'local' && (changes.visualModel || changes.codeModel)) {
      checkConfig()
    }
  })
})

onBeforeUnmount(() => {
  closeXmindPreview()
  if (recordingUrl.value) {
    URL.revokeObjectURL(recordingUrl.value)
  }
  if (recordingStream) {
    recordingStream.getTracks().forEach((track) => track.stop())
  }
})

const checkConfig = async () => {
  const items = await chrome.storage.local.get(['visualModel', 'codeModel'])
  if (items.visualModel && items.visualModel.apiKey && items.codeModel && items.codeModel.apiKey) {
    config.value = items
    isConfigured.value = true
  } else {
    isConfigured.value = false
  }
}

const openOptions = () => {
  if (chrome.runtime.openOptionsPage) {
    chrome.runtime.openOptionsPage()
  } else {
    window.open(chrome.runtime.getURL('src/options/index.html'))
  }
}

const handleFileUpload = async (event) => {
  const file = event.target.files[0]
  if (!file) return

  fileName.value = file.name
  error.value = ''

  try {
    statusMessage.value = '正在解析 XMind 文件...'
    const text = await parseXMindFile(file)
    fileContent.value = text
    statusMessage.value = ''
    openXmindPreview(text)
  } catch (err) {
    error.value = '解析文件失败: ' + err.message
    fileContent.value = null
  }
}

const canGenerate = computed(() => {
  return isConfigured.value && fileContent.value && !loading.value
})

const recordingStateLabel = computed(() => {
  if (recordingState.value === 'recording') return '录屏中'
  if (recordingState.value === 'stopping') return '录屏处理中'
  if (recordingState.value === 'error') return '录屏异常'
  if (recordingState.value === 'ready') return '录屏可回放'
  return '录屏未开启'
})

const createId = () => `${Date.now()}-${Math.random().toString(16).slice(2)}`

const appendConversation = (role, roleLabel) => {
  const id = createId()
  conversation.value.push({ id, role, roleLabel, text: '' })
  return id
}

const appendConversationText = (id, text) => {
  const target = conversation.value.find((item) => item.id === id)
  if (!target) return
  target.text += text
}

const pushAutomationLog = (text) => {
  automationLogs.value.push({ id: createId(), text })
}

const closeXmindPreview = () => {
  xmindPreviewVisible.value = false
  if (xmindPreviewTimer) {
    clearTimeout(xmindPreviewTimer)
    xmindPreviewTimer = null
  }
  if (xmindPreviewInterval) {
    clearInterval(xmindPreviewInterval)
    xmindPreviewInterval = null
  }
}

const openXmindPreview = (text) => {
  closeXmindPreview()
  xmindPreviewText.value = text
  xmindPreviewSeconds.value = 15
  xmindPreviewVisible.value = true
  xmindPreviewInterval = setInterval(() => {
    xmindPreviewSeconds.value = Math.max(0, xmindPreviewSeconds.value - 1)
  }, 1000)
  xmindPreviewTimer = setTimeout(() => {
    closeXmindPreview()
  }, 15000)
}

const isRestrictedCaptureUrl = (url) =>
  /^(chrome|chrome-extension|edge|about|devtools):/i.test(String(url || ''))

const getTabMediaStreamId = (tabId) =>
  new Promise((resolve, reject) => {
    chrome.tabCapture.getMediaStreamId({ targetTabId: tabId }, (streamId) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message))
        return
      }
      if (!streamId) {
        reject(new Error('无法获取标签页流 ID'))
        return
      }
      resolve(streamId)
    })
  })

const captureTabStreamById = async (tabId) => {
  const streamId = await getTabMediaStreamId(tabId)
  return navigator.mediaDevices.getUserMedia({
    audio: false,
    video: {
      mandatory: {
        chromeMediaSource: 'tab',
        chromeMediaSourceId: streamId,
        maxWidth: 1920,
        maxHeight: 1080,
        maxFrameRate: 30,
      },
    },
  })
}

const captureTabStream = () =>
  new Promise((resolve, reject) => {
    chrome.tabCapture.capture(
      {
        audio: false,
        video: true,
        videoConstraints: {
          mandatory: {
            maxWidth: 1920,
            maxHeight: 1080,
            maxFrameRate: 30,
          },
        },
      },
      (stream) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message))
          return
        }
        if (!stream) {
          reject(new Error('无法捕获当前标签页视频流'))
          return
        }
        resolve(stream)
      },
    )
  })

const getSupportedRecordingType = () => {
  const types = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm']
  return types.find((type) => MediaRecorder.isTypeSupported(type)) || ''
}

const startTabRecording = async (tab) => {
  if (recordingState.value === 'recording') return
  if (isRestrictedCaptureUrl(tab?.url)) {
    throw new Error('当前页面受限（如 chrome:// 页面），Chrome 不允许录屏，请切到普通网页后重试')
  }
  recordingState.value = 'starting'
  let stream = null
  try {
    stream = await captureTabStreamById(tab.id)
  } catch {
    stream = await captureTabStream()
  }
  recordingStream = stream
  recordingChunks = []
  const mimeType = getSupportedRecordingType()
  mediaRecorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream)
  mediaRecorder.ondataavailable = (event) => {
    if (event.data && event.data.size > 0) {
      recordingChunks.push(event.data)
    }
  }
  mediaRecorder.start(300)
  recordingState.value = 'recording'
}

const stopTabRecording = async () => {
  if (!mediaRecorder || recordingState.value !== 'recording') return
  recordingState.value = 'stopping'
  const stopped = new Promise((resolve) => {
    mediaRecorder.onstop = () => {
      const blob = new Blob(recordingChunks, { type: 'video/webm' })
      if (recordingUrl.value) {
        URL.revokeObjectURL(recordingUrl.value)
      }
      recordingUrl.value = URL.createObjectURL(blob)
      resolve()
    }
  })
  mediaRecorder.stop()
  await stopped
  if (recordingStream) {
    recordingStream.getTracks().forEach((track) => track.stop())
  }
  recordingStream = null
  mediaRecorder = null
  recordingState.value = 'ready'
}

const splitXmindCases = (text, options = {}) => {
  const size = options.size || 24
  const lines = String(text || '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line)
  if (!lines.length) return []

  const cases = lines.map((line, index) => ({
    id: `case-${index + 1}`,
    title: line.replace(/^-+\s*/, ''),
  }))

  const chunks = []
  for (let i = 0; i < cases.length; i += size) {
    chunks.push(cases.slice(i, i + size))
  }
  return chunks
}

const uniqNavigationTargets = (targets) => {
  const map = new Map()
  for (const target of targets || []) {
    const key = [
      target?.action || '',
      target?.matchText || '',
      target?.target || '',
      target?.urlHint || '',
    ].join('|')
    if (!map.has(key)) map.set(key, target)
  }
  return Array.from(map.values())
}

const dedupeCasesById = (cases) => {
  const map = new Map()
  for (const item of cases || []) {
    const key = String(item?.id || '').trim()
    if (!key) continue
    if (!map.has(key)) map.set(key, item)
  }
  return Array.from(map.values())
}

const mergeVisualParsedChunks = (chunks, analysisText) => {
  const applicableCases = dedupeCasesById(
    chunks.flatMap((item) => (Array.isArray(item.cases) ? item.cases : [])),
  ).map((item) => ({
    id: item.id,
    title: item.title,
    reason: item.reason || '',
    priority: item.priority || 'P1',
  }))
  const navigationTargets = uniqNavigationTargets(
    applicableCases.map((item) => ({
      target: item.title,
      matchText: item.title,
      action: 'click',
      caseId: item.id,
    })),
  ).slice(0, 8)
  return {
    analysis_summary: analysisText || '',
    applicable_cases: applicableCases,
    navigation_targets: navigationTargets,
    code_prompt: JSON.stringify({ cases: applicableCases }, null, 2),
  }
}

const waitForTabComplete = (tabId, timeout = 8000) =>
  new Promise((resolve) => {
    let done = false
    const finish = (value) => {
      if (done) return
      done = true
      chrome.tabs.onUpdated.removeListener(listener)
      clearTimeout(timer)
      resolve(value)
    }
    const listener = (updatedTabId, changeInfo) => {
      if (updatedTabId === tabId && changeInfo.status === 'complete') {
        finish(true)
      }
    }
    const timer = setTimeout(() => finish(false), timeout)
    chrome.tabs.onUpdated.addListener(listener)
  })

const getTabState = async (tabId) => {
  const result = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => ({ title: document.title || '', url: location.href }),
  })
  return result?.[0]?.result || { title: '', url: '' }
}

const clickByKeyword = async (tabId, keyword) => {
  const result = await chrome.scripting.executeScript({
    target: { tabId },
    args: [keyword],
    func: (kw) => {
      const keywordText = (kw || '').trim().toLowerCase()
      if (!keywordText) return { clicked: false, reason: 'empty_keyword' }
      const selectors = ['a[href]', 'button', '[role="button"]', '[onclick]', '[data-testid]']
      const elements = Array.from(document.querySelectorAll(selectors.join(',')))
      let candidate = null
      let maxScore = 0
      for (const el of elements) {
        const text = (el.innerText || el.textContent || '').trim().toLowerCase()
        const href = (el.getAttribute('href') || '').trim().toLowerCase()
        const aria = (el.getAttribute('aria-label') || '').trim().toLowerCase()
        let score = 0
        if (text.includes(keywordText)) score += 3
        if (href.includes(keywordText)) score += 2
        if (aria.includes(keywordText)) score += 2
        if (score > maxScore) {
          maxScore = score
          candidate = el
        }
      }
      if (!candidate) return { clicked: false, reason: 'target_not_found' }
      const tag = candidate.tagName.toLowerCase()
      const href = candidate.getAttribute('href') || ''
      candidate.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
      return { clicked: true, tag, href, text: (candidate.innerText || '').trim() }
    },
  })
  return result?.[0]?.result || { clicked: false, reason: 'script_failed' }
}

const autoNavigate = async (tabId, targets) => {
  const logs = []
  const snapshots = []
  const limitedTargets = targets.slice(0, 6)
  for (const target of limitedTargets) {
    const label = target.matchText || target.target || ''
    const action = target.action || 'click'
    const urlHint = target.urlHint || ''
    try {
      if (action === 'navigate' && urlHint) {
        const tab = await chrome.tabs.get(tabId)
        let nextUrl = urlHint
        if (/^\//.test(urlHint) && tab?.url) {
          nextUrl = new URL(urlHint, tab.url).href
        }
        pushAutomationLog(`跳转到: ${nextUrl}`)
        logs.push(`navigate -> ${nextUrl}`)
        await chrome.tabs.update(tabId, { url: nextUrl })
        await waitForTabComplete(tabId)
      } else {
        pushAutomationLog(`点击目标: ${label || '(未命名目标)'}`)
        const clickResult = await clickByKeyword(tabId, label)
        logs.push(`click -> ${label} -> ${JSON.stringify(clickResult)}`)
        await waitForTabComplete(tabId, 4000)
      }
      const state = await getTabState(tabId)
      snapshots.push(state)
      pushAutomationLog(`当前页面: ${state.title || '无标题'} (${state.url})`)
    } catch (err) {
      const message = `自动操作失败: ${label} -> ${err.message}`
      logs.push(message)
      pushAutomationLog(message)
    }
  }
  return { logs, snapshots }
}

const escapeHtml = (text) =>
  String(text || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')

const buildReportHtml = () => {
  const visual = visualParsedOutput.value || {}
  const summary = visual.analysis_summary || '无'
  const cases = Array.isArray(visual.applicable_cases) ? visual.applicable_cases : []
  const logs = automationLogs.value.map((item) => item.text)
  const snapshots = activeTabSnapshots.value
  const dialogue = conversation.value
    .map((item) => `[${item.roleLabel}]\n${item.text}`)
    .join('\n\n')
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>测试用例报告</title>
  <style>
    body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;background:#f8fafc;color:#111827;padding:24px}
    .card{background:#fff;border:1px solid #e5e7eb;border-radius:10px;padding:16px;margin-bottom:16px}
    h1{font-size:22px;margin:0 0 16px 0}
    h2{font-size:16px;margin:0 0 10px 0}
    pre{white-space:pre-wrap;word-break:break-word;background:#0b1020;color:#e5e7eb;padding:12px;border-radius:8px;font-size:13px}
    ul{margin:0;padding-left:20px}
    li{margin-bottom:8px}
  </style>
</head>
<body>
  <h1>自动化测试用例报告</h1>
  <div class="card">
    <h2>视觉分析总结</h2>
    <pre>${escapeHtml(summary)}</pre>
  </div>
  <div class="card">
    <h2>适配用例说明</h2>
    <ul>
      ${cases.map((item) => `<li><strong>${escapeHtml(item.id || '')} · ${escapeHtml(item.title || '')}</strong><br/>${escapeHtml(item.reason || '')}</li>`).join('')}
    </ul>
  </div>
  <div class="card">
    <h2>自动跳转执行记录</h2>
    <ul>${logs.map((line) => `<li>${escapeHtml(line)}</li>`).join('')}</ul>
  </div>
  <div class="card">
    <h2>访问页面快照</h2>
    <ul>${snapshots.map((s) => `<li>${escapeHtml(s.title || '无标题')}<br/>${escapeHtml(s.url || '')}</li>`).join('')}</ul>
  </div>
  <div class="card">
    <h2>模型对话记录</h2>
    <pre>${escapeHtml(dialogue)}</pre>
  </div>
  <div class="card">
    <h2>最终测试用例与脚本</h2>
    <pre>${escapeHtml(resultCode.value)}</pre>
  </div>
</body>
</html>`
}

const openHtmlReport = async () => {
  const html = buildReportHtml()
  const url = `data:text/html;charset=utf-8,${encodeURIComponent(html)}`
  await chrome.tabs.create({ url })
}

const downloadRecording = () => {
  if (!recordingUrl.value) return
  const a = document.createElement('a')
  a.href = recordingUrl.value
  a.download = `e2e-auto-record-${Date.now()}.webm`
  a.click()
}

const startGeneration = async () => {
  if (!canGenerate.value) return

  loading.value = true
  error.value = ''
  resultCode.value = ''
  conversation.value = []
  automationLogs.value = []
  visualRawOutput.value = ''
  visualParsedOutput.value = null
  activeTabSnapshots.value = []
  recordingState.value = 'idle'
  if (recordingUrl.value) {
    URL.revokeObjectURL(recordingUrl.value)
    recordingUrl.value = ''
  }

  try {
    statusMessage.value = '正在截取当前页面...'
    const currentWindow = await chrome.windows.getCurrent()
    const activeTabs = await chrome.tabs.query({ active: true, currentWindow: true })
    const currentTab = activeTabs[0]
    if (!currentTab?.id) {
      throw new Error('无法获取当前标签页')
    }
    const screenshotUrl = await chrome.tabs.captureVisibleTab(currentWindow.id, { format: 'png' })
    const xmindChunks = splitXmindCases(fileContent.value)
    if (!xmindChunks.length) {
      throw new Error('XMind 解析结果为空，无法生成')
    }
    pushAutomationLog(`XMind 用例已分片，共 ${xmindChunks.length} 片，按顺序进行 case 筛选`)

    statusMessage.value = 'visual_analysis_agent 正在分析页面...'
    const visualMessageId = appendConversation('visual', 'visual_analysis_agent')
    const pageAnalysisText = await runVisualAnalysisAgent(
      config.value.visualModel,
      screenshotUrl,
      '',
      {
        onDelta: (delta) => appendConversationText(visualMessageId, delta),
      },
    )
    visualRawOutput.value = pageAnalysisText

    const selectedChunkResults = []
    for (let i = 0; i < xmindChunks.length; i += 1) {
      statusMessage.value = `case_selector_agent 处理中（分片 ${i + 1}/${xmindChunks.length}）...`
      const selectorMessageId = appendConversation(
        'visual',
        `case_selector_agent（分片 ${i + 1}/${xmindChunks.length}）`,
      )
      const selected = await runCaseSelectorAgent(
        config.value.visualModel,
        {
          pageAnalysisText,
          casesChunk: xmindChunks[i],
        },
        {
          onDelta: (delta) => appendConversationText(selectorMessageId, delta),
        },
      )
      selectedChunkResults.push(selected)
    }

    const visualParsed = mergeVisualParsedChunks(selectedChunkResults, pageAnalysisText)
    visualParsedOutput.value = visualParsed

    statusMessage.value = '正在开启录屏...'
    try {
      await startTabRecording(currentTab)
      pushAutomationLog('录屏已开启，将记录自动点击过程')
    } catch (recordingErr) {
      recordingState.value = 'error'
      pushAutomationLog(`录屏开启失败: ${recordingErr.message}`)
    }

    statusMessage.value = '正在根据案例自动执行页面跳转/点击...'
    const navigationResult = await autoNavigate(
      currentTab.id,
      visualParsed.navigation_targets || [],
    )
    activeTabSnapshots.value = navigationResult.snapshots
    if (recordingState.value === 'recording') {
      await stopTabRecording()
      pushAutomationLog('录屏已结束，可在下方预览或下载')
    }

    statusMessage.value = 'codegen_agent 生成 Playwright 脚本中...'
    const sharedContext = `自动执行日志:
${navigationResult.logs.join('\n')}

访问页面快照:
${navigationResult.snapshots.map((s, i) => `${i + 1}. ${s.title} - ${s.url}`).join('\n')}

请输出：
1) 可读的测试用例清单（每条包含：目标、前置条件、步骤、断言、说明）
2) 对应 Playwright 测试脚本（优先 Playwright）
3) 如有必要给出 Cypress 备选片段`

    const codeMessageId = appendConversation('code', 'codegen_agent')
    resultCode.value = await runCodegenAgent(
      config.value.codeModel,
      {
        pageAnalysisText,
        selectedCases: visualParsed.applicable_cases,
        extraContext: sharedContext,
      },
      {
        onDelta: (delta) => appendConversationText(codeMessageId, delta),
      },
    )
    statusMessage.value = '生成完成！'
    await openHtmlReport()
  } catch (err) {
    console.error(err)
    if (String(err?.message || '').includes('429')) {
      error.value = `生成失败: ${err.message}\n当前已启用分片请求，建议进一步降低分片大小或稍后重试。`
    } else {
      error.value = '生成失败: ' + err.message
    }
  } finally {
    if (recordingState.value === 'recording') {
      try {
        await stopTabRecording()
      } catch {
        recordingState.value = 'error'
      }
    }
    loading.value = false
  }
}

const copyCode = () => {
  navigator.clipboard
    .writeText(resultCode.value)
    .then(() => alert('已复制到剪贴板'))
    .catch((err) => alert('复制失败: ' + err))
}
</script>

<style scoped>
.side-panel {
  padding: 18px;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
  color: #0f172a;
  min-height: 100vh;
  background:
    radial-gradient(circle at 10% 0%, #dbeafe 0%, transparent 26%),
    radial-gradient(circle at 95% 0%, #ede9fe 0%, transparent 28%), #f8fafc;
}

.xmind-modal-mask {
  position: fixed;
  inset: 0;
  z-index: 999;
  background: rgba(15, 23, 42, 0.38);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 18px;
}

.xmind-modal {
  width: min(680px, 100%);
  max-height: 70vh;
  background: #fff;
  border: 1px solid #e2e8f0;
  border-radius: 14px;
  box-shadow: 0 24px 60px rgba(15, 23, 42, 0.22);
  overflow: hidden;
}

.xmind-modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;
  border-bottom: 1px solid #e2e8f0;
  background: #f8fafc;
}

.xmind-modal-header h3 {
  margin: 0;
  font-size: 14px;
  font-weight: 700;
  color: #334155;
}

.xmind-modal-header span {
  font-size: 12px;
  color: #64748b;
}

.xmind-modal-content {
  margin: 0;
  padding: 12px 14px;
  max-height: calc(70vh - 44px);
  overflow: auto;
  white-space: pre-wrap;
  word-break: break-word;
  color: #1e293b;
  font-size: 12px;
  line-height: 1.55;
  background: #fff;
}

.main-content {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 14px;
  padding: 14px 16px;
  border: 1px solid #e2e8f0;
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.8);
  backdrop-filter: blur(6px);
}

.brand {
  display: flex;
  align-items: center;
  gap: 10px;
}

.logo {
  width: 36px;
  height: 36px;
  border-radius: 10px;
  box-shadow: 0 8px 20px rgba(37, 99, 235, 0.22);
}

.title {
  font-size: 16px;
  font-weight: 700;
  margin: 0;
  line-height: 1.2;
}

.subtitle {
  margin: 2px 0 0 0;
  font-size: 12px;
  color: #64748b;
}

.settings-btn {
  border: 1px solid #cbd5e1;
  background: #fff;
  font-size: 18px;
  cursor: pointer;
  width: 34px;
  height: 34px;
  border-radius: 10px;
  transition: all 0.2s;
}

.settings-btn:hover {
  background: #f1f5f9;
  border-color: #94a3b8;
}

.warning-box {
  background: linear-gradient(90deg, #fffbeb 0%, #fef3c7 100%);
  border: 1px solid #f59e0b;
  color: #92400e;
  padding: 12px 14px;
  border-radius: 12px;
  margin-bottom: 14px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
}

.warning-box p {
  margin: 0;
  font-size: 14px;
}

.section {
  background: rgba(255, 255, 255, 0.9);
  padding: 14px;
  border-radius: 14px;
  border: 1px solid #e2e8f0;
  box-shadow: 0 8px 24px rgba(15, 23, 42, 0.06);
}

.section h3 {
  font-size: 14px;
  font-weight: 700;
  margin: 0 0 12px 0;
  color: #334155;
}

.file-upload {
  position: relative;
}

.hidden-input {
  display: none;
}

.upload-label {
  display: block;
  padding: 13px;
  border: 1.5px dashed #94a3b8;
  border-radius: 12px;
  text-align: center;
  cursor: pointer;
  color: #475569;
  font-size: 14px;
  transition: all 0.2s;
  word-break: break-all;
  background: #f8fafc;
}

.upload-label:hover {
  border-color: #2563eb;
  color: #1d4ed8;
  background: #eff6ff;
}

.btn {
  border: 1px solid transparent;
  border-radius: 10px;
  padding: 8px 14px;
  font-size: 14px;
  cursor: pointer;
  font-weight: 600;
  transition: all 0.2s;
}

.btn.primary {
  background: linear-gradient(180deg, #2563eb 0%, #1d4ed8 100%);
  color: white;
  box-shadow: 0 8px 20px rgba(37, 99, 235, 0.3);
}

.btn.primary:hover {
  transform: translateY(-1px);
  box-shadow: 0 10px 24px rgba(37, 99, 235, 0.4);
}

.btn.primary:disabled {
  background: #93c5fd;
  cursor: not-allowed;
  box-shadow: none;
  transform: none;
}

.btn.secondary {
  background: #fff;
  color: #334155;
  border-color: #cbd5e1;
}

.btn.secondary:hover {
  background: #f8fafc;
  border-color: #94a3b8;
}

.btn.small {
  padding: 4px 12px;
  font-size: 12px;
  background: #fcd34d;
  color: #78350f;
}

.btn.full-width {
  width: 100%;
}

.meta-row {
  margin-top: 10px;
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.chip {
  display: inline-flex;
  align-items: center;
  padding: 4px 10px;
  border-radius: 999px;
  border: 1px solid #cbd5e1;
  font-size: 12px;
  color: #334155;
  background: #f8fafc;
}

.status-indicator {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 18px;
  gap: 8px;
  color: #475569;
  font-size: 14px;
  background: rgba(255, 255, 255, 0.78);
  border: 1px solid #e2e8f0;
  border-radius: 14px;
}

.spinner {
  width: 24px;
  height: 24px;
  border: 3px solid #dbeafe;
  border-top-color: #2563eb;
  border-radius: 50%;
  animation: spin 1s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.error-message {
  color: #b91c1c;
  background: #fef2f2;
  border: 1px solid #fca5a5;
  padding: 12px;
  border-radius: 12px;
  font-size: 14px;
}

.result-section {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.result-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.code-area {
  width: 100%;
  height: 300px;
  padding: 12px;
  border: 1px solid #cbd5e1;
  border-radius: 12px;
  background: #f8fafc;
  font-family: 'Courier New', Courier, monospace;
  font-size: 13px;
  resize: vertical;
  box-sizing: border-box;
}

.chat-stream {
  max-height: 260px;
  overflow: auto;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.chat-item {
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  padding: 10px;
  background: #fff;
}

.chat-role {
  font-size: 12px;
  color: #475569;
  margin-bottom: 6px;
  font-weight: 600;
}

.chat-text {
  margin: 0;
  font-size: 12px;
  white-space: pre-wrap;
  word-break: break-word;
  font-family:
    ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New',
    monospace;
}

.chat-visual {
  border-color: #93c5fd;
  background: #eff6ff;
}

.chat-code {
  border-color: #a5b4fc;
  background: #eef2ff;
}

.log-list {
  margin: 0;
  padding-left: 18px;
  color: #334155;
  font-size: 13px;
  line-height: 1.5;
}

.recording-video {
  width: 100%;
  border-radius: 12px;
  border: 1px solid #cbd5e1;
  background: #0f172a;
  margin-bottom: 10px;
}
</style>
