import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const proxyMiddleware = {
  name: 'local-proxy-middleware',
  configureServer(server) {
    server.middlewares.use('/__proxy__', async (req, res) => {
      if (req.method !== 'POST') {
        res.statusCode = 405
        res.setHeader('content-type', 'application/json')
        res.end(JSON.stringify({ error: 'Method Not Allowed' }))
        return
      }
      try {
        const chunks = []
        for await (const chunk of req) chunks.push(chunk)
        const bodyRaw = Buffer.concat(chunks).toString('utf8')
        const { url, method = 'GET', headers = {}, body } = JSON.parse(bodyRaw || '{}')
        if (!url) {
          res.statusCode = 400
          res.setHeader('content-type', 'application/json')
          res.end(JSON.stringify({ error: 'Missing url' }))
          return
        }
        const init = { method, headers }
        if (body !== undefined && body !== null && body !== '') {
          init.body = body
        }
        console.log(`[Proxy] ${method} ${url}`);
        const upstream = await fetch(url, init)
        res.statusCode = upstream.status
        upstream.headers.forEach((value, key) => {
          const k = key.toLowerCase()
          if (k === 'transfer-encoding') return
          if (k === 'content-encoding') return
          if (k === 'content-length') return
          res.setHeader(key, value)
        })
        const buffer = Buffer.from(await upstream.arrayBuffer())
        console.log(`[Proxy] Upstream status: ${upstream.status}, Body length: ${buffer.length}`);
        res.end(buffer)
      } catch (error) {
        res.statusCode = 500
        res.setHeader('content-type', 'application/json')
        res.end(JSON.stringify({ error: error?.message || String(error) }))
      }
    })
  },
}

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [proxyMiddleware, react()],
  server: {
    port: 5173,
    open: true,
    proxy: {
      '/cfg': {
        target: 'https://api.videoncloud.com/V1/', // <-- change this to your real base
        changeOrigin: true,
        secure: true,
        rewrite: (path) => path.replace(/^\/cfg/, ''),
      },
    },
  },
})
