const isResponsesEndpoint = (endpoint) => /\/responses(?:\?|$)/.test(endpoint || '')
const isWsEndpoint = (endpoint) => /^wss?:\/\//.test(endpoint || '')

const toWsEndpoint = (endpoint) => {
  if (!endpoint) return ''
  if (isWsEndpoint(endpoint)) return endpoint
  return endpoint.replace(/^http:\/\//, 'ws://').replace(/^https:\/\//, 'wss://')
}

const parseChatContent = (content) => {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map((item) => {
        if (!item || typeof item !== 'object') return ''
        if (typeof item.text === 'string') return item.text
        if (typeof item.output_text === 'string') return item.output_text
        return ''
      })
      .join('\n')
      .trim()
  }
  return ''
}

const parseResponsesOutput = (data) => {
  if (typeof data?.output_text === 'string' && data.output_text.trim()) return data.output_text
  if (!Array.isArray(data?.output)) return ''
  return data.output
    .flatMap((item) => (Array.isArray(item?.content) ? item.content : []))
    .map((item) => {
      if (typeof item?.text === 'string') return item.text
      if (typeof item?.output_text === 'string') return item.output_text
      return ''
    })
    .join('\n')
    .trim()
}

const extractDeltaFromSseEvent = (payload, useResponses) => {
  if (!payload || typeof payload !== 'object') return ''
  if (useResponses) {
    if (payload.type === 'response.output_text.delta' && typeof payload.delta === 'string') {
      return payload.delta
    }
    if (typeof payload.output_text_delta === 'string') return payload.output_text_delta
    if (typeof payload.delta === 'string') return payload.delta
    if (typeof payload.text === 'string') return payload.text
    return ''
  }
  if (typeof payload?.choices?.[0]?.delta?.content === 'string') {
    return payload.choices[0].delta.content
  }
  if (typeof payload.delta === 'string') return payload.delta
  if (typeof payload.text === 'string') return payload.text
  return ''
}

const safeParseMessage = (raw) => {
  if (typeof raw !== 'string') return raw
  try {
    return JSON.parse(raw)
  } catch {
    return raw
  }
}

const extractDeltaFromWsMessage = (payload) => {
  if (!payload) return ''
  if (typeof payload === 'string') return payload
  if (typeof payload.delta === 'string') return payload.delta
  if (typeof payload.content_delta === 'string') return payload.content_delta
  if (typeof payload.text === 'string') return payload.text
  if (typeof payload.output_text_delta === 'string') return payload.output_text_delta
  if (payload.type === 'response.output_text.delta' && typeof payload.delta === 'string') {
    return payload.delta
  }
  if (typeof payload?.choices?.[0]?.delta?.content === 'string') {
    return payload.choices[0].delta.content
  }
  return ''
}

const extractFinalFromWsMessage = (payload) => {
  if (!payload || typeof payload === 'string') return ''
  if (typeof payload.output_text === 'string') return payload.output_text
  if (typeof payload.content === 'string') return payload.content
  if (typeof payload.text === 'string') return payload.text
  if (typeof payload?.choices?.[0]?.message?.content === 'string') {
    return payload.choices[0].message.content
  }
  return ''
}

const isDoneWsMessage = (payload) => {
  if (!payload || typeof payload === 'string') return false
  if (payload.done === true || payload.status === 'completed') return true
  const type = String(payload.type || '').toLowerCase()
  if (!type) return false
  return (
    type.includes('done') ||
    type.includes('complete') ||
    type === 'response.completed' ||
    type === 'message.completed'
  )
}

