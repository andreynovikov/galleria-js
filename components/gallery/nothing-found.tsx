import Image from 'next/image'

import emptyBox from '@/assets/empty-box.svg'

import styles from './nothing-found.module.scss'

export default function NothingFound() {
    return <div className={styles.container}>
        <Image src={emptyBox} alt="Nothing found" unoptimized className="image" />
    </div>
}
