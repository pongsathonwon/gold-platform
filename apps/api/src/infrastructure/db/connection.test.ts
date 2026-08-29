import { describe, expect, it } from 'vitest'
import postgres from 'postgres'
import { parseConnection } from './connection.js'

// The claim under test is "this ends up talking to the right socket, and says nothing to the server
// it should not", so these assert against the options object postgres.js actually builds rather
// than against parseConnection's return value alone.
const CLOUD_SQL = '/cloudsql/some-project:asia-southeast1:gold-platform'

type Built = {
    host: string[]
    path: string | false
    database: string
    user: string
    connection: Record<string, unknown>
}

const build = (databaseUrl: string): Built => {
    const { url, options } = parseConnection(databaseUrl)
    const sql = postgres(url, options)
    const o = (sql as unknown as { options: Built }).options
    sql.end({ timeout: 0 })
    return o
}

describe('parseConnection', () => {
    it('routes a Cloud SQL url to the unix socket, not a TCP host', () => {
        const o = build(`postgres://gold_app:pw@localhost/gold_platform?host=${CLOUD_SQL}`)
        // `path` is the decisive assertion: postgres.js does
        // `if (options.path) return socket.connect(options.path)`, so once this is set the host is
        // never dialled. It appends the well-known socket filename to any host holding a slash.
        expect(o.path).toBe(`${CLOUD_SQL}/.s.PGSQL.5432`)
        expect(o.database).toBe('gold_platform')
        expect(o.user).toBe('gold_app')
    })

    it('does not forward `host` to the server as a startup parameter', () => {
        // The regression this split exists for. postgres.js copies every query-string entry it does
        // not recognise into `connection`, which becomes the startup packet — and `host` is not a
        // Postgres GUC, so the backend answers
        //   FATAL: unrecognized configuration parameter "host"
        // *after* connecting to the correct socket, which reads like a permissions problem rather
        // than a spare query parameter. Reading ?host= is not enough; it has to be removed.
        const o = build(`postgres://gold_app:pw@localhost/gold_platform?host=${CLOUD_SQL}`)
        expect(o.connection).not.toHaveProperty('host')
    })

    it('leaves an ordinary TCP url alone', () => {
        const o = build('postgres://postgres:password@localhost:5432/gold_platform')
        expect(o.path).toBe(false)
        expect(o.host).toEqual(['localhost'])
        expect(o.connection).not.toHaveProperty('host')
    })

    it('ignores a ?host= that names a hostname rather than a socket', () => {
        // Only an absolute path is a socket directory; a hostname there belongs in the URL.
        expect(parseConnection('postgres://u:p@localhost/db?host=db.internal').options).toEqual({})
    })

    it('returns the url untouched, and throws nothing, when it cannot be parsed', () => {
        // The libpq empty-host form, which postgres.js rejects while echoing the password. This
        // helper must not be the thing that raises.
        const raw = `postgres://u:p@/gold_platform?host=${CLOUD_SQL}`
        expect(parseConnection(raw)).toEqual({ url: raw, options: {} })
    })

    it('preserves other query parameters', () => {
        const { url } = parseConnection(
            `postgres://u:p@localhost/db?sslmode=require&host=${CLOUD_SQL}`,
        )
        expect(url).toContain('sslmode=require')
        expect(url).not.toContain('host=')
    })
})