const streamByWebSocket = (config, requestPayload, handlers = {}) =>
  new Promise((resolve, reject) => {
    const wsEndpoint = toWsEndpoint(config.wsEndpoint || config.endpoint)
    if (!wsEndpoint) {
      reject(new Error('WebSocket endpoint is empty'))
      return
    }

    let text = ''
    let finished = false
    const ws = new WebSocket(wsEndpoint)

    const closeSafely = () => {
      try {
        ws.close()
      } catch {
        void 0
      }
    }

    ws.onerror = () => {
      if (finished) return
      finished = true
      reject(new Error('WebSocket connection error'))
      closeSafely()
    }

    ws.onopen = () => {
      handlers.onStatus?.('websocket_connected')
      ws.send(
        JSON.stringify({
          type: 'model_request',
          apiKey: config.apiKey,
          endpoint: config.endpoint,
          model: config.model,
          payload: requestPayload,
        }),
      )
    }

    ws.onmessage = (event) => {
      const payload = safeParseMessage(event.data)
      const delta = extractDeltaFromWsMessage(payload)
      if (delta) {
        text += delta
        handlers.onDelta?.(delta)
      }
      if (isDoneWsMessage(payload)) {
        const finalText = extractFinalFromWsMessage(payload)
        if (!text && finalText) {
          text = finalText
          handlers.onDelta?.(finalText)
        }
        if (!finished) {
          finished = true
          resolve(text || finalText || '')
          closeSafely()
        }
      }
    }

    ws.onclose = () => {
      if (finished) return
      finished = true
      if (text) {
        resolve(text)
      } else {
        reject(new Error('WebSocket closed before any content was received'))
      }
    }
  })

const withStreamFlag = (payload) => ({
  ...payload,
  stream: true,
})

const requestModelStream = async (
  endpoint,
  apiKey,
  chatPayload,
  responsesPayload,
  handlers = {},
) => {
  const useResponses = isResponsesEndpoint(endpoint)
  const streamPayload = useResponses
    ? withStreamFlag(responsesPayload)
    : withStreamFlag(chatPayload)
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream, application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(streamPayload),
  })

  if (!response.ok) {
    const err = await response.text()
    throw new Error(`${response.status} - ${err}`)
  }

  const contentType = response.headers.get('content-type') || ''
  if (!response.body || !contentType.includes('text/event-stream')) {
    const data = await response.json()
    if (useResponses) {
      const content = parseResponsesOutput(data)
      if (!content) throw new Error('Invalid stream response: empty output from Responses API')
      handlers.onDelta?.(content)
      return content
    }
    const content = parseChatContent(data?.choices?.[0]?.message?.content)
    if (!content)
      throw new Error('Invalid stream response: empty content from Chat Completions API')
    handlers.onDelta?.(content)
    return content
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let text = ''
  let done = false
  let lastPayload = null
  handlers.onStatus?.('http_streaming')

  while (!done) {
    const { value, done: doneReading } = await reader.read()
    if (doneReading) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() || ''
    for (const rawLine of lines) {
      const line = rawLine.trim()
      if (!line.startsWith('data:')) continue
      const chunk = line.slice(5).trim()
      if (!chunk || chunk === '[DONE]') {
        done = chunk === '[DONE]'
        continue
      }
      let payload
      try {
        payload = JSON.parse(chunk)
      } catch {
        continue
      }
      lastPayload = payload
      const delta = extractDeltaFromSseEvent(payload, useResponses)
      if (delta) {
        text += delta
        handlers.onDelta?.(delta)
      }
    }
  }

  if (text) return text
  if (useResponses) {
    const content = parseResponsesOutput(lastPayload?.response || lastPayload)
    if (content) {
      handlers.onDelta?.(content)
      return content
    }
  } else {
    const content = parseChatContent(lastPayload?.choices?.[0]?.message?.content)
    if (content) {
      handlers.onDelta?.(content)
      return content
    }
  }
  throw new Error('HTTP stream returned empty content')
}

const requestModel = async (endpoint, apiKey, chatPayload, responsesPayload) => {
  const useResponses = isResponsesEndpoint(endpoint)
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(useResponses ? responsesPayload : chatPayload),
  })

  if (!response.ok) {
    const err = await response.text()
    throw new Error(`${response.status} - ${err}`)
  }

  const data = await response.json()
  if (useResponses) {
    const content = parseResponsesOutput(data)
    if (!content) throw new Error('Invalid API response: empty output from Responses API')
    return content
  }

  const content = parseChatContent(data?.choices?.[0]?.message?.content)
  if (!content) throw new Error('Invalid API response: empty content from Chat Completions API')
  return content
}

const callModel = async (config, chatPayload, responsesPayload, handlers = {}) => {
  const useResponses = isResponsesEndpoint(config.endpoint)
  const requestPayload = useResponses ? responsesPayload : chatPayload
  const canUseWs = Boolean(config.wsEndpoint || isWsEndpoint(config.endpoint))

  if (canUseWs) {
    handlers.onStatus?.('websocket_connecting')
    const text = await streamByWebSocket(config, requestPayload, handlers)
    if (!text) throw new Error('WebSocket stream returned empty content')
    return text
  }

  handlers.onStatus?.('http_stream_preparing')
  try {
    return await requestModelStream(
      config.endpoint,
      config.apiKey,
      chatPayload,
      responsesPayload,
      handlers,
    )
  } catch {
    handlers.onStatus?.('http_request')
    const text = await requestModel(config.endpoint, config.apiKey, chatPayload, responsesPayload)
    handlers.onDelta?.(text)
    return text
  }
}

