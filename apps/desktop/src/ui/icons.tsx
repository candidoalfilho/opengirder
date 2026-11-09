import type { ReactNode, SVGProps } from 'react'

type P = SVGProps<SVGSVGElement> & { size?: number }

function Svg({ size = 16, children, ...rest }: P & { children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...rest}
    >
      {children}
    </svg>
  )
}

/** marca: ponte pênsil estilizada */
export const LogoMark = (p: P) => (
  <Svg {...p} strokeWidth={2}>
    <path d="M2 17h20M7 20V4M17 20V4" />
    <path d="M2 11c2.6 0 5-2.8 5-7M7 4c0 5.5 2.6 8.5 5 8.500s5-3 5-8.500M17 4c0 4.2 2.4 7 5 7" />
  </Svg>
)
export const IconPlay = (p: P) => (
  <Svg {...p}>
    <path d="M7 4.500v15l12-7.500z" fill="currentColor" stroke="none" />
  </Svg>
)
export const IconStop = (p: P) => (
  <Svg {...p}>
    <rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" stroke="none" />
  </Svg>
)
export const IconOpen = (p: P) => (
  <Svg {...p}>
    <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
  </Svg>
)
export const IconSave = (p: P) => (
  <Svg {...p}>
    <path d="M5 3h11l5 5v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z" />
    <path d="M7 3v6h8V3M7 21v-7h10v7" />
  </Svg>
)
export const IconSliders = (p: P) => (
  <Svg {...p}>
    <path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0" />
    <circle cx="16" cy="6" r="2" />
    <circle cx="10" cy="12" r="2" />
    <circle cx="18" cy="18" r="2" />
  </Svg>
)
export const IconGear = (p: P) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.800l.1.100a2 2 0 1 1-2.8 2.800l-.1-.100a1.7 1.7 0 0 0-2.9 1.200V21a2 2 0 1 1-4 0v-.100a1.7 1.7 0 0 0-2.9-1.200l-.1.100a2 2 0 1 1-2.8-2.800l.1-.100a1.7 1.7 0 0 0-1.2-2.900H3a2 2 0 1 1 0-4h.100a1.7 1.7 0 0 0 1.2-2.900l-.1-.100a2 2 0 1 1 2.8-2.800l.1.100a1.7 1.7 0 0 0 2.9-1.200V3a2 2 0 1 1 4 0v.100a1.7 1.7 0 0 0 2.9 1.200l.1-.100a2 2 0 1 1 2.8 2.800l-.1.100a1.7 1.7 0 0 0 1.2 2.900H21a2 2 0 1 1 0 4h-.100a1.7 1.7 0 0 0-1.5 1z" />
  </Svg>
)
export const IconSun = (p: P) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M4.9 4.900l1.4 1.400M17.7 17.700l1.4 1.400M2 12h2M20 12h2M4.9 19.100l1.4-1.400M17.7 6.300l1.4-1.4" />
  </Svg>
)
export const IconMoon = (p: P) => (
  <Svg {...p}>
    <path d="M21 12.800A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.800z" />
  </Svg>
)
export const IconFit = (p: P) => (
  <Svg {...p}>
    <path d="M4 9V5a1 1 0 0 1 1-1h4M20 9V5a1 1 0 0 0-1-1h-4M4 15v4a1 1 0 0 0 1 1h4M20 15v4a1 1 0 0 1-1 1h-4" />
  </Svg>
)
export const IconDots = (p: P) => (
  <Svg {...p}>
    <circle cx="6" cy="12" r="1.6" fill="currentColor" />
    <circle cx="12" cy="12" r="1.6" fill="currentColor" />
    <circle cx="18" cy="12" r="1.6" fill="currentColor" />
  </Svg>
)
export const IconClose = (p: P) => (
  <Svg {...p}>
    <path d="M6 6l12 12M18 6L6 18" />
  </Svg>
)
export const IconBack = (p: P) => (
  <Svg {...p}>
    <path d="M15 5l-7 7 7 7" />
  </Svg>
)
export const IconChart = (p: P) => (
  <Svg {...p}>
    <path d="M4 20V4M4 20h16M7 15l4-5 3 3 5-7" />
  </Svg>
)
export const IconPlus = (p: P) => (
  <Svg {...p}>
    <path d="M12 5v14M5 12h14" />
  </Svg>
)

/** glifos dos tipos de ponte (cartões e botões) — viewBox 120×48 */
export function BridgeGlyph({ kind }: { kind: string }) {
  const common = {
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.6,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  }
  if (kind === 'suspension') {
    const hangers = []
    for (let i = 1; i < 12; i++) {
      const x = 30 + i * 5
      const t = (x - 30) / 60
      // mesma parábola do cabo (Bézier quadrática com controle em y = 56)
      const y = 8 + 96 * t * (1 - t)
      hangers.push(<path key={i} d={`M${x} ${y.toFixed(1)}V36`} strokeWidth={0.8} />)
    }
    return (
      <svg viewBox="0 0 120 48" {...common}>
        <path d="M4 36h112" strokeWidth={2.2} />
        <path d="M30 44V6M90 44V6" strokeWidth={2.2} />
        <path d="M4 30Q20 26 30 8Q60 56 90 8Q100 26 116 30" />
        {hangers}
      </svg>
    )
  }
  if (kind === 'cable-stayed') {
    const stays = []
    for (let i = 1; i <= 6; i++) {
      stays.push(<path key={`l${i}`} d={`M60 ${6 + i * 3}L${60 - i * 8.5} 34`} strokeWidth={0.9} />)
      stays.push(<path key={`r${i}`} d={`M60 ${6 + i * 3}L${60 + i * 8.5} 34`} strokeWidth={0.9} />)
    }
    return (
      <svg viewBox="0 0 120 48" {...common}>
        <path d="M4 34h112" strokeWidth={2.2} />
        <path d="M60 44V4" strokeWidth={2.4} />
        {stays}
      </svg>
    )
  }
  return (
    <svg viewBox="0 0 120 48" {...common}>
      <path d="M4 20h112v6H4z" strokeWidth={1.8} />
      <path d="M22 26v18M48 26v18M72 26v18M98 26v18" strokeWidth={2.2} />
      <path d="M2 44h116" strokeWidth={1} />
    </svg>
  )
}
