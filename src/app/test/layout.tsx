import Link from "next/link";

export default function TestLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Break out of the parent container and force dark styling
  // z-[60] to cover the header (z-50)
  return (
    <div className="fixed inset-0 z-[60] overflow-auto bg-zinc-950">
      {/* Simple dark header */}
      <header className="sticky top-0 bg-zinc-900 border-b border-zinc-800 z-10">
        <nav className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
          <Link href="/" className="group flex items-baseline gap-0.5 hover:opacity-90 transition-opacity">
            <span className="text-2xl font-black italic text-red-500 drop-shadow-[0_0_10px_rgba(239,68,68,0.5)]">OP</span>
            <span className="text-xl font-bold text-white tracking-tight">Card</span>
            <span className="text-xl font-bold text-zinc-400 tracking-tight">list</span>
          </Link>
          <div className="flex items-center gap-4">
            <Link href="/" className="text-zinc-400 hover:text-white transition-colors">
              ← Back to Site
            </Link>
          </div>
        </nav>
      </header>
      {children}
    </div>
  );
}
