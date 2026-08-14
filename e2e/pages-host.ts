import { createServer, type Server } from 'node:http'
import { existsSync, readFileSync, statSync } from 'node:fs'
import type { AddressInfo } from 'node:net'
import { extname, join, resolve, sep } from 'node:path'

/**
 * A static host with GitHub Pages' resolution rules, and nothing else.
 *
 * The deep-link tests cannot run against `npm run preview`. Vite's preview
 * server is an SPA server: it rewrites any unmatched path to index.html by
 * itself, so /network works there whatever the build contains. A test written
 * against it passes today, passes with the fix reverted, and says nothing
 * about the one host the app is actually deployed to.
 *
 * So this serves the built directory the way a dumb file host does:
 *
 *   - a path that names a file is that file
 *   - a path that names a directory holding index.html is that index.html
 *   - anything else is 404, answered with 404.html when the build ships one
 *
 * No rewrite, no fallback, no cleverness. Every request that misses is
 * recorded in `fallbacks`, so a test can prove it exercised the miss rather
 * than accidentally hitting a real file and passing for the wrong reason.
 */
export interface PagesHost {
  /** Origin to prefix onto a path, with no trailing slash. */
  readonly url: string
  /** Pathnames that found no file and were answered by the 404 document. */
  readonly fallbacks: readonly string[]
  close(): Promise<void>
}

/**
 * Content types for everything the build emits.
 *
 * Not decoration: the app's script tags are `type="module"`, and a browser
 * refuses a module served as anything but a JavaScript type. Get this wrong
 * and every page is blank for a reason that has nothing to do with routing.
 */
const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.txt': 'text/plain; charset=utf-8',
}

function typeOf(file: string): string {
  return TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream'
}

/** The file a path names, or null when nothing is there. */
function fileFor(root: string, pathname: string): string | null {
  let decoded: string
  try {
    decoded = decodeURIComponent(pathname)
  } catch {
    return null
  }

  // A request is not allowed to escape the served directory, the same as any
  // real host. resolve() collapses ../ before the prefix test sees it.
  const target = resolve(root, `.${decoded}`)
  if (target !== root && !target.startsWith(root + sep)) return null
  if (!existsSync(target)) return null

  if (statSync(target).isDirectory()) {
    const index = join(target, 'index.html')
    return existsSync(index) ? index : null
  }
  return target
}

export async function startPagesHost(dir = 'dist'): Promise<PagesHost> {
  const root = resolve(dir)
  if (!existsSync(join(root, 'index.html'))) {
    throw new Error(`${root} has no index.html; there is no build to serve.`)
  }

  const fallbacks: string[] = []
  const notFoundDoc = join(root, '404.html')

  const server: Server = createServer((request, response) => {
    const pathname = new URL(request.url ?? '/', 'http://host').pathname
    const file = fileFor(root, pathname)

    if (file) {
      response.writeHead(200, { 'content-type': typeOf(file) })
      response.end(readFileSync(file))
      return
    }

    fallbacks.push(pathname)

    // GitHub answers a miss with 404.html and a 404 status. When the build
    // ships none, it answers with its own page, which is what a deep link
    // into an SPA gets today.
    if (existsSync(notFoundDoc)) {
      response.writeHead(404, { 'content-type': 'text/html; charset=utf-8' })
      response.end(readFileSync(notFoundDoc))
      return
    }
    response.writeHead(404, { 'content-type': 'text/html; charset=utf-8' })
    response.end('<!doctype html><title>404</title><h1>File not found</h1>')
  })

  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
  const { port } = server.address() as AddressInfo

  return {
    url: `http://127.0.0.1:${port}`,
    fallbacks,
    close: () =>
      new Promise<void>((done, fail) => {
        // The browser holds keep-alive sockets open, and close() waits for
        // them, so without this the suite hangs at teardown rather than ending.
        server.closeAllConnections()
        server.close((error) => (error ? fail(error) : done()))
      }),
  }
}
