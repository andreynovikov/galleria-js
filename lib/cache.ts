/**
 * In-memory cache of buffers bounded by their total size, evicting the least recently used ones. Concurrent requests
 * for a missing key share one call of the function that makes the value. Failed calls are not cached.
 */
export class BufferCache {
    /** Map keeps insertion order, so its first key is the least recently used one */
    private entries = new Map<string, Buffer>()
    private pending = new Map<string, Promise<Buffer>>()
    private bytes = 0

    constructor(private readonly maxBytes: number) {}

    /**
     * The cached value, or the value made by `make`. With `store: false`, a value which is not cached or being made yet
     * is made without caching it, so occasional bulk work doesn't evict what is used often.
     */
    async get(key: string, make: () => Promise<Buffer>, store = true): Promise<Buffer> {
        const cached = this.entries.get(key)
        if (cached !== undefined) {
            this.entries.delete(key)
            this.entries.set(key, cached)
            return cached
        }
        let promise = this.pending.get(key)
        if (promise === undefined && !store)
            return make()
        if (promise === undefined) {
            promise = make()
                .then(value => {
                    this.set(key, value)
                    return value
                })
                .finally(() => this.pending.delete(key))
            this.pending.set(key, promise)
        }
        return promise
    }

    private set(key: string, value: Buffer) {
        // A value which doesn't fit would only evict everything else
        if (value.length > this.maxBytes)
            return
        this.entries.set(key, value)
        this.bytes += value.length
        for (const [oldest, buffer] of this.entries) {
            if (this.bytes <= this.maxBytes)
                break
            this.entries.delete(oldest)
            this.bytes -= buffer.length
        }
    }
}
