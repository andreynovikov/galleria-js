import Link from 'next/link'

import { getLogUsers } from '@/lib/db'

export default async function History() {
    const users = await getLogUsers()

    const days = users.reduce((days, user) => {
        const last = days.at(-1)
        const entry = {
            id: user.id,
            count: user.count
        }
        if (last?.day.getTime() !== user.day.getTime()) {
            days.push({
                day: user.day,
                users: [entry]
            })
        } else {
            last.users.push(entry)
        }
        return days
    }, [])

    return days.map(day => (
        <div style={{ marginBottom: '5px' }} key={day.day}>
            <div style={{ fontWeight: "bold" }}>
                {day.day.toISOString().split('T')[0]}
            </div>
            <div>
                {day.users.map(user => (
                    <div key={user.id}>
                        <Link href={`/history/${user.id}/${day.day.toISOString().split('T')[0]}`}>
                            {user.id}
                        </Link>
                        &nbsp;
                        ({user.count})
                    </div>
                ))}
            </div>
        </div>
    ))
}
