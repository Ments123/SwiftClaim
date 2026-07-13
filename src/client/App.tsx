import { useEffect, useState } from 'react';

import { ApiError, jsonBody, request, type CurrentUser } from './api.js';
import { AppShell } from './components/AppShell.js';
import { DashboardPage } from './pages/DashboardPage.js';
import { LoginPage } from './pages/LoginPage.js';
import { MatterPage } from './pages/MatterPage.js';

type Route = { page: 'dashboard' } | { page: 'matter'; matterId: string };

function routeFromLocation(): Route {
  const match = window.location.pathname.match(/^\/matters\/([^/]+)$/);
  return match?.[1] ? { page: 'matter', matterId: match[1] } : { page: 'dashboard' };
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
    const path = next.page === 'dashboard' ? '/' : `/matters/${next.matterId}`;
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
    navigate({ page: 'dashboard' });
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
      onLogout={() => void logout()}
    >
      {route.page === 'dashboard' ? (
        <DashboardPage user={user} onOpenMatter={(matterId) => navigate({ page: 'matter', matterId })} />
      ) : (
        <MatterPage matterId={route.matterId} onBack={() => navigate({ page: 'dashboard' })} />
      )}
    </AppShell>
  );
}
