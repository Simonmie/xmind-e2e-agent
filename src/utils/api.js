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

export const callVisualModel = async (config, screenshotBase64, xmindContent, handlers = {}) => {
  const prompt = `
You are an expert QA analyst and test architect.
Analyze the current screenshot and XMind test cases, then return strict JSON only.
JSON schema:
{
  "analysis_summary": "string",
  "applicable_cases": [{"case": "string", "reason": "string"}],
  "navigation_targets": [{"target": "string", "matchText": "string", "urlHint": "string", "action": "click|navigate"}],
  "code_prompt": "detailed prompt for generating Playwright-first E2E tests with readable case descriptions"
}
Rules:
1) Output must be valid JSON without markdown fences.
2) navigation_targets should include likely links/buttons from the current page that lead to other pages in cases.
3) code_prompt must request readable test cases and include explanations for each case.
4) Prefer Playwright, allow Cypress as fallback.

XMind Test Cases:
${xmindContent}
`

  const chatPayload = {
    model: config.model || 'gpt-4o',
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          {
            type: 'image_url',
            image_url: {
              url: screenshotBase64,
            },
          },
        ],
      },
    ],
  }

  const responsesPayload = {
    model: config.model || 'gpt-4o',
    input: [
      {
        role: 'user',
        content: [
          { type: 'input_text', text: prompt },
          { type: 'input_image', image_url: screenshotBase64 },
        ],
      },
    ],
  }

  try {
    return await callModel(config, chatPayload, responsesPayload, handlers)
  } catch (error) {
    throw new Error(`Visual Model API Error: ${error.message}`)
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
