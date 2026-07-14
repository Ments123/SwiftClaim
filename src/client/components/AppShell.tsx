import {
  BriefcaseBusiness,
  CalendarDays,
  ChevronLeft,
  ClipboardList,
  LogOut,
  Menu,
  Scale,
  ShieldCheck,
  X,
} from 'lucide-react';
import { useState, type ReactNode } from 'react';

import type { CurrentUser } from '../api.js';

interface AppShellProps {
  user: CurrentUser;
  page: 'dashboard' | 'intake' | 'enquiry' | 'matter';
  matterReference?: string;
  onDashboard: () => void;
  onIntake: () => void;
  onLogout: () => void;
  children: ReactNode;
}

function initials(name: string) {
  return name
    .split(' ')
    .slice(0, 2)
    .map((part) => part[0])
    .join('');
}

export function AppShell({
  user,
  page,
  matterReference,
  onDashboard,
  onIntake,
  onLogout,
  children,
}: AppShellProps) {
  const [mobileOpen, setMobileOpen] = useState(false);

  const navigateDashboard = () => {
    setMobileOpen(false);
    onDashboard();
  };

  const navigateIntake = () => {
    setMobileOpen(false);
    onIntake();
  };

  const sidebar = (
    <>
      <div className="brand-lockup brand-lockup--sidebar">
        <span className="brand-mark" aria-hidden="true">
          <Scale size={21} strokeWidth={2.2} />
        </span>
        <span>
          <strong>SwiftClaim</strong>
          <small>Litigation</small>
        </span>
      </div>

      <nav className="primary-navigation" aria-label="Primary navigation">
        <p className="navigation-label">Workspace</p>
        <button
          type="button"
          className={page === 'dashboard' ? 'navigation-item is-active' : 'navigation-item'}
          onClick={navigateDashboard}
        >
          <CalendarDays size={18} aria-hidden="true" />
          <span>Today</span>
        </button>
        {user.permissions.canAccessIntake ? (
          <button
            type="button"
            className={
              page === 'intake' || page === 'enquiry'
                ? 'navigation-item is-active'
                : 'navigation-item'
            }
            onClick={navigateIntake}
          >
            <ClipboardList size={18} aria-hidden="true" />
            <span>Enquiries</span>
          </button>
        ) : null}
        <button
          type="button"
          className={page === 'matter' ? 'navigation-item is-active' : 'navigation-item'}
          onClick={navigateDashboard}
        >
          <BriefcaseBusiness size={18} aria-hidden="true" />
          <span>Matters</span>
          {matterReference ? <small>{matterReference}</small> : null}
        </button>
      </nav>

      <div className="sidebar-spacer" />
      <div className="security-note">
        <ShieldCheck size={18} aria-hidden="true" />
        <span>
          <strong>Firm-isolated</strong>
          <small>Step 1 secure workspace</small>
        </span>
      </div>
      <div className="sidebar-user">
        <span className="avatar">{initials(user.name)}</span>
        <span className="sidebar-user__copy">
          <strong>{user.name}</strong>
          <small>{user.role}</small>
        </span>
        <button className="icon-button icon-button--dark" type="button" onClick={onLogout} aria-label="Sign out">
          <LogOut size={17} aria-hidden="true" />
        </button>
      </div>
    </>
  );

  return (
    <div className="app-frame">
      <aside className="sidebar">{sidebar}</aside>
      {mobileOpen ? (
        <div className="mobile-sidebar-backdrop" onMouseDown={() => setMobileOpen(false)}>
          <aside className="mobile-sidebar" onMouseDown={(event) => event.stopPropagation()}>
            <button
              className="icon-button icon-button--dark mobile-sidebar__close"
              type="button"
              onClick={() => setMobileOpen(false)}
              aria-label="Close navigation"
            >
              <X size={18} aria-hidden="true" />
            </button>
            {sidebar}
          </aside>
        </div>
      ) : null}

      <div className="app-main">
        <header className="mobile-topbar">
          <button className="icon-button" type="button" onClick={() => setMobileOpen(true)} aria-label="Open navigation">
            <Menu size={20} aria-hidden="true" />
          </button>
          <div className="brand-lockup brand-lockup--mobile">
            <span className="brand-mark" aria-hidden="true">
              <Scale size={18} />
            </span>
            <strong>SwiftClaim</strong>
          </div>
          {page === 'matter' || page === 'enquiry' ? (
            <button className="icon-button" type="button" onClick={page === 'enquiry' ? navigateIntake : navigateDashboard} aria-label={page === 'enquiry' ? 'Back to enquiries' : 'Back to dashboard'}>
              <ChevronLeft size={20} aria-hidden="true" />
            </button>
          ) : (
            <span className="avatar avatar--small">{initials(user.name)}</span>
          )}
        </header>
        <div className="firm-ribbon">
          <span>{user.firm.name}</span>
          <span className="firm-ribbon__divider" />
          <span>Secure evaluation environment</span>
        </div>
        {children}
      </div>
    </div>
  );
}
