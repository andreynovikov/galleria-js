import BundleList from '@/components/bundle/list'
import Divider from '@/components/divider'
import LabelCloud from '@/components/labels'

import { listLabels } from '@/lib/db'

import styles from './selector.module.scss'

export default async function Selector() {
    const labels = await listLabels()

    return (
        <div className={styles.selector}>
            <LabelCloud labels={labels} />
            <Divider />
            <h2>Альбомы</h2>
            <BundleList />
        </div>
    )
   
}