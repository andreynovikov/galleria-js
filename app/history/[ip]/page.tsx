import UserHistory from '@/components/history/user-history'

export default async function History(props: PageProps<'/history/[ip]'>) {
    return <UserHistory {...props} />
}
