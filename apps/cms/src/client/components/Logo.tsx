interface LogoProps {
  className?: string
}

export function Logo({ className = "w-6 h-6" }: LogoProps) {
  return (
    <svg
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      {/* Outer rounded square */}
      <rect
        x="2"
        y="2"
        width="28"
        height="28"
        rx="6"
        fill="currentColor"
        fillOpacity="0.1"
        stroke="currentColor"
        strokeWidth="2"
      />
      {/* Stylized "B" made of two brackets and a vertical line */}
      <path
        d="M10 8C10 8 8 8 8 10V14C8 16 10 16 10 16C10 16 8 16 8 18V22C8 24 10 24 10 24"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M22 8C22 8 24 8 24 10V14C24 16 22 16 22 16C22 16 24 16 24 18V22C24 24 22 24 22 24"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Center dot */}
      <circle cx="16" cy="16" r="3" fill="currentColor" />
    </svg>
  )
}
