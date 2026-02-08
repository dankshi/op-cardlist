"use client";

interface CardBackProps {
  className?: string;
}

export function CardBack({ className = "" }: CardBackProps) {
  return (
    <div
      className={`absolute inset-0 rounded-lg overflow-hidden ${className}`}
      style={{
        backfaceVisibility: "hidden",
        transform: "rotateY(180deg)",
      }}
    >
      <svg
        viewBox="0 0 250 350"
        className="w-full h-full"
        xmlns="http://www.w3.org/2000/svg"
      >
        {/* Background gradient */}
        <defs>
          <linearGradient id="cardBackGradient" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#7f1d1d" />
            <stop offset="50%" stopColor="#991b1b" />
            <stop offset="100%" stopColor="#7f1d1d" />
          </linearGradient>

          {/* Diagonal pattern */}
          <pattern id="diagonalLines" patternUnits="userSpaceOnUse" width="20" height="20" patternTransform="rotate(45)">
            <line x1="0" y1="0" x2="0" y2="20" stroke="#dc2626" strokeWidth="1" strokeOpacity="0.15" />
          </pattern>

          {/* Inner border gradient */}
          <linearGradient id="borderGradient" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#fbbf24" />
            <stop offset="50%" stopColor="#f59e0b" />
            <stop offset="100%" stopColor="#fbbf24" />
          </linearGradient>

          {/* Skull glow */}
          <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="3" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* Main background */}
        <rect width="250" height="350" fill="url(#cardBackGradient)" />

        {/* Diagonal pattern overlay */}
        <rect width="250" height="350" fill="url(#diagonalLines)" />

        {/* Decorative border */}
        <rect
          x="10"
          y="10"
          width="230"
          height="330"
          rx="8"
          fill="none"
          stroke="url(#borderGradient)"
          strokeWidth="3"
        />

        {/* Inner decorative frame */}
        <rect
          x="20"
          y="20"
          width="210"
          height="310"
          rx="6"
          fill="none"
          stroke="#fbbf24"
          strokeWidth="1"
          strokeOpacity="0.4"
        />

        {/* Jolly Roger / Skull Design - Stylized */}
        <g transform="translate(125, 140)" filter="url(#glow)">
          {/* Skull base */}
          <ellipse cx="0" cy="0" rx="45" ry="40" fill="#fef3c7" fillOpacity="0.9" />

          {/* Eye sockets */}
          <ellipse cx="-18" cy="-5" rx="12" ry="14" fill="#7f1d1d" />
          <ellipse cx="18" cy="-5" rx="12" ry="14" fill="#7f1d1d" />

          {/* Nose hole */}
          <path d="M0 10 L-6 20 L6 20 Z" fill="#7f1d1d" />

          {/* Teeth */}
          <rect x="-25" y="25" width="50" height="12" fill="#fef3c7" fillOpacity="0.9" rx="2" />
          <line x1="-15" y1="25" x2="-15" y2="37" stroke="#7f1d1d" strokeWidth="2" />
          <line x1="-5" y1="25" x2="-5" y2="37" stroke="#7f1d1d" strokeWidth="2" />
          <line x1="5" y1="25" x2="5" y2="37" stroke="#7f1d1d" strokeWidth="2" />
          <line x1="15" y1="25" x2="15" y2="37" stroke="#7f1d1d" strokeWidth="2" />

          {/* Crossbones */}
          <g transform="translate(0, 50)">
            <rect x="-55" y="-8" width="110" height="16" rx="8" fill="#fef3c7" fillOpacity="0.9" transform="rotate(-25)" />
            <rect x="-55" y="-8" width="110" height="16" rx="8" fill="#fef3c7" fillOpacity="0.9" transform="rotate(25)" />
          </g>
        </g>

        {/* ONE PIECE text at top */}
        <text
          x="125"
          y="55"
          textAnchor="middle"
          fontFamily="system-ui, sans-serif"
          fontSize="18"
          fontWeight="bold"
          fill="#fbbf24"
          letterSpacing="4"
        >
          ONE PIECE
        </text>

        {/* CARD GAME text */}
        <text
          x="125"
          y="75"
          textAnchor="middle"
          fontFamily="system-ui, sans-serif"
          fontSize="12"
          fontWeight="600"
          fill="#fcd34d"
          letterSpacing="6"
        >
          CARD GAME
        </text>

        {/* Bottom decorative element */}
        <text
          x="125"
          y="320"
          textAnchor="middle"
          fontFamily="system-ui, sans-serif"
          fontSize="10"
          fill="#fbbf24"
          fillOpacity="0.6"
          letterSpacing="2"
        >
          BANDAI
        </text>

        {/* Corner decorations */}
        <circle cx="30" cy="30" r="4" fill="#fbbf24" fillOpacity="0.5" />
        <circle cx="220" cy="30" r="4" fill="#fbbf24" fillOpacity="0.5" />
        <circle cx="30" cy="320" r="4" fill="#fbbf24" fillOpacity="0.5" />
        <circle cx="220" cy="320" r="4" fill="#fbbf24" fillOpacity="0.5" />
      </svg>
    </div>
  );
}
