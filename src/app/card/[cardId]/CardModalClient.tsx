"use client";

import { useRouter } from "next/navigation";
import { useEffect, useCallback } from "react";

interface CardModalClientProps {
  children: React.ReactNode;
}

export default function CardModalClient({ children }: CardModalClientProps) {
  const router = useRouter();

  const handleClose = useCallback(() => {
    // Go back in history to preserve scroll position
    router.back();
  }, [router]);

  // Handle escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        handleClose();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    // Prevent body scroll when modal is open
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = "";
    };
  }, [handleClose]);

  // Handle backdrop click
  const handleBackdropClick = (e: React.MouseEvent) => {
    // Only close if clicking the backdrop itself, not the modal content
    if (e.target === e.currentTarget) {
      handleClose();
    }
  };

  return (
    <div
      className="fixed inset-0 bg-black/90 light:bg-black/60 z-50 flex items-center justify-center p-4 md:p-6 lg:p-8"
      onClick={handleBackdropClick}
    >
      {/* Modal Container */}
      <div className="relative w-full max-w-5xl bg-zinc-900 light:bg-white rounded-2xl border border-zinc-800 light:border-zinc-200 overflow-hidden shadow-2xl">
        {/* Close button - positioned on modal */}
        <button
          onClick={handleClose}
          className="absolute top-3 right-3 z-10 p-2 rounded-full bg-zinc-800/80 light:bg-zinc-200/80 hover:bg-zinc-700 light:hover:bg-zinc-300 transition-colors group"
          aria-label="Close"
        >
          <svg
            className="w-5 h-5 text-zinc-400 light:text-zinc-600 group-hover:text-white light:group-hover:text-zinc-900 transition-colors"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M6 18L18 6M6 6l12 12"
            />
          </svg>
        </button>

        {children}
      </div>
    </div>
  );
}
