// The one place UI concepts map to icons. Use these names — not emoji, not ad-hoc lucide imports —
// so "save" or "withdraw" looks the same on every screen.
import {
  ArrowDownLeft, ArrowUpRight, Check, ChevronDown, ChevronLeft, ChevronRight, CircleAlert, Clock, Download, Eye, EyeOff, Fingerprint,
  Headset, House, LayoutGrid, Lock, LogOut, MessageCircle, Phone, PiggyBank, Plus, Receipt, RefreshCw, Settings, Users, X,
} from 'lucide-react'

export const Icons = {
  home: House,
  dashboard: LayoutGrid,
  plan: PiggyBank,
  history: Receipt,
  chat: MessageCircle,
  support: Headset,
  settings: Settings,
  customers: Users,
  add: Plus,
  deposit: ArrowDownLeft,
  withdraw: ArrowUpRight,
  locked: Lock,
  fingerprint: Fingerprint,
  logout: LogOut,
  back: ChevronLeft,
  next: ChevronRight,
  expand: ChevronDown,
  close: X,
  phone: Phone,
  check: Check,
  pending: Clock,
  show: Eye,
  hide: EyeOff,
  download: Download,
  error: CircleAlert,
  retry: RefreshCw,
} as const

export type IconName = keyof typeof Icons
