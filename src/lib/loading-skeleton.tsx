type Variant = 'table' | 'dashboard' | 'cards' | 'notifications' | 'page' | 'report'
function Line({ className = '' }: { className?: string }) {
  return <div className={`rounded-md bg-slate-200/70 ${className}`} />
}
function Cards({ count }: { count: number }) {
  return (
    <div
      className={`grid gap-4 sm:grid-cols-2 ${count === 3 ? 'xl:grid-cols-3' : 'xl:grid-cols-4'}`}
    >
      {Array.from({ length: count }, (_, index) => (
        <div key={index} className="space-y-5 rounded-xl border border-slate-200 bg-white p-5">
          <div className="flex items-center justify-between">
            <Line className="h-3 w-24" />
            <Line className="h-5 w-5" />
          </div>
          <Line className="h-8 w-28" />
          <Line className="h-2.5 w-36 max-w-full" />
        </div>
      ))}
    </div>
  )
}
function Table({ rows }: { rows: number }) {
  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
      <div className="flex gap-6 border-b border-slate-200 bg-slate-50 px-5 py-4">
        <Line className="h-3 w-40" />
        <Line className="ml-auto h-3 w-20" />
        <Line className="hidden h-3 w-20 sm:block" />
      </div>
      <div className="divide-y divide-slate-100">
        {Array.from({ length: rows }, (_, index) => (
          <div key={index} className="flex items-center gap-5 px-5 py-5">
            <div className="min-w-0 flex-1 space-y-2">
              <Line className={`h-3 max-w-full ${index % 2 ? 'w-40' : 'w-52'}`} />
              <Line className="h-2.5 w-16" />
            </div>
            <Line className="hidden h-3 w-24 md:block" />
            <Line className="h-3 w-10" />
            <Line className="h-6 w-16" />
            <Line className="hidden h-7 w-14 sm:block" />
          </div>
        ))}
      </div>
      <div className="flex justify-between border-t border-slate-100 px-5 py-4">
        <Line className="h-3 w-28" />
        <Line className="h-7 w-24" />
      </div>
    </div>
  )
}
export function LoadingSkeleton({
  variant = 'table',
  rows = 5,
  label = 'Loading records',
}: {
  variant?: Variant
  rows?: number
  label?: string
}) {
  return (
    <div role="status" aria-busy="true" aria-label={label} className="space-y-6">
      <span className="sr-only">{label}</span>
      <div aria-hidden="true" className="animate-pulse space-y-6 motion-reduce:animate-none">
        {variant === 'page' && (
          <div className="space-y-3 py-1">
            <Line className="h-8 w-48" />
            <Line className="h-3 w-72 max-w-full" />
          </div>
        )}
        {(variant === 'dashboard' || variant === 'report') && (
          <Cards count={variant === 'dashboard' ? 4 : 3} />
        )}
        {variant === 'cards' ? (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {[0, 1, 2].map((index) => (
              <div
                key={index}
                className="space-y-5 rounded-xl border border-slate-200 bg-white p-6"
              >
                <Line className="h-5 w-40 max-w-full" />
                <Line className="h-3 w-20" />
                <Line className="h-8 w-28" />
                <Line className="h-3 w-48 max-w-full" />
                <Line className="h-9 w-full" />
              </div>
            ))}
          </div>
        ) : variant === 'notifications' ? (
          <div className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">
            {Array.from({ length: rows }, (_, index) => (
              <div key={index} className="flex gap-4 p-5">
                <Line className="h-9 w-9 shrink-0" />
                <div className="min-w-0 flex-1 space-y-3">
                  <Line className="h-4 w-52 max-w-full" />
                  <Line className="h-3 w-72 max-w-full" />
                  <Line className="h-3 w-24" />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <Table rows={rows} />
        )}
      </div>
    </div>
  )
}