const makeChatPayload = (model, system, user, imageUrl) => {
  const content = imageUrl
    ? [
        { type: 'text', text: user },
        {
          type: 'image_url',
          image_url: { url: imageUrl },
        },
      ]
    : user
  const messages = [
    { role: 'system', content: system },
    { role: 'user', content },
  ]
  return { model, messages }
}

const makeResponsesPayload = (model, system, user, imageUrl) => {
  const inputContent = imageUrl
    ? [
        { type: 'input_text', text: user },
        { type: 'input_image', image_url: imageUrl },
      ]
    : user
  const input = [
    { role: 'system', content: [{ type: 'input_text', text: system }] },
    { role: 'user', content: inputContent },
  ]
  return { model, input }
}

const callTextAgent = async (config, systemPrompt, userPrompt, handlers = {}, imageUrl) => {
  const model = config.model || 'gpt-4o'
  const chatPayload = makeChatPayload(model, systemPrompt, userPrompt, imageUrl)
  const responsesPayload = makeResponsesPayload(model, systemPrompt, userPrompt, imageUrl)
  return callModel(config, chatPayload, responsesPayload, handlers)
}

const extractJsonText = (text) => {
  const raw = String(text || '').trim()
  if (!raw) return ''
  const fenced = raw.match(/```json\s*([\s\S]*?)\s*```/i)
  if (fenced?.[1]) return fenced[1]
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start >= 0 && end > start) return raw.slice(start, end + 1)
  return raw
}

const normalizeJsonString = (text) =>
  String(text || '')
    .replaceAll('“', '"')
    .replaceAll('”', '"')
    .replaceAll('‘', "'")
    .replaceAll('’', "'")

const parseJsonFromCandidates = (rawText) => {
  const raw = normalizeJsonString(rawText).trim()
  const candidates = []
  if (raw) candidates.push(raw)
  const extracted = extractJsonText(raw)
  if (extracted && extracted !== raw) candidates.push(extracted)
  const arrStart = raw.indexOf('[')
  const arrEnd = raw.lastIndexOf(']')
  if (arrStart >= 0 && arrEnd > arrStart) candidates.push(raw.slice(arrStart, arrEnd + 1))
  const objStart = raw.indexOf('{')
  const objEnd = raw.lastIndexOf('}')
  if (objStart >= 0 && objEnd > objStart) candidates.push(raw.slice(objStart, objEnd + 1))

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate)
    } catch {
      void 0
    }
  }
  return null
}

const fallbackCasesFromText = (rawText, casesChunk) => {
  const text = String(rawText || '').toLowerCase()
  const selected = []
  for (const item of casesChunk || []) {
    const id = String(item?.id || '').trim()
    const title = String(item?.title || '').trim()
    if (!id || !title) continue
    const matched = text.includes(id.toLowerCase()) || text.includes(title.toLowerCase())
    if (matched) {
      selected.push({
        id,
        title,
        reason: 'fallback_match_from_non_json_response',
        priority: 'P1',
      })
    }
  }
  return selected
}

const normalizeSelectedCases = (cases) =>
  (Array.isArray(cases) ? cases : [])
    .map((item) => ({
      id: String(item?.id || '').trim(),
      title: String(item?.title || '').trim(),
      reason: String(item?.reason || '').trim() || 'matched_by_agent',
      priority: ['P0', 'P1', 'P2'].includes(String(item?.priority || '').toUpperCase())
        ? String(item.priority).toUpperCase()
        : 'P1',
    }))
    .filter((item) => item.id && item.title)

const parseJsonWithRepair = async (config, rawText, handlers = {}, maxRetries = 3) => {
  const direct = parseJsonFromCandidates(rawText)
  if (direct) return direct
  let current = extractJsonText(rawText)
  for (let i = 0; i < maxRetries; i += 1) {
    try {
      return JSON.parse(current)
    } catch {
      const systemPrompt =
        'You are a json_repair_agent. Output valid JSON only. No markdown. No explanations.'
      const userPrompt = `Fix this JSON to be valid without changing semantics:\n${current}`
      const repaired = await callTextAgent(config, systemPrompt, userPrompt, handlers)
      current = extractJsonText(repaired)
    }
  }
  throw new Error('JSON parse failed after 3 retries')
}

