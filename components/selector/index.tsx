import BundleList from '@/components/bundle/list'
import Divider from '@/components/divider'
import LabelCloud from '@/components/labels'

import { listLabels } from '@/lib/db'
import { censorshipLevel, getSession } from '@/auth'

import styles from './selector.module.css'

export default async function Selector() {
    const labels = await listLabels(censorshipLevel(await getSession()))

    return (
        <div className={styles.selector}>
            <LabelCloud labels={labels} />
            <Divider />
            <h2>Альбомы</h2>
            <BundleList />
        </div>
    )
}
