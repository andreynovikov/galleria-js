import Image from 'next/image'

import emptyBox from '@/assets/empty-box.svg'

import styles from './nothing-found.module.css'

export default function NothingFound() {
    return <div className={styles.container}>
        <Image src={emptyBox} alt="Nothing found" unoptimized className={styles.image} />
    </div>
}
