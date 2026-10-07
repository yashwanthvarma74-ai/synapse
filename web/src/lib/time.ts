// "just now", "5 minutes ago", "3 days ago"
export function timeAgo(iso: string, now = Date.now()) {
  const seconds = (now - new Date(iso).getTime()) / 1000
  if (seconds < 90) return 'just now'
  if (seconds < 3600) return `${Math.round(seconds / 60)} minutes ago`
  if (seconds < 86_400) return `${Math.round(seconds / 3600)} hours ago`
  return `${Math.round(seconds / 86_400)} days ago`
}

export const fullDate = (iso: string) => new Date(iso).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })
