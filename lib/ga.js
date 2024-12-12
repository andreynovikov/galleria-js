import { cookies } from 'next/headers'

const gaId = process.env.GOOGLE_ANALYTICS_ID
const gaSecret = process.env.GOOGLE_ANALYTICS_API_SECRET

export async function sendEvent(name, params) {
    const gaClientId = (await cookies()).get('ga_client_id')
    const event = { name, params: { 'event_category': 'galleria', ...params } }
    if (gaId && gaSecret && gaClientId)
        fetch(`https://www.google-analytics.com/mp/collect?measurement_id=${gaId}&api_secret=${gaSecret}`, {
            method: 'POST',
            headers: {
                'content-type': 'application/json'
            },
            body: JSON.stringify({
                'client_id': gaClientId.value,
                'events': [event]
            })
        })
}
