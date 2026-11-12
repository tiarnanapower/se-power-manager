// The Wawaweewa page's own loading spinner. Every other page keeps the standard one.
export function WawaweewaSpinner({ small = false, label = "Loading" }: { small?: boolean; label?: string }) {
  return (
    <div className={`pp-wawa-spin${small ? " pp-wawa-spin--small" : ""}`} role="status" aria-label={label}>
      {/* eslint-disable-next-line @next/next/no-img-element -- tiny static image, no optimisation needed */}
      <img src="/brand/wawaweewa.png" alt="" />
      {!small && <span className="pp-muted">{label}</span>}
    </div>
  );
}
