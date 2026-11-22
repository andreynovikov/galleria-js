/*
 * Content Security Policy violation reports (lib/csp.ts), written to the server log. Browsers send them in two formats:
 * `report-uri` (application/csp-report, one report) and the Reporting API of `report-to` (application/reports+json,
 * a list). Anyone can post here, so bodies are size-limited, values shortened and stripped of control characters, and
 * each kind of violation is logged at most once an hour.
 */

const maxBody = 64 * 1024
const logInterval = 60 * 60 * 1000
const maxKinds = 1000

/** When each kind of violation was last logged */
const logged = new Map<string, number>()

interface Violation {
    disposition: string
    directive: string
    blocked: string
    document: string
    source: string
    sample: string
}

function text(value: unknown) {
    return typeof value === 'string' || typeof value === 'number' ? String(value).replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, 200) : ''
}

/** A report of either format, `null` if it isn't one */
function violation(report: Record<string, unknown>, legacy: boolean): Violation | null {
    const key = (modern: string, old: string) => report[legacy ? old : modern]
    const directive = text(key('effectiveDirective', 'effective-directive')) || text(key('effectiveDirective', 'violated-directive'))
    if (directive === '')
        return null
    const source = text(key('sourceFile', 'source-file'))
    const line = text(key('lineNumber', 'line-number'))
    return {
        disposition: text(report['disposition']) || 'enforce',
        directive,
        blocked: text(key('blockedURL', 'blocked-uri')),
        document: text(key('documentURL', 'document-uri')),
        source: source && line ? `${source}:${line}` : source,
        sample: text(key('sample', 'script-sample'))
    }
}

function log(violation: Violation) {
    const kind = [violation.disposition, violation.directive, violation.blocked, violation.source].join(' ')
    const now = Date.now()
    if (now - (logged.get(kind) ?? 0) < logInterval)
        return
    if (logged.size >= maxKinds)
        logged.clear()
    logged.set(kind, now)
    const action = violation.disposition === 'report' ? 'would block' : 'blocked'
    console.warn(`Content Security Policy ${action} ${violation.directive} ${violation.blocked || '(inline)'} on ${violation.document}`
        + (violation.source && ` (${violation.source})`) + (violation.sample && `: ${violation.sample}`))
}

export async function POST(request: Request) {
    const type = request.headers.get('content-type') ?? ''
    const legacy = type.startsWith('application/csp-report')
    if (!legacy && !type.startsWith('application/reports+json'))
        return new Response('Unsupported media type', { status: 415 })
    if (Number(request.headers.get('content-length') ?? 0) > maxBody)
        return new Response('Too large', { status: 413 })
    const body = await request.text()
    if (body.length > maxBody)
        return new Response('Too large', { status: 413 })

    let data: unknown
    try {
        data = JSON.parse(body)
    } catch {
        return new Response('Bad request', { status: 400 })
    }
    const reports = legacy
        ? [(data as { 'csp-report'?: unknown })?.['csp-report']]
        : (Array.isArray(data) ? data : []).filter(item => item?.type === 'csp-violation').map(item => item.body)
    for (const report of reports.slice(0, 100)) {
        if (report === null || typeof report !== 'object')
            continue
        const parsed = violation(report as Record<string, unknown>, legacy)
        if (parsed !== null)
            log(parsed)
    }
    return new Response(null, { status: 204 })
}
