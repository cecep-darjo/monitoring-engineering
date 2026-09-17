import { useEffect, useState } from 'react';
import {
  Users as UsersIcon,
  UserPlus,
  Edit2,
  Trash2,
  X,
  Search,
  Shield,
  Wrench,
  CheckCircle2,
  XCircle,
  AtSign,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/AuthContext';
import type { Profile, UserRole } from '@/lib/types';

function usernameToEmail(username: string): string {
  const clean = username.trim().toLowerCase().replace(/\s+/g, '_');
  return `${clean}@monitor.local`;
}

export default function AdminUsers() {
  const { profile: currentUser } = useAuth();
  const [users, setUsers] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Profile | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [role, setRole] = useState<UserRole>('technician');
  const [isActive, setIsActive] = useState(true);

  useEffect(() => {
    loadUsers();
  }, []);

  async function loadUsers() {
    setLoading(true);
    const { data } = await supabase.from('profiles').select('*').order('created_at', { ascending: false });
    setUsers(data || []);
    setLoading(false);
  }

  function openCreate() {
    setEditing(null);
    setUsername('');
    setPassword('');
    setFullName('');
    setRole('technician');
    setIsActive(true);
    setError(null);
    setShowForm(true);
  }

  function openEdit(user: Profile) {
    setEditing(user);
    setUsername(user.username || user.email.split('@')[0]);
    setPassword('');
    setFullName(user.full_name);
    setRole(user.role);
    setIsActive(user.is_active);
    setError(null);
    setShowForm(true);
  }

  async function handleSave() {
    if (!username.trim() || !fullName.trim()) {
      setError('Username and name are required');
      return;
    }
    setSaving(true);
    setError(null);

    try {
      if (editing) {
        const { error: err } = await supabase
          .from('profiles')
          .update({
            full_name: fullName.trim(),
            username: username.trim(),
            role,
            is_active: isActive,
          })
          .eq('id', editing.id);
        if (err) throw err;
      } else {
        if (password.length < 6) {
          setError('Password must be at least 6 characters (letters and numbers only)');
          setSaving(false);
          return;
        }
        if (!/^[a-zA-Z0-9]+$/.test(password)) {
          setError('Password can only contain letters and numbers');
          setSaving(false);
          return;
        }

        // Call edge function which uses service role key to bypass password strength check
        const apiUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/create-user`;
        const response = await fetch(apiUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
          },
          body: JSON.stringify({
            username: username.trim(),
            password,
            fullName: fullName.trim(),
            role,
          }),
        });

        const result = await response.json();
        if (!response.ok || result.error) {
          setError(result.error || `Request failed (${response.status})`);
          setSaving(false);
          return;
        }

        // Wait for trigger to create profile, then update role if needed
        await new Promise((r) => setTimeout(r, 1000));
        const email = usernameToEmail(username);
        const { data: newProfile } = await supabase
          .from('profiles')
          .select('id')
          .eq('email', email)
          .maybeSingle();

        if (newProfile) {
          await supabase.from('profiles').update({ role, is_active: isActive }).eq('id', newProfile.id);
        }
      }

      setShowForm(false);
      await loadUsers();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to save user';
      setError(msg);
    }
    setSaving(false);
  }

  async function handleToggleActive(user: Profile) {
    const { error: err } = await supabase
      .from('profiles')
      .update({ is_active: !user.is_active })
      .eq('id', user.id);
    if (err) {
      alert(err.message);
      return;
    }
    await loadUsers();
  }

  async function handleDelete(user: Profile) {
    if (!currentUser) return;
    if (user.id === currentUser.id) {
      alert('You cannot delete your own account.');
      return;
    }
    const confirmed = window.confirm(
      `Delete user "${user.full_name}" (@${user.username || user.email.split('@')[0]})? This action cannot be undone.`
    );
    if (!confirmed) return;

    setDeletingId(user.id);
    try {
      const apiUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/delete-user`;
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
        },
        body: JSON.stringify({ userId: user.id, requestedBy: currentUser.id }),
      });
      const result = await response.json();
      if (!response.ok || result.error) {
        throw new Error(result.error || `Request failed (${response.status})`);
      }
      await loadUsers();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to delete user';
      alert(msg);
    }
    setDeletingId(null);
  }

  const filtered = users.filter(
    (u) =>
      u.full_name.toLowerCase().includes(search.toLowerCase()) ||
      (u.username || '').toLowerCase().includes(search.toLowerCase()) ||
      u.email.toLowerCase().includes(search.toLowerCase())
  );

  const adminCount = users.filter((u) => u.role === 'admin').length;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Users</h1>
          <p className="text-slate-500 text-sm mt-1">Manage technician and admin accounts</p>
        </div>
        <button onClick={openCreate} className="btn-primary">
          <UserPlus className="w-4 h-4" />
          Add User
        </button>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search users by name or username..."
          className="input-field pl-10"
        />
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-40">
          <div className="w-8 h-8 border-2 border-teal-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="card p-12 text-center">
          <UsersIcon className="w-12 h-12 text-slate-300 mx-auto mb-3" />
          <p className="text-slate-500 text-sm">No users found.</p>
        </div>
      ) : (
        <div className="card divide-y divide-slate-100">
          {filtered.map((user) => {
            const isCurrentUser = currentUser?.id === user.id;
            return (
              <div key={user.id} className="flex items-center justify-between px-5 py-4">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-10 h-10 rounded-full bg-slate-200 flex items-center justify-center text-sm font-semibold text-slate-600 flex-shrink-0">
                    {user.full_name.charAt(0).toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-semibold text-slate-900 truncate">
                        {user.full_name}
                      </p>
                      {isCurrentUser && (
                        <span className="text-xs text-teal-600 font-medium">(You)</span>
                      )}
                    </div>
                    <p className="text-xs text-slate-400 truncate">
                      @{user.username || user.email.split('@')[0]}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <span
                    className={`badge ${
                      user.role === 'admin'
                        ? 'bg-teal-50 text-teal-700 border-teal-200'
                        : 'bg-blue-50 text-blue-700 border-blue-200'
                    }`}
                  >
                    {user.role === 'admin' ? <Shield className="w-3 h-3" /> : <Wrench className="w-3 h-3" />}
                    {user.role}
                  </span>
                  <button
                    onClick={() => handleToggleActive(user)}
                    className={`badge cursor-pointer ${
                      user.is_active
                        ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                        : 'bg-slate-100 text-slate-500 border-slate-200'
                    }`}
                    title={user.is_active ? 'Click to deactivate' : 'Click to activate'}
                  >
                    {user.is_active ? <CheckCircle2 className="w-3 h-3" /> : <XCircle className="w-3 h-3" />}
                    {user.is_active ? 'Active' : 'Inactive'}
                  </button>
                  <button
                    onClick={() => openEdit(user)}
                    className="btn-ghost text-xs border border-slate-200 px-2.5"
                  >
                    <Edit2 className="w-3.5 h-3.5" />
                  </button>
                  {!isCurrentUser && (
                    <button
                      onClick={() => handleDelete(user)}
                      disabled={deletingId === user.id}
                      className="btn-ghost text-xs border border-red-200 text-red-600 px-2.5 disabled:opacity-50"
                      title="Delete user"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {showForm && (
        <div className="fixed inset-0 bg-slate-900/50 z-50 flex items-center justify-center p-4 animate-fade-in" onClick={() => setShowForm(false)}>
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
              <h2 className="font-bold text-slate-900">{editing ? 'Edit User' : 'Add User'}</h2>
              <button onClick={() => setShowForm(false)} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="label-text">Full Name</label>
                <input
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  className="input-field"
                  placeholder="John Doe"
                />
              </div>
              <div>
                <label className="label-text">Username</label>
                <div className="relative">
                  <AtSign className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <input
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    className="input-field pl-10"
                    placeholder="e.g. technician01"
                    disabled={!!editing && editing.id !== currentUser?.id}
                  />
                </div>
                {editing && editing.id !== currentUser?.id && (
                  <p className="text-xs text-slate-400 mt-1">Username cannot be changed for other users</p>
                )}
              </div>
              {!editing && (
                <div>
                  <label className="label-text">Password</label>
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="input-field"
                    placeholder="Min 6 chars, letters & numbers only"
                  />
                </div>
              )}
              <div>
                <label className="label-text">Role</label>
                <div className="flex gap-2">
                  <button
                    onClick={() => setRole('technician')}
                    className={`flex-1 py-2.5 rounded-lg text-sm font-medium border transition-all flex items-center justify-center gap-2 ${
                      role === 'technician'
                        ? 'bg-blue-500 text-white border-blue-500'
                        : 'bg-white text-slate-600 border-slate-300'
                    }`}
                  >
                    <Wrench className="w-4 h-4" />
                    Technician
                  </button>
                  <button
                    onClick={() => setRole('admin')}
                    disabled={editing?.role === 'admin' && adminCount <= 1}
                    className={`flex-1 py-2.5 rounded-lg text-sm font-medium border transition-all flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed ${
                      role === 'admin'
                        ? 'bg-teal-600 text-white border-teal-600'
                        : 'bg-white text-slate-600 border-slate-300'
                    }`}
                  >
                    <Shield className="w-4 h-4" />
                    Admin
                  </button>
                </div>
                {editing?.role === 'admin' && adminCount <= 1 && (
                  <p className="text-xs text-slate-400 mt-1">Cannot demote the last admin</p>
                )}
              </div>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={isActive}
                  onChange={(e) => setIsActive(e.target.checked)}
                  className="w-4 h-4 rounded border-slate-300 text-teal-600 focus:ring-teal-500"
                />
                <span className="text-sm text-slate-700">Active (can sign in)</span>
              </label>
              {error && <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>}
            </div>
            <div className="flex gap-3 px-6 py-4 border-t border-slate-200">
              <button onClick={handleSave} disabled={saving} className="btn-primary flex-1">
                {saving ? 'Saving...' : 'Save'}
              </button>
              <button onClick={() => setShowForm(false)} className="btn-secondary">Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
