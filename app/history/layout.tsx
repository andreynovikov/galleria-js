import './history.css'

export default function HistoryLayout({ children }: LayoutProps<'/history'>) {
    return <div className="history">
        {children}
    </div>
}
