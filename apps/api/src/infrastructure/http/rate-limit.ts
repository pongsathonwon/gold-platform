/**
 * A fixed-window failure counter, for putting a ceiling on password guessing.
 *
 * Deliberately small and in-process. The alternative — counting in Postgres so the limit holds
 * across instances — buys a write on every login attempt, which is a cost paid by the shop all day
 * to slightly inconvenience an attacker. With `--max-instances=2` the practical effect of counting
 * per instance is that the real budget is up to twice the configured one. That is a factor of two
 * against an attacker who otherwise has no ceiling at all, and it is stated here rather than
 * quietly hoped over.
 *
 * **Only failures are counted, and a success clears the counter.** A limiter that counts successful
 * logins eventually locks out the people using the system correctly, which is a worse outage than
 * the attack it prevents — the shop cannot trade, and nobody can explain why.
 */

export interface RateLimitDecision {
    allowed: boolean
    /** Seconds until the window resets. Only meaningful when `allowed` is false. */
    retryAfterSeconds: number
}

interface Window {
    failures: number
    resetAt: number
}

export interface RateLimiterOptions {
    /** Failures permitted inside one window. */
    max: number
    windowMs: number
    /** Injectable so the tests do not sleep. */
    now?: () => number
    /**
     * Entries held before expired ones are swept. Bounds memory against an attacker rotating keys:
     * every distinct username or address would otherwise occupy a slot until the process restarts.
     */
    maxEntries?: number
}

export class FailureRateLimiter {
    private readonly windows = new Map<string, Window>()
    private readonly now: () => number
    private readonly maxEntries: number

    constructor(private readonly options: RateLimiterOptions) {
        this.now = options.now ?? Date.now
        this.maxEntries = options.maxEntries ?? 10_000
    }

    /** Whether `key` may attempt again. Does not itself count anything. */
    check(key: string): RateLimitDecision {
        const window = this.windows.get(key)
        const now = this.now()
        if (!window || now >= window.resetAt) return { allowed: true, retryAfterSeconds: 0 }
        if (window.failures < this.options.max) return { allowed: true, retryAfterSeconds: 0 }
        return {
            allowed: false,
            retryAfterSeconds: Math.max(1, Math.ceil((window.resetAt - now) / 1000)),
        }
    }

    /** Records one failed attempt against `key`, opening a window if none is running. */
    recordFailure(key: string): void {
        const now = this.now()
        const window = this.windows.get(key)
        if (!window || now >= window.resetAt) {
            this.sweepIfCrowded(now)
            this.windows.set(key, { failures: 1, resetAt: now + this.options.windowMs })
            return
        }
        window.failures += 1
    }

    /** Forgets `key` entirely. Called on a successful login so a typo streak costs nothing. */
    clear(key: string): void {
        this.windows.delete(key)
    }

    /**
     * Drops expired windows once the map grows past its bound.
     *
     * Lazy rather than on a timer: an interval would keep the process alive and outlive the tests,
     * and the only thing that grows this map is the very call that can afford to clean it. If every
     * entry is still live — a real flood — the map is left alone and the bound is exceeded rather
     * than evicting windows that are actively holding an attacker back.
     */
    private sweepIfCrowded(now: number): void {
        if (this.windows.size < this.maxEntries) return
        for (const [key, window] of this.windows) {
            if (now >= window.resetAt) this.windows.delete(key)
        }
    }
}

/**
 * The caller's address, as far as it can be known.
 *
 * Cloud Run appends the connecting address to any `X-Forwarded-For` the caller supplied, so the
 * **last** entry is the one Google wrote and the earlier ones are whatever the client claimed.
 * Reading the first entry — the usual advice, and correct behind a load balancer that overwrites
 * the header — would let an attacker reset their own budget on every request by rotating a spoofed
 * value.
 *
 * Even so, address is the weaker of the two keys: anything behind a NAT shares one, and a
 * distributed attacker has many. It is the username limit that actually protects an account,
 * because a caller cannot spoof which account they are guessing at.
 */
export function clientAddress(forwardedFor: string | undefined): string {
    if (!forwardedFor) return "unknown"
    const parts = forwardedFor.split(",").map((p) => p.trim()).filter(Boolean)
    return parts.at(-1) ?? "unknown"
}
