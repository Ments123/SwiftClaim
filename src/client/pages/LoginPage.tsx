import { ArrowRight, CheckCircle2, Database, LockKeyhole, Scale, ShieldCheck } from 'lucide-react';
import { useState, type FormEvent } from 'react';

interface LoginPageProps {
  onLogin: (email: string, password: string) => Promise<void>;
}

export function LoginPage({ onLogin }: LoginPageProps) {
  const [email, setEmail] = useState('ava@northstar.test');
  const [password, setPassword] = useState('SwiftClaim!2026');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setError('');
    try {
      await onLogin(email, password);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Sign in failed.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="login-page">
      <section className="login-story" aria-label="SwiftClaim product overview">
        <div className="brand-lockup brand-lockup--login">
          <span className="brand-mark brand-mark--light" aria-hidden="true">
            <Scale size={23} strokeWidth={2.2} />
          </span>
          <span>
            <strong>SwiftClaim</strong>
            <small>Litigation</small>
          </span>
        </div>
        <div className="login-story__content">
          <span className="eyebrow eyebrow--light">Built for litigation teams</span>
          <h1>Your litigation work, in one place.</h1>
          <p>
            A matter-first workspace with clear deadlines, preserved evidence and a complete record of every action.
          </p>
          <ul className="login-benefits">
            <li>
              <CheckCircle2 size={18} aria-hidden="true" />
              Firm and matter-level access controls
            </li>
            <li>
              <CheckCircle2 size={18} aria-hidden="true" />
              Evidential timeline and append-only audit
            </li>
            <li>
              <CheckCircle2 size={18} aria-hidden="true" />
              Migration-ready Proclaim identifiers
            </li>
          </ul>
        </div>
        <div className="login-trust-grid">
          <div>
            <ShieldCheck size={19} aria-hidden="true" />
            <span><strong>Isolated</strong><small>Firm boundaries</small></span>
          </div>
          <div>
            <Database size={19} aria-hidden="true" />
            <span><strong>Durable</strong><small>Matter history</small></span>
          </div>
          <div>
            <LockKeyhole size={19} aria-hidden="true" />
            <span><strong>Controlled</strong><small>Secure sessions</small></span>
          </div>
        </div>
      </section>

      <section className="login-form-panel">
        <div className="login-form-wrap">
          <span className="eyebrow">Secure access</span>
          <h2>Welcome back</h2>
          <p className="muted">Sign in to the Northstar Legal evaluation workspace.</p>

          <form className="form-stack login-form" onSubmit={submit}>
            <label className="form-field">
              <span>Work email</span>
              <input
                type="email"
                autoComplete="username"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
              />
            </label>
            <label className="form-field">
              <span>Password</span>
              <input
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
              />
            </label>
            {error ? <div className="form-alert" role="alert">{error}</div> : null}
            <button className="button button--primary button--wide" type="submit" disabled={submitting}>
              {submitting ? 'Checking access…' : 'Sign in securely'}
              {!submitting ? <ArrowRight size={17} aria-hidden="true" /> : null}
            </button>
          </form>

          <div className="demo-credentials">
            <span className="status-dot" />
            <p>
              <strong>Evaluation account loaded</strong>
              <span>Ava Morgan · Solicitor · Northstar Legal</span>
            </p>
          </div>
          <p className="login-footnote">
            Step 1 uses seeded demonstration data only. Do not upload live client material.
          </p>
        </div>
      </section>
    </main>
  );
}
