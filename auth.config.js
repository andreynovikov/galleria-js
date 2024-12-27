import GitHub from 'next-auth/providers/github'
import Google from 'next-auth/providers/google'
import MailRu from 'next-auth/providers/mailru'
import Vk from 'next-auth/providers/vk'
import Yandex from 'next-auth/providers/yandex'

const basePath = process.env.BASE_PATH ?? ''

export default {
    basePath: `${basePath}/api/auth`,
    providers: [
        GitHub,
        Google,
        MailRu,
        Yandex,
        {
            ...Vk({
                checks: []
            }),
            token: {
                url: 'https://oauth.vk.com/access_token?v=5.131',
                conform: async (response) => {
                    const data = await response.json()
                    return new Response(
                        JSON.stringify({
                            token_type: 'dpop',
                            ...data,
                        }),
                        {
                            headers: { "content-type": "application/json" },
                            status: response.status
                        }
                    )
                }
            }
        }
    ]
}
