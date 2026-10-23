import fs from 'node:fs/promises'
import path from 'node:path'

/**
 * Tiny JSON-file database for the dev and preview servers.
 *   GET /api/db  -> contents of data/db.json (404 if it doesn't exist yet)
 *   PUT /api/db  -> replaces data/db.json with the request body
 * Writes go to a temp file first and are renamed into place, so a crash
 * mid-write never leaves a half-written database.
 */
export default function jsonDb({ file = 'data/db.json' } = {}) {
  let dbPath

  const handler = async (req, res, next) => {
    if (req.url !== '/api/db') return next()
    // Lets the client tell this server apart from a static host's 404 page.
    res.setHeader('X-Json-Db', '1')

    try {
      if (req.method === 'GET') {
        const text = await fs.readFile(dbPath, 'utf8').catch((err) => {
          if (err.code === 'ENOENT') return null
          throw err
        })
        if (text == null) {
          res.statusCode = 404
          return res.end('{}')
        }
        res.setHeader('Content-Type', 'application/json')
        return res.end(text)
      }

      if (req.method === 'PUT') {
        let body = ''
        for await (const chunk of req) body += chunk
        const data = JSON.parse(body) // reject anything that isn't valid JSON
        await fs.mkdir(path.dirname(dbPath), { recursive: true })
        const tmp = `${dbPath}.tmp`
        await fs.writeFile(tmp, `${JSON.stringify(data, null, 2)}\n`, 'utf8')
        await fs.rename(tmp, dbPath)
        res.statusCode = 204
        return res.end()
      }

      res.statusCode = 405
      res.end()
    } catch (err) {
      res.statusCode = 500
      res.end(String(err.message || err))
    }
  }

  return {
    name: 'json-db',
    configResolved(config) {
      dbPath = path.resolve(config.root, file)
    },
    configureServer(server) {
      server.middlewares.use(handler)
    },
    configurePreviewServer(server) {
      server.middlewares.use(handler)
    },
  }
}
