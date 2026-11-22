import Link from 'next/link'

import { listBundles } from '@/lib/db'
import { urlPath } from '@/lib/utils'
import { censorshipLevel, getSession } from '@/auth'

import styles from './list.module.css'

/*
https://ru.stackoverflow.com/questions/1529963/
https://stackoverflow.com/questions/71436457/
*/

export default async function BundleList() {
    const bundles = await listBundles(censorshipLevel(await getSession()))

    return (
        <ul className={styles.bundles}>
            {bundles.map(bundle => (
                <li key={bundle.path}>
                    <Link href={urlPath(bundle.path)}>{bundle.path}</Link>
                    &nbsp;
                    ({bundle.count})
                </li>
            ))}
        </ul>
    )
}
