import { cookies } from 'next/headers'

const gaId = process.env.GOOGLE_ANALYTICS_ID
const gaSecret = process.env.GOOGLE_ANALYTICS_API_SECRET

export async function sendEvent(name: string, params: Record<string, unknown>) {
    if (!gaId || !gaSecret)
        return
    const gaClientId = (await cookies()).get('ga_client_id')
    const event = { name, params: { 'event_category': 'galleria', ...params } }
    if (gaClientId)
        fetch(`https://www.google-analytics.com/mp/collect?measurement_id=${gaId}&api_secret=${gaSecret}`, {
            method: 'POST',
            headers: {
                'content-type': 'application/json'
            },
            body: JSON.stringify({
                'client_id': gaClientId.value,
                'events': [event]
            })
        }).catch(e => console.error(`Can not send ${name} event to Google Analytics:`, e))
}
