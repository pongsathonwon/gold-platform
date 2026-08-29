/**
 * Turning a `DATABASE_URL` into postgres.js options, including the Cloud SQL unix socket.
 *
 * The socket cannot be expressed in the URL string alone, which is not obvious and fails in a
 * confusing way. libpq's convention is an empty host with the directory in a query parameter:
 *
 *     postgres://user:pass@/gold_platform?host=/cloudsql/PROJECT:REGION:INSTANCE
 *
 * postgres.js parses connection strings with the WHATWG `new URL()`, which rejects that outright —
 * there is no host — so the process dies at construction with `ERR_INVALID_URL` and prints the
 * whole string, password included, into the logs. Percent-encoding the path as the host parses but
 * is worse: `url.hostname` stays encoded, so it silently tries to reach a socket literally named
 * `%2Fcloudsql%2F...`.
 *
 * What postgres.js actually does is derive the socket from its `host` *option*:
 *
 *     host = o.host || url.hostname || ...
 *     path = o.path || host.indexOf('/') > -1 && host + '/.s.PGSQL.' + port
 *
 * A `host` containing a slash becomes a unix socket; the options object outranks the URL. So the
 * URL carries a placeholder host to stay parseable, `?host=` carries the socket directory, and this
 * function moves it where postgres.js will look:
 *
 *     postgres://user:pass@localhost/gold_platform?host=/cloudsql/PROJECT:REGION:INSTANCE
 *
 * Locally there is no `?host=`, the placeholder is the real host, and the connection is ordinary
 * TCP — so one `DATABASE_URL` covers both environments with no branch anywhere else.
 *
 * Every entry point that opens a connection must go through here: the server (`client.ts`), the
 * migration job and the seed job each construct their own client, and all three failed the same way.
 */

/** postgres.js options derived from `url` — `{ host }` when it names a unix socket, else `{}`. */
export function socketOptions(url: string): { host?: string } {
    let socket: string | null = null
    try {
        socket = new URL(url).searchParams.get('host')
    } catch {
        // Not parseable as a URL. Say nothing and let postgres.js raise its own error — but never
        // echo the string, which holds the password.
        return {}
    }
    // A socket directory is an absolute path. Anything else is a hostname and belongs in the URL.
    return socket && socket.startsWith('/') ? { host: socket } : {}
}
