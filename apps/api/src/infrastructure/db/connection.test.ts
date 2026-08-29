import { describe, expect, it } from 'vitest'
import postgres from 'postgres'
import { socketOptions } from './connection.js'

// The unit under test is really "does postgres.js end up talking to the right socket", so these
// assert against the options object it actually builds rather than against socketOptions alone.
const CLOUD_SQL = '/cloudsql/some-project:asia-southeast1:gold-platform'
const optionsFor = (url: string) => {
    const sql = postgres(url, socketOptions(url))
    const o = (sql as unknown as { options: { host: string[]; path: string | false; database: string; user: string } }).options
    sql.end({ timeout: 0 })
    return o
}

describe('socketOptions', () => {
    it('routes a Cloud SQL url to the unix socket, not a TCP host', () => {
        const o = optionsFor(`postgres://gold_app:pw@localhost/gold_platform?host=${CLOUD_SQL}`)
        // `path` is the assertion that matters: postgres.js does
        // `if (options.path) return socket.connect(options.path)`, so once this is set the host
        // is never dialled. It appends the well-known socket filename to any host holding a slash.
        expect(o.path).toBe(`${CLOUD_SQL}/.s.PGSQL.5432`)
        expect(o.database).toBe('gold_platform')
        expect(o.user).toBe('gold_app')

        // `host` is left truncated at the first colon — postgres.js splits it on `:` expecting
        // `host:port`, and a Cloud SQL instance name is full of colons. Harmless, because `path`
        // is built from the untruncated string and wins, but worth pinning so the mangled value
        // is not mistaken for the bug next time someone reads these options.
        expect(o.host).toEqual(['/cloudsql/some-project'])
    })

    it('leaves an ordinary TCP url alone', () => {
        const o = optionsFor('postgres://postgres:password@localhost:5432/gold_platform')
        expect(o.path).toBe(false)
        expect(o.host).toEqual(['localhost'])
    })

    it('ignores a ?host= that is not a socket path', () => {
        // Only an absolute path names a socket; a hostname there belongs in the URL itself.
        expect(socketOptions('postgres://u:p@localhost/db?host=db.internal')).toEqual({})
    })

    it('returns nothing, and throws nothing, for an unparseable url', () => {
        // The libpq empty-host form. postgres.js would reject it and echo the password in the
        // error; this must not be the thing that raises.
        expect(socketOptions(`postgres://u:p@/gold_platform?host=${CLOUD_SQL}`)).toEqual({})
    })
})
