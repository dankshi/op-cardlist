export default function TestLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Break out of the parent container and force dark styling
  return (
    <div className="fixed inset-0 z-40 overflow-auto bg-zinc-950">
      {children}
    </div>
  );
}
