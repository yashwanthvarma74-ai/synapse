import { useEffect } from 'react'

// Every page needs its own title: it is what a screen reader announces after
// navigating, and what the browser tab shows.
export function usePageTitle(title: string | null | undefined) {
  useEffect(() => {
    if (title) document.title = `${title} – Synapse`
  }, [title])
}
