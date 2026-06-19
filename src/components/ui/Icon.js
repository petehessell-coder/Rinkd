import React from 'react';
import {
  Users, Bell, BellRing, MoreHorizontal, MessageCircle, Search, DollarSign,
  BarChart3, Unlock, Inbox, Shield, Settings, Lock, FileText, Wallet, Wrench,
  AtSign, Flame, Heart, UserPlus, ClipboardList, CheckCircle2, XCircle,
  AlarmClock, Siren, Megaphone, Mail, Trophy, Award, Trash2, EyeOff, Flag, Ban,
  Share2, Copy, Link as LinkIcon, Download, ShoppingCart, CreditCard, Camera,
  PenLine, Radio, Calendar, MapPin, Rocket, Smartphone, User, Tv, X,
  AlertTriangle, Image as ImageIcon, LogOut,
} from 'lucide-react';

// =============================================================================
// Icon — the single line-icon surface. Manifesto anti-pattern: "Tab icons that
// are just emoji." Everything that functions as a UI icon (nav, buttons,
// onboarding role chips, notification markers) renders through here so size and
// stroke stay consistent app-wide. Emoji are reserved for user-generated
// content + the product's reaction set.
//
//   <Icon name="bell" size={22} />
//   <Icon name="trash" size={15} color={C.red} />
//
// Default size 18, stroke 2 (lucide default). Decorative by default
// (aria-hidden) — the label next to it carries the meaning.
// =============================================================================
const MAP = {
  // Nav + More drawer + role menus
  teams: Users,
  notifications: Bell,
  more: MoreHorizontal,
  messages: MessageCircle,
  discover: Search,
  pricing: DollarSign,
  analytics: BarChart3,
  activations: Unlock,
  bugReports: Inbox,
  moderation: Shield,
  settings: Settings,
  privacy: Lock,
  terms: FileText,
  myStats: BarChart3,
  dues: Wallet,
  admin: Wrench,

  // Notification type markers (KIND_META)
  comment: MessageCircle,
  mention: AtSign,
  reaction: Flame,
  like: Heart,
  follow: UserPlus,
  rosterRequest: ClipboardList,
  approved: CheckCircle2,
  denied: XCircle,
  gameReminder: AlarmClock,
  suspension: Siren,
  subAlert: Megaphone,
  lineup: ClipboardList,
  teamInvite: Mail,
  leagueInvite: Trophy,
  gamePuck: Award,

  // Action buttons
  bell: Bell,
  following: BellRing,
  delete: Trash2,
  hide: EyeOff,
  report: Flag,
  block: Ban,
  share: Share2,
  copy: Copy,
  link: LinkIcon,
  export: Download,
  cart: ShoppingCart,
  connect: CreditCard,
  camera: Camera,
  photo: ImageIcon,
  edit: PenLine,
  scorer: PenLine,
  subscribe: Radio,
  calendar: Calendar,
  manage: Settings,
  message: MessageCircle,
  directions: MapPin,
  build: Trophy,
  publish: Rocket,
  install: Smartphone,
  close: X,
  alert: AlertTriangle,
  live: Radio,
  signout: LogOut,

  // Onboarding role chips
  player: User,
  coach: ClipboardList,
  parent: Users,
  commissioner: Trophy,
  official: Flag,
  fan: Tv,
};

export default function Icon({ name, size = 18, strokeWidth = 2, color = 'currentColor', style, ...rest }) {
  const Cmp = MAP[name];
  if (!Cmp) return null; // unknown name renders nothing — call sites use known keys
  return (
    <Cmp
      size={size}
      strokeWidth={strokeWidth}
      color={color}
      aria-hidden="true"
      style={{ flexShrink: 0, display: 'block', ...style }}
      {...rest}
    />
  );
}

export { MAP as ICON_NAMES };
