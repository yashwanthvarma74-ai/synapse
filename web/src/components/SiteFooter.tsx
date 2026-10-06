// Shown at the bottom of every page: who made this, and where the code is.
const REPO = 'https://github.com/yashwanthvarma74-ai/synapse'
const AUTHOR_PAGE = 'https://github.com/yashwanthvarma74-ai'

export default function SiteFooter() {
  return (
    <footer className="site-footer">
      <p>
        Built by <a href={AUTHOR_PAGE} rel="author noopener" target="_blank">Yashwanth Varma<span className="sr-only"> (opens in a new tab)</span></a>
      </p>
      <p className="muted">
        A local-first collaborative workspace. <a href={REPO} rel="noopener" target="_blank">Source code on GitHub<span className="sr-only"> (opens in a new tab)</span></a> · MIT licence
      </p>
    </footer>
  )
}
