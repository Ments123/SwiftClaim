import { lazy, Suspense, useEffect, useState } from 'react';

import { ApiError, jsonBody, request, type CurrentUser } from './api.js';
import { AppShell } from './components/AppShell.js';
import { DashboardPage } from './pages/DashboardPage.js';
import { EnquiryPage } from './pages/EnquiryPage.js';
import { IntakeQueuePage } from './pages/IntakeQueuePage.js';
import { LoginPage } from './pages/LoginPage.js';
import { MatterPage } from './pages/MatterPage.js';

const CashroomPage = lazy(() => import('./pages/CashroomPage.js').then((module) => ({ default: module.CashroomPage })));

type Route =
  | { page: 'dashboard' }
  | { page: 'intake' }
  | { page: 'cashroom' }
  | { page: 'enquiry'; enquiryId: string }
  | { page: 'matter'; matterId: string };

function routeFromLocation(): Route {
  const matterMatch = window.location.pathname.match(/^\/matters\/([^/]+)$/);
  if (matterMatch?.[1]) return { page: 'matter', matterId: matterMatch[1] };
  const enquiryMatch = window.location.pathname.match(/^\/intake\/([^/]+)$/);
  if (enquiryMatch?.[1]) return { page: 'enquiry', enquiryId: enquiryMatch[1] };
  if (window.location.pathname === '/intake') return { page: 'intake' };
  if (window.location.pathname === '/cashroom') return { page: 'cashroom' };
  return { page: 'dashboard' };
}

export function App() {
  const [user, setUser] = useState<CurrentUser | null>();
  const [route, setRoute] = useState<Route>(routeFromLocation);

  useEffect(() => {
    let active = true;
    request<{ user: CurrentUser }>('/api/me')
      .then((response) => {
        if (active) setUser(response.user);
      })
      .catch((reason) => {
        if (!active) return;
        if (reason instanceof ApiError && reason.status === 401) setUser(null);
        else setUser(null);
      });
    const onPopState = () => setRoute(routeFromLocation());
    window.addEventListener('popstate', onPopState);
    return () => {
      active = false;
      window.removeEventListener('popstate', onPopState);
    };
  }, []);

  const navigate = (next: Route) => {
    const path =
      next.page === 'dashboard'
        ? '/'
        : next.page === 'intake'
          ? '/intake'
          : next.page === 'cashroom'
            ? '/cashroom'
          : next.page === 'enquiry'
            ? `/intake/${next.enquiryId}`
            : `/matters/${next.matterId}`;
    window.history.pushState({}, '', path);
    setRoute(next);
    if (!navigator.userAgent.includes('jsdom')) {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  const login = async (email: string, password: string) => {
    const response = await request<{ user: CurrentUser }>('/api/auth/login', {
      method: 'POST',
      body: jsonBody({ email, password }),
    });
    setUser(response.user);
    navigate(
      response.user.permissions.canAccessIntake
        ? { page: 'intake' }
        : { page: 'dashboard' },
    );
  };

  const logout = async () => {
    try {
      await request('/api/auth/logout', { method: 'POST' });
    } finally {
      setUser(null);
      window.history.replaceState({}, '', '/');
      setRoute({ page: 'dashboard' });
    }
  };

  if (user === undefined) {
    return (
      <main className="boot-screen" aria-label="Loading SwiftClaim">
        <span className="boot-mark">SC</span>
        <div className="boot-line" />
      </main>
    );
  }

  if (!user) return <LoginPage onLogin={login} />;

  return (
    <AppShell
      user={user}
      page={route.page}
      matterReference={route.page === 'matter' ? 'Open matter' : undefined}
      onDashboard={() => navigate({ page: 'dashboard' })}
      onIntake={() => navigate({ page: 'intake' })}
      onCashroom={() => navigate({ page: 'cashroom' })}
      onLogout={() => void logout()}
    >
      {route.page === 'dashboard' ? (
        <DashboardPage user={user} onOpenMatter={(matterId) => navigate({ page: 'matter', matterId })} />
      ) : route.page === 'intake' ? (
        <IntakeQueuePage
          user={user}
          onOpenEnquiry={(enquiryId) => navigate({ page: 'enquiry', enquiryId })}
        />
      ) : route.page === 'cashroom' ? (
        user.permissions.canAccessCashroom ? <Suspense fallback={<main className="page page-state"><p>Loading Cashroom…</p></main>}><CashroomPage /></Suspense> : <DashboardPage user={user} onOpenMatter={(matterId) => navigate({ page: 'matter', matterId })} />
      ) : route.page === 'enquiry' ? (
        <EnquiryPage
          enquiryId={route.enquiryId}
          user={user}
          onBack={() => navigate({ page: 'intake' })}
          onConverted={(matterId) => navigate({ page: 'matter', matterId })}
        />
      ) : (
        <MatterPage matterId={route.matterId} financeOnly={user.role === 'finance'}
          onBack={() => navigate({ page: 'dashboard' })} />
      )}
    </AppShell>
  );
}
