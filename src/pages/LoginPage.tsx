import { useState } from 'react';
import { Lock, User, Eye, EyeOff, AtSign } from 'lucide-react';
import { useAuth } from '@/lib/AuthContext';
import interbatLogo from '@/assets/interbat-logo.png';
import interbatBg from '@/assets/interbat-bg.jpg';

export default function LoginPage() {
  const { signIn, signUp } = useAuth();
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    if (mode === 'signin') {
      const { error: err } = await signIn(username, password);
      if (err) setError(err);
    } else {
      if (username.trim().length < 3) {
        setError('Username must be at least 3 characters');
        setLoading(false);
        return;
      }
      if (password.length < 6) {
        setError('Password must be at least 6 characters (letters and numbers only)');
        setLoading(false);
        return;
      }
      if (!/^[a-zA-Z0-9]+$/.test(password)) {
        setError('Password can only contain letters and numbers');
        setLoading(false);
        return;
      }
      const { error: err } = await signUp(username, password, fullName || username);
      if (err) setError(err);
    }
    setLoading(false);
  }

  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center p-4 relative bg-cover bg-center"
      style={{ backgroundImage: `linear-gradient(180deg, rgba(12,58,89,0.45), rgba(12,58,89,0.75)), url(${interbatBg})` }}
    >
      <div className="relative w-full max-w-md animate-fade-in">
        <div className="text-center mb-6">
          <div className="inline-flex items-center justify-center bg-white rounded-2xl px-5 py-3 shadow-lg mb-4">
            <img src={interbatLogo} alt="Interbat" className="h-12" />
          </div>
          <h1 className="text-2xl font-bold text-white">Equipment Monitor</h1>
          <p className="text-slate-200 text-sm mt-1">24-Hour Equipment Monitoring System</p>
        </div>

        <div className="card p-6 sm:p-8">
          <div className="flex gap-1 mb-6 p-1 bg-slate-100 rounded-lg">
            <button
              onClick={() => { setMode('signin'); setError(null); }}
              className={`flex-1 py-2 px-4 rounded-md text-sm font-medium transition-all ${
                mode === 'signin' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              Sign In
            </button>
            <button
              onClick={() => { setMode('signup'); setError(null); }}
              className={`flex-1 py-2 px-4 rounded-md text-sm font-medium transition-all ${
                mode === 'signup' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              Sign Up
            </button>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {mode === 'signup' && (
              <div>
                <label className="label-text">Full Name</label>
                <div className="relative">
                  <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <input
                    type="text"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    className="input-field pl-10"
                    placeholder="John Doe"
                  />
                </div>
              </div>
            )}

            <div>
              <label className="label-text">Username</label>
              <div className="relative">
                <AtSign className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  required
                  className="input-field pl-10"
                  placeholder="e.g. technician01"
                  autoComplete="username"
                />
              </div>
            </div>

            <div>
              <label className="label-text">Password</label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  className="input-field pl-10 pr-10"
                  placeholder="Min 6 chars, letters & numbers only"
                  autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {error && (
              <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
                {error}
              </div>
            )}

            <button type="submit" disabled={loading} className="btn-primary w-full">
              {loading ? 'Please wait...' : mode === 'signin' ? 'Sign In' : 'Create Account'}
            </button>
          </form>

          <p className="text-center text-xs text-slate-400 mt-6">
            {mode === 'signup'
              ? 'The first account created becomes the administrator.'
              : 'Sign in with your technician or admin account.'}
          </p>
        </div>

        <p className="text-center text-white/90 text-sm font-medium mt-6" style={{ letterSpacing: '0.15em' }}>
          innovate <span className="text-teal-300">to</span> inspire
        </p>
      </div>
    </div>
  );
}
