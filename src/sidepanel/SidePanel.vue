<template>
  <div class="side-panel">
    <div class="header">
      <img src="./assets/logo.png" alt="logo" class="logo" />
      <h1 class="title">XMind E2E Agent</h1>
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
          <input type="file" accept=".xmind" @change="handleFileUpload" id="fileInput" class="hidden-input" />
          <label for="fileInput" class="upload-label">
            {{ fileName || '点击选择 XMind 文件' }}
          </label>
        </div>
      </div>

      <div class="section">
        <h3>2. 生成测试脚本</h3>
        <button 
          class="btn primary full-width" 
          :disabled="!canGenerate" 
          @click="startGeneration"
        >
          {{ loading ? '生成中...' : '开始生成 (基于当前页面)' }}
        </button>
      </div>

      <div v-if="loading" class="status-indicator">
        <div class="spinner"></div>
        <p>{{ statusMessage }}</p>
      </div>

      <div v-if="error" class="error-message">
        {{ error }}
      </div>

      <div v-if="resultCode" class="result-section">
        <h3>生成结果</h3>
        <textarea class="code-area" readonly :value="resultCode"></textarea>
        <button class="btn secondary" @click="copyCode">复制代码</button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { parseXMindFile } from '../utils/xmind'
import { callVisualModel, callCodeModel } from '../utils/api'

defineOptions({
  name: 'SidePanel',
})

const isConfigured = ref(false)
const fileName = ref('')
const fileContent = ref(null) // Parsed text content
const loading = ref(false)
const statusMessage = ref('')
const error = ref('')
const resultCode = ref('')

const config = ref({
  visualModel: null,
  codeModel: null
})

onMounted(async () => {
  await checkConfig()
  // Listen for storage changes to update config status
  chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === 'local' && (changes.visualModel || changes.codeModel)) {
      checkConfig()
    }
  })
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
  } catch (err) {
    error.value = '解析文件失败: ' + err.message
    fileContent.value = null
  }
}

const canGenerate = computed(() => {
  return isConfigured.value && fileContent.value && !loading.value
})

const startGeneration = async () => {
  if (!canGenerate.value) return
  
  loading.value = true
  error.value = ''
  resultCode.value = ''
  
  try {
    // 1. Capture Screenshot
    statusMessage.value = '正在截取当前页面...'
    const window = await chrome.windows.getCurrent()
    const screenshotUrl = await chrome.tabs.captureVisibleTab(window.id, { format: 'png' })
    
    // 2. Call Visual Model
    statusMessage.value = '视觉模型正在分析页面结构与测试用例...'
    const visualPrompt = await callVisualModel(
      config.value.visualModel,
      screenshotUrl,
      fileContent.value
    )
    
    // 3. Call Code Model
    statusMessage.value = '代码模型正在生成测试脚本...'
    const code = await callCodeModel(
      config.value.codeModel,
      visualPrompt
    )
    
    resultCode.value = code
    statusMessage.value = '生成完成！'
    
  } catch (err) {
    console.error(err)
    error.value = '生成失败: ' + err.message
  } finally {
    loading.value = false
  }
}

const copyCode = () => {
  navigator.clipboard.writeText(resultCode.value)
    .then(() => alert('已复制到剪贴板'))
    .catch(err => alert('复制失败: ' + err))
}
</script>

<style scoped>
.side-panel {
  padding: 16px;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
  color: #333;
  min-height: 100vh;
  background: #f9fafb;
}

.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 20px;
  padding-bottom: 10px;
  border-bottom: 1px solid #e5e7eb;
}

.logo {
  width: 32px;
  height: 32px;
}

.title {
  font-size: 18px;
  font-weight: 700;
  margin: 0;
  flex-grow: 1;
  margin-left: 10px;
}

.settings-btn {
  background: none;
  border: none;
  font-size: 20px;
  cursor: pointer;
  padding: 4px;
  border-radius: 4px;
}

.settings-btn:hover {
  background: #e5e7eb;
}

.warning-box {
  background: #fffbeb;
  border: 1px solid #fcd34d;
  color: #92400e;
  padding: 12px;
  border-radius: 6px;
  margin-bottom: 16px;
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
  background: #fff;
  padding: 16px;
  border-radius: 8px;
  border: 1px solid #e5e7eb;
  margin-bottom: 16px;
}

.section h3 {
  font-size: 14px;
  font-weight: 600;
  margin: 0 0 12px 0;
  color: #4b5563;
}

.file-upload {
  position: relative;
}

.hidden-input {
  display: none;
}

.upload-label {
  display: block;
  padding: 12px;
  border: 2px dashed #d1d5db;
  border-radius: 6px;
  text-align: center;
  cursor: pointer;
  color: #6b7280;
  font-size: 14px;
  transition: all 0.2s;
  word-break: break-all;
}

.upload-label:hover {
  border-color: #3b82f6;
  color: #3b82f6;
  background: #eff6ff;
}

.btn {
  border: none;
  border-radius: 6px;
  padding: 8px 16px;
  font-size: 14px;
  cursor: pointer;
  font-weight: 500;
  transition: background 0.2s;
}

.btn.primary {
  background: #2563eb;
  color: white;
}

.btn.primary:hover {
  background: #1d4ed8;
}

.btn.primary:disabled {
  background: #93c5fd;
  cursor: not-allowed;
}

.btn.secondary {
  background: #e5e7eb;
  color: #374151;
}

.btn.secondary:hover {
  background: #d1d5db;
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

.status-indicator {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 20px;
  gap: 10px;
  color: #6b7280;
  font-size: 14px;
}

.spinner {
  width: 24px;
  height: 24px;
  border: 3px solid #e5e7eb;
  border-top-color: #3b82f6;
  border-radius: 50%;
  animation: spin 1s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.error-message {
  color: #dc2626;
  background: #fef2f2;
  border: 1px solid #fecaca;
  padding: 12px;
  border-radius: 6px;
  margin-bottom: 16px;
  font-size: 14px;
}

.result-section {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.code-area {
  width: 100%;
  height: 300px;
  padding: 12px;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  font-family: 'Courier New', Courier, monospace;
  font-size: 13px;
  resize: vertical;
  box-sizing: border-box;
}
</style>
