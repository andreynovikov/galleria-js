import Image from 'next/image'
import { useTranslations } from 'next-intl'

import emptyBox from '@/assets/empty-box.svg'

import styles from './nothing-found.module.css'

export default function NothingFound() {
    const t = useTranslations('Gallery')

    return <div className={styles.container}>
        <Image src={emptyBox} alt={t('nothingFound')} unoptimized className="image" />
    </div>
}
