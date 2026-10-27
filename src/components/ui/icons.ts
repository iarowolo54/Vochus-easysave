// The one place UI concepts map to icons. Use these names — not emoji, not ad-hoc lucide imports —
// so "save" or "withdraw" looks the same on every screen.
import {
  ArrowDownLeft, Banknote, ArrowUpRight, Check, ChevronDown, CreditCard, ChevronLeft, ChevronRight, CircleAlert, Clock, Download, Eye, EyeOff, Fingerprint,
  Headset, House, ImagePlus, LayoutGrid, Lock, LogOut, MessageCircle, Phone, PiggyBank, Plus, Receipt, RefreshCw, SendHorizontal, Settings, Share2, Users, X,
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
  share: Share2,
  image: ImagePlus,
  send: SendHorizontal,
  card: CreditCard,
  cash: Banknote,
  error: CircleAlert,
  retry: RefreshCw,
} as const

export type IconName = keyof typeof Icons
