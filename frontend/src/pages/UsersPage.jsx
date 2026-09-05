import { useEffect, useState } from "react";
import { listUsers, createUser, setUserPassword, listFeatures, setUserFeatures } from "../api";
import PasswordInput from "../components/PasswordInput.jsx";

function SetPasswordRow({ user, onDone }) {
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function handleSubmit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await setUserPassword(user.id, password);
      setOpen(false);
      setPassword("");
      onDone(`Password set for ${user.username}.`);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button className="link-button" onClick={() => setOpen(true)}>
        Set password
      </button>
    );
  }

  return (
    <form onSubmit={handleSubmit} style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
      <PasswordInput
        placeholder="New password (min 8 chars)"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        style={{ maxWidth: "220px" }}
        autoFocus
      />
      <button type="submit" disabled={busy || password.length < 8}>
        {busy ? "Saving…" : "Save"}
      </button>
      <button type="button" className="link-button" onClick={() => setOpen(false)}>
        Cancel
      </button>
      {error && <span className="error">{error}</span>}
    </form>
  );
}

function FeatureCheckboxes({ features, selected, onChange }) {
  function toggle(key) {
    onChange(selected.includes(key) ? selected.filter((k) => k !== key) : [...selected, key]);
  }

  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: "0.6rem 1.1rem" }}>
      {features.map((f) => (
        <label key={f.key} style={{ display: "flex", alignItems: "center", gap: "0.35rem", fontSize: "0.85rem" }}>
          <input type="checkbox" checked={selected.includes(f.key)} onChange={() => toggle(f.key)} />
          {f.label}
        </label>
      ))}
    </div>
  );
}

function EditAccessRow({ user, features, onDone }) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState(user.allowed_features || []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function handleSave() {
    setBusy(true);
    setError(null);
    try {
      await setUserFeatures(user.id, selected);
      setOpen(false);
      onDone(`Access updated for ${user.username}.`);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (user.is_admin) {
    return <span className="muted">Full access (admin)</span>;
  }

  if (!open) {
    return (
      <button className="link-button" onClick={() => setOpen(true)}>
        Edit access ({(user.allowed_features || []).length})
      </button>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", alignItems: "flex-start" }}>
      <FeatureCheckboxes features={features} selected={selected} onChange={setSelected} />
      <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
        <button type="button" disabled={busy} onClick={handleSave}>
          {busy ? "Saving…" : "Save access"}
        </button>
        <button type="button" className="link-button" onClick={() => setOpen(false)}>
          Cancel
        </button>
        {error && <span className="error">{error}</span>}
      </div>
    </div>
  );
}

export default function UsersPage() {
  const [users, setUsers] = useState(null);
  const [features, setFeatures] = useState([]);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);

  const [newUsername, setNewUsername] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newIsAdmin, setNewIsAdmin] = useState(false);
  const [newFeatures, setNewFeatures] = useState([]);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState(null);

  function load() {
    listUsers()
      .then(setUsers)
      .catch((err) => setError(err.message));
  }

  useEffect(() => {
    load();
    listFeatures()
      .then((res) => setFeatures(res.features))
      .catch((err) => setError(err.message));
  }, []);

  async function handleCreate(e) {
    e.preventDefault();
    setCreating(true);
    setCreateError(null);
    try {
      await createUser(newUsername, newPassword, newIsAdmin, newFeatures);
      setNewUsername("");
      setNewPassword("");
      setNewIsAdmin(false);
      setNewFeatures([]);
      setNotice(`User "${newUsername}" created.`);
      load();
    } catch (err) {
      setCreateError(err.message);
    } finally {
      setCreating(false);
    }
  }

  return (
    <>
      <div className="page-header">
        <h1>Users</h1>
        <p className="muted">
          Admin-only: create dashboard logins, set/reset passwords, and choose which tabs each
          regular user can access. An admin always has full access to everything - the checklist
          below only applies to non-admin accounts.
        </p>
      </div>
      <section className="card">
        <h2 style={{ marginTop: 0, fontSize: "1.05rem" }}>Add a user</h2>
        <form onSubmit={handleCreate} style={{ display: "flex", flexDirection: "column", gap: "0.85rem" }}>
          <div style={{ display: "flex", gap: "0.75rem", alignItems: "flex-end", flexWrap: "wrap" }}>
            <label style={{ display: "flex", flexDirection: "column", fontSize: "0.82rem", gap: "0.3rem" }}>
              Username
              <input type="text" value={newUsername} onChange={(e) => setNewUsername(e.target.value)} />
            </label>
            <label style={{ display: "flex", flexDirection: "column", fontSize: "0.82rem", gap: "0.3rem" }}>
              Password
              <PasswordInput value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: "0.4rem", fontSize: "0.85rem", paddingBottom: "0.4rem" }}>
              <input type="checkbox" checked={newIsAdmin} onChange={(e) => setNewIsAdmin(e.target.checked)} />
              Admin
            </label>
            <button type="submit" disabled={creating || !newUsername || newPassword.length < 8}>
              {creating ? "Creating…" : "Create user"}
            </button>
          </div>
          {!newIsAdmin && (
            <div>
              <div className="muted" style={{ fontSize: "0.82rem", marginBottom: "0.4rem" }}>
                Tab access for this user (none selected = no access to anything yet):
              </div>
              <FeatureCheckboxes features={features} selected={newFeatures} onChange={setNewFeatures} />
            </div>
          )}
        </form>
        {newPassword && newPassword.length < 8 && (
          <p className="muted" style={{ marginTop: "0.5rem" }}>Password needs at least 8 characters.</p>
        )}
        {createError && <p className="error">{createError}</p>}
      </section>

      <section className="card" style={{ marginTop: "1.1rem" }}>
        <h2 style={{ marginTop: 0, fontSize: "1.05rem" }}>Users</h2>
        {notice && <p className="success">{notice}</p>}
        {error && <p className="error">{error}</p>}
        {users && (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Username</th>
                  <th>Admin</th>
                  <th>Access</th>
                  <th>Password</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id}>
                    <td>{u.username}</td>
                    <td>{u.is_admin ? "Yes" : "No"}</td>
                    <td>
                      <EditAccessRow
                        user={u}
                        features={features}
                        onDone={(msg) => {
                          setNotice(msg);
                          load();
                        }}
                      />
                    </td>
                    <td>
                      <SetPasswordRow user={u} onDone={setNotice} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
