"use client";

import { useState, useEffect } from "react";

const REMINDERS = [
  { title: "Take a breath", message: "Inhale slowly... hold... exhale." },
  { title: "Relax your shoulders", message: "Let them drop away from your ears." },
  { title: "Unclench your jaw", message: "Let your face soften." },
  { title: "Check your posture", message: "Sit up straight, feet flat on the floor." },
  { title: "Rest your eyes", message: "Look at something 20 feet away for 20 seconds." },
  { title: "Stretch your hands", message: "Open and close your fists a few times." },
];

const INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

export function BreathingReminder() {
  const [visible, setVisible] = useState(false);
  const [reminder, setReminder] = useState(REMINDERS[0]);
  const [isBreathing, setIsBreathing] = useState(false);

  useEffect(() => {
    const showReminder = () => {
      const randomReminder = REMINDERS[Math.floor(Math.random() * REMINDERS.length)];
      setReminder(randomReminder);
      setVisible(true);
      setIsBreathing(randomReminder.title === "Take a breath");
    };

    // Show first reminder after interval
    const interval = setInterval(showReminder, INTERVAL_MS);

    return () => clearInterval(interval);
  }, []);

  if (!visible) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 animate-in fade-in duration-700">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={() => setVisible(false)}
      />

      {/* Card */}
      <div className="relative bg-zinc-900 border border-zinc-700 rounded-2xl p-8 max-w-sm w-full text-center shadow-2xl animate-in zoom-in-95 duration-500">
        {/* Breathing circle animation */}
        <div className="relative w-32 h-32 mx-auto mb-6">
          {/* Outer glow */}
          <div
            className={`absolute inset-0 rounded-full bg-gradient-to-br from-teal-400/20 to-cyan-400/20 ${
              isBreathing ? "animate-breathe" : "animate-pulse-slow"
            }`}
          />
          {/* Middle ring */}
          <div
            className={`absolute inset-4 rounded-full bg-gradient-to-br from-teal-400/30 to-cyan-400/30 ${
              isBreathing ? "animate-breathe-delayed" : "animate-pulse-slow"
            }`}
          />
          {/* Inner circle */}
          <div
            className={`absolute inset-8 rounded-full bg-gradient-to-br from-teal-400 to-cyan-400 shadow-lg shadow-teal-400/30 ${
              isBreathing ? "animate-breathe" : ""
            }`}
          />
        </div>

        {/* Text */}
        <h3 className="text-xl font-semibold text-white mb-2">{reminder.title}</h3>
        <p className="text-zinc-400 mb-6">{reminder.message}</p>

        {/* Dismiss button */}
        <button
          onClick={() => setVisible(false)}
          className="px-6 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-lg transition-colors text-sm"
        >
          Thanks, I needed that
        </button>
      </div>
    </div>
  );
}
