export const callVisualModel = async (config, screenshotBase64, xmindContent) => {
  const { endpoint, apiKey, model } = config
  
  const prompt = `
I have a screenshot of a webpage and a list of test cases from an XMind file.
Please analyze the screenshot to understand the UI elements and structure.
Then, verify which test cases from the XMind file apply to this page.
Finally, generate a detailed prompt for a code generation model. This prompt should instruct the code model to write an End-to-End (E2E) test script (e.g., using Playwright or Cypress) for this page, covering the relevant test cases.

XMind Test Cases:
${xmindContent}
`

  const payload = {
    model: model || 'gpt-4o',
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          { 
            type: 'image_url', 
            image_url: { 
              url: screenshotBase64 
            } 
          }
        ]
      }
    ]
  }

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify(payload)
  })

  if (!response.ok) {
    const err = await response.text()
    throw new Error(`Visual Model API Error: ${response.status} - ${err}`)
  }

  const data = await response.json()
  return data.choices[0].message.content
}

export const callCodeModel = async (config, prompt) => {
  const { endpoint, apiKey, model } = config
  
  const payload = {
    model: model || 'gpt-4-turbo',
    messages: [
      {
        role: 'user',
        content: prompt
      }
    ]
  }

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify(payload)
  })

  if (!response.ok) {
    const err = await response.text()
    throw new Error(`Code Model API Error: ${response.status} - ${err}`)
  }

  const data = await response.json()
  return data.choices[0].message.content
}
