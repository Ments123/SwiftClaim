import {
  ArchiveRestore,
  Banknote,
  Building2,
  CalendarCheck2,
  ClipboardList,
  FileClock,
  FileSearch,
  FileText,
  Gavel,
  Home,
  Mail,
  MessageSquareText,
  Handshake,
  Scale,
  ShieldCheck,
  UsersRound,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

import type { MatterSection } from '../../api.js';

interface MatterSectionRailProps {
  activeSection: MatterSection;
  onSelect: (section: MatterSection) => void;
  counts?: Partial<Record<MatterSection, number>>;
  financeOnly?: boolean;
}

const SECTION_ITEMS: ReadonlyArray<{
  id: MatterSection;
  label: string;
  icon: LucideIcon;
  available: boolean;
}> = [
  { id: 'overview', label: 'Overview', icon: Home, available: true },
  {
    id: 'client_household',
    label: 'Client & household',
    icon: UsersRound,
    available: true,
  },
  {
    id: 'property_tenancy',
    label: 'Property & tenancy',
    icon: Building2,
    available: true,
  },
  {
    id: 'defects_repairs',
    label: 'Defects & repairs',
    icon: FileSearch,
    available: true,
  },
  { id: 'evidence', label: 'Evidence', icon: ShieldCheck, available: true },
  { id: 'documents', label: 'Documents', icon: FileText, available: true },
  {
    id: 'communications',
    label: 'Communications',
    icon: Mail,
    available: true,
  },
  {
    id: 'protocol_experts',
    label: 'Protocol & experts',
    icon: Scale,
    available: true,
  },
  {
    id: 'damages_offers',
    label: 'Repairs & quantum',
    icon: Banknote,
    available: true,
  },
  {
    id: 'negotiation_settlement',
    label: 'Negotiation & settlement',
    icon: Handshake,
    available: true,
  },
  { id: 'proceedings', label: 'Proceedings', icon: Gavel, available: true },
  { id: 'disclosure', label: 'Disclosure', icon: FileSearch, available: true },
  {
    id: 'tasks_calendar',
    label: 'Tasks & calendar',
    icon: CalendarCheck2,
    available: true,
  },
  {
    id: 'time_finance',
    label: 'Time & finance',
    icon: ClipboardList,
    available: true,
  },
  {
    id: 'chronology',
    label: 'Chronology',
    icon: MessageSquareText,
    available: true,
  },
  {
    id: 'closure_retention',
    label: 'Closure & retention',
    icon: ArchiveRestore,
    available: true,
  },
  { id: 'audit', label: 'Audit', icon: FileClock, available: true },
] as const;

export function MatterSectionRail({
  activeSection,
  onSelect,
  counts = {},
  financeOnly = false,
}: MatterSectionRailProps) {
  const items = financeOnly
    ? SECTION_ITEMS.filter(({ id }) => id === 'overview' || id === 'time_finance')
    : SECTION_ITEMS;
  return (
    <nav className="matter-section-rail" aria-label="Matter sections">
      {items.map((item) => {
        const Icon = item.icon;
        return (
          <button
            key={item.id}
            type="button"
            className={activeSection === item.id ? 'is-active' : ''}
            aria-current={activeSection === item.id ? 'page' : undefined}
            disabled={!item.available}
            onClick={() => onSelect(item.id)}
          >
            <Icon size={15} aria-hidden="true" />
            <span>{item.label}</span>
            {item.available ? (
              counts[item.id] !== undefined ? (
                <small>{counts[item.id]}</small>
              ) : null
            ) : (
              <small>Planned</small>
            )}
          </button>
        );
      })}
    </nav>
  );
}
