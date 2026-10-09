import type { ReactNode } from 'react'

// Small stroke icons. They always sit beside a visible word or inside a button that has an accessible name,
// so they are hidden from screen readers.
function Icon({ size = 18, children }: { size?: number; children: ReactNode }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      {children}
    </svg>
  )
}

type Props = { size?: number }

export const UndoIcon = (p: Props) => <Icon {...p}><path d="M9 14 4 9l5-5" /><path d="M4 9h10a6 6 0 0 1 0 12h-3" /></Icon>
export const RedoIcon = (p: Props) => <Icon {...p}><path d="m15 14 5-5-5-5" /><path d="M20 9H10a6 6 0 0 0 0 12h3" /></Icon>
export const BoldIcon = (p: Props) => <Icon {...p}><path d="M7 5h6a3.5 3.5 0 0 1 0 7H7z" /><path d="M7 12h7a3.5 3.5 0 0 1 0 7H7z" /></Icon>
export const ItalicIcon = (p: Props) => <Icon {...p}><path d="M19 4h-9" /><path d="M14 20H5" /><path d="m15 4-6 16" /></Icon>
export const StrikeIcon = (p: Props) => <Icon {...p}><path d="M16 4H9.5a3.5 3.5 0 0 0-3.2 4.6" /><path d="M14 12a4 4 0 0 1 0 8H6" /><path d="M4 12h16" /></Icon>
export const HeadingIcon = (p: Props) => <Icon {...p}><path d="M4 12h8M4 18V6M12 18V6" /><path d="m17 12 3-2v8" /></Icon>
export const SubheadingIcon = (p: Props) => <Icon {...p}><path d="M4 12h8M4 18V6M12 18V6" /><path d="M21 18h-4c0-4 4-3 4-6 0-1.5-2-2.5-4-1" /></Icon>
export const BulletsIcon = (p: Props) => <Icon {...p}><path d="M9 6h11M9 12h11M9 18h11" /><circle cx="4.5" cy="6" r="1" /><circle cx="4.5" cy="12" r="1" /><circle cx="4.5" cy="18" r="1" /></Icon>
export const NumbersIcon = (p: Props) => <Icon {...p}><path d="M10 6h11M10 12h11M10 18h11" /><path d="M4 10h2M4 6h1v4" /><path d="M6 18H4c0-1 2-2 2-3s-1-1.5-2-1" /></Icon>
export const QuoteIcon = (p: Props) => <Icon {...p}><path d="M10 11H6V7h4v4Zm0 0c0 3-1 4-4 5M19 11h-4V7h4v4Zm0 0c0 3-1 4-4 5" /></Icon>
export const CodeIcon = (p: Props) => <Icon {...p}><path d="m8 7-5 5 5 5M16 7l5 5-5 5" /></Icon>
export const ImageIcon = (p: Props) => <Icon {...p}><rect x="3" y="4" width="18" height="16" rx="2.5" /><circle cx="9" cy="10" r="1.6" /><path d="m21 16-5-5-8 9" /></Icon>
export const PaperclipIcon = (p: Props) => <Icon {...p}><path d="m21 12-8.5 8.5a5 5 0 0 1-7-7L14 5a3.5 3.5 0 0 1 5 5l-8.6 8.6a2 2 0 0 1-3-3L15 8" /></Icon>
export const DownloadIcon = (p: Props) => <Icon {...p}><path d="M12 4v11M7 11l5 5 5-5M5 20h14" /></Icon>
export const CheckIcon = (p: Props) => <Icon {...p}><path d="m5 12.5 4.5 4.5L19 7" /></Icon>
export const DocumentIcon = (p: Props) => <Icon {...p}><path d="M6 3h8l5 5v13H6z" /><path d="M14 3v5h5M9 13h7M9 17h5" /></Icon>
export const BoardIcon = (p: Props) => <Icon {...p}><rect x="3" y="3" width="8" height="7" rx="1.5" /><circle cx="17" cy="7" r="3.5" /><rect x="8" y="14" width="13" height="7" rx="1.5" /><path d="M7 10v4" /></Icon>
export const CommentIcon = (p: Props) => <Icon {...p}><path d="M21 12a8 8 0 0 1-11.7 7.1L4 20l1-4.6A8 8 0 1 1 21 12Z" /></Icon>
export const HistoryIcon = (p: Props) => <Icon {...p}><path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5M12 7v5l3 2" /></Icon>
export const LinkIcon = (p: Props) => <Icon {...p}><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" /><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" /></Icon>
export const SearchIcon = (p: Props) => <Icon {...p}><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></Icon>