export const runVisualAnalysisAgent = async (
  config,
  screenshotBase64,
  domText = '',
  handlers = {},
) => {
  const systemPrompt = `You are visual_analysis_agent.
Your only job is to describe UI structure and interaction affordances.
Do not select test cases.
Do not generate code.
Do not output JSON.
Never output hidden reasoning.`
  const userPrompt = `请基于页面截图与 DOM 摘要输出简洁结构化文本：
1) 页面类型与核心模块
2) 关键交互元素
3) 可触发的导航入口
4) 可验证断言建议
DOM 摘要：
${domText || '(empty)'}`.trim()
  try {
    return await callTextAgent(config, systemPrompt, userPrompt, handlers, screenshotBase64)
  } catch (error) {
    throw new Error(`Visual Analysis Agent Error: ${error.message}`)
  }
}

export const runCaseSelectorAgent = async (
  config,
  { pageAnalysisText, casesChunk },
  handlers = {},
) => {
  const systemPrompt = `You are case_selector_agent.
You must output valid JSON only.
No markdown, no explanations, no reasoning.
Never output words: 等下, 不对, 可能, 分析.
If uncertain return {"cases":[]}.
Schema:
{"cases":[{"id":"string","title":"string","reason":"string","priority":"P0|P1|P2"}]}`
  const userPrompt = `页面分析结果：
${pageAnalysisText}

XMind 用例分片（JSON）：
${JSON.stringify(casesChunk)}

任务：
仅从输入中筛选匹配用例。
规则：
1) id/title 必须来自输入，禁止新增
2) 禁止重复
3) 只输出 JSON，格式：
{"cases":[{"id":"...","title":"...","reason":"...","priority":"P0|P1|P2"}]}`
  try {
    const raw = await callTextAgent(config, systemPrompt, userPrompt, handlers)
    let parsed
    try {
      parsed = await parseJsonWithRepair(config, raw, handlers, 3)
    } catch {
      const fallbackCases = fallbackCasesFromText(raw, casesChunk)
      return { cases: normalizeSelectedCases(fallbackCases) }
    }
    return { cases: normalizeSelectedCases(parsed?.cases) }
  } catch (error) {
    throw new Error(`Case Selector Agent Error: ${error.message}`)
  }
}

export const runCodegenAgent = async (
  config,
  { pageAnalysisText, selectedCases, extraContext = '' },
  handlers = {},
) => {
  const systemPrompt = `You are codegen_agent.
Generate executable Playwright JavaScript code only.
No markdown fences.
No explanations.
No hidden reasoning.`
  const userPrompt = `页面结构分析：
${pageAnalysisText}

已筛选用例 JSON：
${JSON.stringify({ cases: selectedCases })}

附加上下文：
${extraContext || '(none)'}

请输出：
1) Playwright JS 测试文件代码
2) 测试标题包含 case id
3) 代码可运行，包含必要 helper`
  try {
    return await callTextAgent(config, systemPrompt, userPrompt, handlers)
  } catch (error) {
    throw new Error(`Codegen Agent Error: ${error.message}`)
  }
}

export const callCodeModel = async (config, prompt, handlers = {}) => {
  const chatPayload = {
    model: config.model || 'gpt-4-turbo',
    messages: [
      {
        role: 'user',
        content: prompt,
      },
    ],
  }

  const responsesPayload = {
    model: config.model || 'gpt-4-turbo',
    input: prompt,
  }

  try {
    return await callModel(config, chatPayload, responsesPayload, handlers)
  } catch (error) {
    throw new Error(`Code Model API Error: ${error.message}`)
  }
}

export const callVisualModel = async (config, screenshotBase64, xmindContent, handlers = {}) => {
  const pageAnalysisText = await runVisualAnalysisAgent(config, screenshotBase64, '', handlers)
  const casesChunk = [{ id: 'legacy-1', title: 'legacy', raw: xmindContent }]
  const selected = await runCaseSelectorAgent(config, { pageAnalysisText, casesChunk }, handlers)
  return JSON.stringify({ pageAnalysisText, ...selected })
}
