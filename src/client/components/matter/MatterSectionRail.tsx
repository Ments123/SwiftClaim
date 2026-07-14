import {
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
    available: false,
  },
  {
    id: 'protocol_experts',
    label: 'Protocol & experts',
    icon: Scale,
    available: false,
  },
  {
    id: 'damages_offers',
    label: 'Damages & offers',
    icon: Banknote,
    available: false,
  },
  { id: 'proceedings', label: 'Proceedings', icon: Gavel, available: false },
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
    available: false,
  },
  {
    id: 'chronology',
    label: 'Chronology',
    icon: MessageSquareText,
    available: true,
  },
  { id: 'audit', label: 'Audit', icon: FileClock, available: true },
] as const;

export function MatterSectionRail({
  activeSection,
  onSelect,
  counts = {},
}: MatterSectionRailProps) {
  return (
    <nav className="matter-section-rail" aria-label="Matter sections">
      {SECTION_ITEMS.map((item) => {
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
