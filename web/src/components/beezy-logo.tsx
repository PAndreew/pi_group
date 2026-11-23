import { cn } from "@/lib/utils"

/** Eye half-width when open; a blink squeezes it to a thin stripe along the eye's long axis. */
const OPEN = 1.4870758
const SHUT = 0.3

/** One blink every few seconds: shut, open, and now and then a quick double blink. */
function Blink() {
  return (
    <animate
      attributeName="rx"
      dur="4.2s"
      repeatCount="indefinite"
      calcMode="spline"
      keyTimes="0;0.70;0.74;0.78;0.86;0.89;0.92;1"
      keySplines="0 0 1 1;0.4 0 1 1;0 0 0.6 1;0 0 1 1;0.4 0 1 1;0 0 0.6 1;0 0 1 1"
      values={`${OPEN};${OPEN};${SHUT};${OPEN};${OPEN};${SHUT};${OPEN};${OPEN}`}
    />
  )
}

/** The beezy logo (public/beezy-logo.svg) inline, so its eyes can blink. */
export function BeezyLogo({ blink = false, className }: { blink?: boolean; className?: string }) {
  return (
    <svg viewBox="0 0 36.972401 37.354679" className={cn("size-16", className)} role="img" aria-label="beezy">
      <g transform="translate(-49.890999,-134.65604)" stroke="#000" strokeLinecap="butt" strokeLinejoin="miter">
        <path fill="#2b2200" strokeWidth="0.264583" d="m 50.044035,150.86289 9.085315,-15.67612 17.864587,-0.39677 9.715918,16.06334 -8.995833,15.67099 -15.896929,-0.14894 -5.666613,5.25681 1.57544,-7.60532 z" />
        <path fill="#ffff00" strokeWidth="0.264583" d="m 60.516137,164.14361 15.697102,0.3485 1.574504,-2.93119 -15.411033,-0.34511 -7.946064,-13.19202 -1.949111,2.8842 z" />
        <path fill="#ffff00" strokeWidth="0.264583" d="m 81.119511,155.89331 -1.978446,3.17021 -15.317618,-0.22606 -7.930134,-13.42852 1.691603,-2.94514 7.793376,13.12079 z" />
        <path fill="#ffff00" strokeWidth="0.264583" d="m 59.193204,139.80891 1.322951,-2.49002 15.636886,-0.15483 7.795887,13.52523 -1.472393,2.62156 -15.742703,-0.20373 -7.540628,-13.29821" />
        <ellipse fill="#000" stroke="none" cx="85.185532" cy="-132.79399" rx={OPEN} ry="2.5408657" transform="rotate(121.61417)">{blink && <Blink />}</ellipse>
        <ellipse fill="#000" stroke="none" cx="81.588585" cy="-139.08687" rx={OPEN} ry="2.5408657" transform="rotate(121.61417)">{blink && <Blink />}</ellipse>
        <path fill="#000" stroke="none" d="m 72.181349,146.81905 a 2.5408656,1.4870758 31.61417 0 0 1.252636,1.22628 2.5408656,1.4870758 31.61417 0 0 2.943489,0.0656 2.5408656,1.4870758 31.61417 0 0 -0.0863,-1.29191 z" />
        <path fill="#aaeeff" strokeWidth="0.182753" d="m 57.134535,169.88423 1.086477,-5.24488 0.911899,1.52134 1.909513,0.0983 -3.907889,3.62527" />
      </g>
    </svg>
  )
}
