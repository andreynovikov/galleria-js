import './history.scss'

export default function HistoryLayout({ children }: LayoutProps<'/history'>) {
    return <div className="history">
        {children}
    </div>
}
