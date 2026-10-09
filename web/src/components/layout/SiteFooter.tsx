// Shown at the bottom of every page: who made this, and where the code is.
import { AUTHOR_PAGE, REPO } from '@/lib/site'

export default function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="footer-inner">
        <p>
          Built by <a href={AUTHOR_PAGE} rel="author noopener" target="_blank">Yashwanth Varma<span className="sr-only"> (opens in a new tab)</span></a>
        </p>
        <p>
          A local-first collaborative workspace. <a href={REPO} rel="noopener" target="_blank">Source code on GitHub<span className="sr-only"> (opens in a new tab)</span></a> · MIT licence
        </p>
      </div>
    </footer>
  )
}
