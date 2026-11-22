/** Runs once when the server starts */
export async function register() {
    // Not in the Edge runtime, and not while `next build` prerenders pages
    if (process.env.NEXT_RUNTIME !== 'nodejs' || process.env.NEXT_PHASE === 'phase-production-build')
        return
    const { scheduleLogMaintenance } = await import('./lib/log-retention')
    scheduleLogMaintenance()
    const { schedulePhotoScan } = await import('./lib/images')
    schedulePhotoScan()
}
