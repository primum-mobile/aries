import * as React from "react"

const MOBILE_BREAKPOINT = 768

export function useIsMobile() {
  // Initialize to `false` on BOTH the server and the client's first render so
  // hydration matches (the server has no `window`; reading `window.innerWidth`
  // in the lazy initializer made the client's first render diverge whenever the
  // viewport was < 768px, which structurally swapped the desktop sidebar for the
  // mobile Sheet and threw a hydration mismatch — the "1 Issue" in dev). The
  // real viewport value is applied in the effect, after mount.
  const [isMobile, setIsMobile] = React.useState(false)

  React.useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`)
    const onChange = () => {
      setIsMobile(mql.matches)
    }
    onChange()
    mql.addEventListener("change", onChange)
    return () => mql.removeEventListener("change", onChange)
  }, [])

  return isMobile
}
