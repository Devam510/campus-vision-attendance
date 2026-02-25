/**
 * components/Skeleton.jsx – Lightweight shimmer skeleton components.
 * No external dependencies — pure CSS animation via index.css .skeleton class.
 */

/** Single skeleton line */
export function SkeletonLine({ width = "100%", height = 14, style = {} }) {
    return (
        <div
            className="skeleton"
            style={{ width, height, borderRadius: 6, ...style }}
        />
    );
}

/** Skeleton card with multiple lines */
export function SkeletonCard({ lines = 3 }) {
    return (
        <div className="card" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <SkeletonLine width="40%" height={18} />
            {Array.from({ length: lines }).map((_, i) => (
                <SkeletonLine key={i} width={i % 2 === 0 ? "90%" : "70%"} />
            ))}
        </div>
    );
}

/** Skeleton table rows */
export function SkeletonTable({ rows = 5, cols = 4 }) {
    return (
        <div className="card" style={{ padding: 0 }}>
            <table className="table">
                <tbody>
                    {Array.from({ length: rows }).map((_, r) => (
                        <tr key={r}>
                            {Array.from({ length: cols }).map((_, c) => (
                                <td key={c}><SkeletonLine width={c === 0 ? "80%" : "60%"} /></td>
                            ))}
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}

/** Full-page loading skeleton for Suspense fallback */
export function PageSkeleton() {
    return (
        <div style={{ padding: "24px 32px", display: "flex", flexDirection: "column", gap: 20 }}>
            {/* Header */}
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 8 }}>
                <SkeletonLine width={220} height={28} />
                <SkeletonLine width={160} height={14} />
            </div>
            {/* Stat cards row */}
            <div className="grid-4">
                {[1, 2, 3, 4].map(i => (
                    <div key={i} className="stat-card">
                        <SkeletonLine width={40} height={40} style={{ borderRadius: 10 }} />
                        <SkeletonLine width="60%" height={28} style={{ marginTop: 12 }} />
                        <SkeletonLine width="40%" height={12} style={{ marginTop: 6 }} />
                    </div>
                ))}
            </div>
            {/* Table skeleton */}
            <SkeletonTable rows={6} cols={5} />
        </div>
    );
}
