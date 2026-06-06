const encoder = new TextEncoder()
const decoder = new TextDecoder()

export function encodeLspMessage(payload) {
  const body = encoder.encode(JSON.stringify(payload))
  const header = encoder.encode(`Content-Length: ${body.byteLength}\r\n\r\n`)
  const result = new Uint8Array(header.byteLength + body.byteLength)
  result.set(header, 0)
  result.set(body, header.byteLength)
  return result
}

export class LspMessageParser {
  constructor() {
    this.buffer = new Uint8Array(0)
  }

  push(chunk) {
    const merged = new Uint8Array(this.buffer.byteLength + chunk.byteLength)
    merged.set(this.buffer, 0)
    merged.set(chunk, this.buffer.byteLength)
    this.buffer = merged

    const messages = []
    while (true) {
      const headerEnd = findHeaderEnd(this.buffer)
      if (headerEnd < 0) break

      const header = decoder.decode(this.buffer.subarray(0, headerEnd))
      const match = header.match(/Content-Length:\s*(\d+)/i)
      if (!match) {
        throw new Error(`Malformed LSP header: ${header}`)
      }

      const bodyLength = Number(match[1])
      const bodyStart = headerEnd + 4
      const bodyEnd = bodyStart + bodyLength
      if (this.buffer.byteLength < bodyEnd) break

      const body = decoder.decode(this.buffer.subarray(bodyStart, bodyEnd))
      messages.push(JSON.parse(body))
      this.buffer = this.buffer.subarray(bodyEnd)
    }
    return messages
  }
}

function findHeaderEnd(buffer) {
  for (let i = 0; i <= buffer.byteLength - 4; i++) {
    if (buffer[i] === 13 && buffer[i + 1] === 10 && buffer[i + 2] === 13 && buffer[i + 3] === 10) {
      return i
    }
  }
  return -1
}
