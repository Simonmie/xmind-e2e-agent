<template>
  <div class="options-page">
    <div class="container">
      <h1 class="title">配置设置</h1>
      
      <div class="card">
        <h2>视觉模型配置 (Visual Model)</h2>
        <div class="form-group">
          <label>API 地址 (Endpoint)</label>
          <input v-model="config.visualModel.endpoint" type="text" placeholder="https://api.openai.com/v1/chat/completions" />
        </div>
        <div class="form-group">
          <label>API Key (Token)</label>
          <input v-model="config.visualModel.apiKey" type="password" placeholder="sk-..." />
        </div>
        <div class="form-group">
          <label>模型名称 (Model Name)</label>
          <input v-model="config.visualModel.model" type="text" placeholder="gpt-4o" />
        </div>
      </div>

      <div class="card">
        <h2>代码生成模型配置 (Code Model)</h2>
        <div class="form-group">
          <label>API 地址 (Endpoint)</label>
          <input v-model="config.codeModel.endpoint" type="text" placeholder="https://api.openai.com/v1/chat/completions" />
        </div>
        <div class="form-group">
          <label>API Key (Token)</label>
          <input v-model="config.codeModel.apiKey" type="password" placeholder="sk-..." />
        </div>
         <div class="form-group">
          <label>模型名称 (Model Name)</label>
          <input v-model="config.codeModel.model" type="text" placeholder="gpt-4-turbo" />
        </div>
      </div>

      <div class="actions">
        <button class="btn primary" @click="saveConfig">保存配置</button>
        <span v-if="message" class="message" :class="messageType">{{ message }}</span>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'

defineOptions({
  name: 'OptionsPage',
})

const config = ref({
  visualModel: {
    endpoint: '',
    apiKey: '',
    model: 'gpt-4o'
  },
  codeModel: {
    endpoint: '',
    apiKey: '',
    model: 'gpt-4-turbo'
  }
})

const message = ref('')
const messageType = ref('success')

onMounted(async () => {
  // Load saved config
  const items = await chrome.storage.local.get(['visualModel', 'codeModel'])
  if (items.visualModel) config.value.visualModel = { ...config.value.visualModel, ...items.visualModel }
  if (items.codeModel) config.value.codeModel = { ...config.value.codeModel, ...items.codeModel }
})

const saveConfig = async () => {
  try {
    await chrome.storage.local.set({
      visualModel: config.value.visualModel,
      codeModel: config.value.codeModel
    })
    message.value = '配置已保存'
    messageType.value = 'success'
    setTimeout(() => {
      message.value = ''
    }, 3000)
  } catch (error) {
    message.value = '保存失败: ' + error.message
    messageType.value = 'error'
  }
}
</script>

<style scoped>
.options-page {
  min-height: 100vh;
  background: #f9fafb;
  padding: 40px 20px;
  box-sizing: border-box;
}

.container {
  max-width: 600px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.title {
  font-size: 24px;
  font-weight: 700;
  margin-bottom: 10px;
  text-align: center;
}

.card {
  background: #fff;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  padding: 24px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.card h2 {
  font-size: 18px;
  font-weight: 600;
  margin: 0 0 10px 0;
  border-bottom: 1px solid #eee;
  padding-bottom: 10px;
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.form-group label {
  font-size: 14px;
  font-weight: 500;
  color: #374151;
}

.form-group input {
  padding: 8px 12px;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  font-size: 14px;
}

.form-group input:focus {
  outline: none;
  border-color: #3b82f6;
  box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.2);
}

.actions {
  display: flex;
  align-items: center;
  gap: 12px;
}

.btn {
  padding: 10px 20px;
  border-radius: 6px;
  font-weight: 500;
  cursor: pointer;
  border: none;
  font-size: 14px;
}

.btn.primary {
  background: #2563eb;
  color: white;
}

.btn.primary:hover {
  background: #1d4ed8;
}

.message {
  font-size: 14px;
}

.message.success {
  color: #059669;
}

.message.error {
  color: #dc2626;
}
</style>
