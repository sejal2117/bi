import { useEffect, useRef } from 'react'

/**
 * Minimal page that embeds Scalar API Reference from CDN
 * and points it to the Elysia server's OpenAPI JSON at /openapi/json.  [10](https://openrouter.ai/google/gemini-2.5-flash-preview-05-20/api)
 */
export default function ApiDocs() {
  const ref = useRef(null)

  useEffect(() => {
    const s = document.createElement('script')
    s.src = 'https://cdn.jsdelivr.net/npm/@scalar/api-reference'
    s.onload = () => {
      // When script is ready, render Scalar UI into the container
      // We target the Elysia OpenAPI spec at http://localhost:3001/openapi/json  [9](https://blogs.diggibyte.com/power-bi-enhanced-report-format-pbir-developer-mode/)
      window.Scalar.createApiReference(ref.current, {
        url: 'http://localhost:3001/openapi/json',
        proxyUrl: 'https://proxy.scalar.com'
      })
    }
    document.body.appendChild(s)
  }, [])

  return (
    <div style={{height: '100vh', width: '100vw'}}>
      <div ref={ref} style={{height: '100%', width: '100%'}} />
    </div>
  )
}