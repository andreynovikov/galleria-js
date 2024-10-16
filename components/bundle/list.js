import { listBundles } from '@/lib/db'
import Link from 'next/link'

import styles from './list.module.scss'

export default async function BundleList() {
    const bundles = await listBundles()

    return (
        <ul className={styles.bundles}>
            {bundles.map(bundle => (
                <li key={bundle.path}>
                    <Link href={bundle.path}>{bundle.path}</Link>
                    &nbsp;
                    ({bundle.count})
                </li>
            ))}
        </ul>
    )
}