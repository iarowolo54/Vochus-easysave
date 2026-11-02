const { createServer } = require('http')
const { parse } = require('url')
const next = require('next')

const dev = process.env.NODE_ENV !== 'production'
const app = next({ dev })
const handle = app.getRequestHandler()

app.prepare().then(() => {
  const server = createServer((req, res) => {
    handle(req, res, parse(req.url, true))
  })

  const port = process.env.PORT || 3000
  // In production only nginx should reach the app. Listening publicly would let anyone connect
  // directly and forge X-Forwarded-For, which the IP limits rely on.
  const host = dev ? undefined : '127.0.0.1'
  server.listen(port, host, () => {
    console.log(`> Ready on http://${host ?? 'localhost'}:${port}`)
  })
})
