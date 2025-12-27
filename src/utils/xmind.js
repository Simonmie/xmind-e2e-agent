import JSZip from 'jszip'

export const parseXMindFile = async (file) => {
  try {
    const zip = await JSZip.loadAsync(file)
    const contentFile = zip.file('content.json')
    if (!contentFile) {
      throw new Error('Invalid XMind file: content.json not found')
    }
    const contentText = await contentFile.async('text')
    const content = JSON.parse(contentText)
    return extractTextFromXMind(content)
  } catch (error) {
    console.error('Failed to parse XMind file:', error)
    throw error
  }
}

const extractTextFromXMind = (content) => {
  const textParts = []
  
  const traverse = (node, depth = 0) => {
    if (!node) return
    
    if (node.title) {
      textParts.push(`${'  '.repeat(depth)}- ${node.title}`)
    }
    
    if (node.children && node.children.attached) {
      node.children.attached.forEach(child => traverse(child, depth + 1))
    }
  }

  if (Array.isArray(content)) {
    content.forEach(sheet => {
      if (sheet.rootTopic) {
        traverse(sheet.rootTopic)
      }
    })
  }

  return textParts.join('\n')
}
